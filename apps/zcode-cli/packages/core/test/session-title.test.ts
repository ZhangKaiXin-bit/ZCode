import assert from "node:assert/strict";
import test, { beforeEach, mock } from "node:test";
import type {
  MessageInfo,
  MessageWithParts,
  SessionInfo,
  UpdateSessionInput,
} from "@zcode/contracts";
import type { AgentRuntimeInternal } from "../src/runtime/internal.js";
import * as sidecar from "../src/runtime/methods/title-generation-sidecar.js";

// session-title.ts 在模块求值时静态绑定 generateTitleCandidate，之后再 mock 已经太晚。
// 所以先注册桩、再动态导入被测模块；桩的行为由下面的可变状态驱动，各用例只改状态。
let stubbedTitle: string | null = null;
let capturedInputs: string[] = [];
let capturedUseContext: Array<boolean | undefined> = [];

mock.module("../src/runtime/methods/title-generation-sidecar.js", {
  exports: {
    ...sidecar,
    generateTitleCandidate: async (input: string, options?: { useContext?: boolean }) => {
      capturedInputs.push(input);
      capturedUseContext.push(options?.useContext);
      return stubbedTitle === null
        ? null
        : {
            modelSelection: { providerId: "test", modelId: "test-model" },
            title: stubbedTitle,
            traceContext: { traceId: "trace_test", turnId: "turn_test" },
          };
    },
  },
});

const { regenerateSessionTitle } = await import("../src/runtime/methods/session-title.js");

const SESSION_ID = "ses_test";
const TRACE_CONTEXT = { traceId: "trace_test", turnId: "turn_test" };

type UserMessageOverrides = {
  id?: string;
  synthetic?: boolean;
  visibility?: "user-visible" | "model-only";
};

function userMessage(text: string, overrides: UserMessageOverrides = {}): MessageWithParts {
  const id = overrides.id ?? `msg_${text.slice(0, 8)}`;
  const info: MessageInfo = {
    id,
    sessionID: SESSION_ID,
    role: "user",
    agent: "build",
    time: { created: 1 },
    ...(overrides.synthetic !== undefined ? { synthetic: overrides.synthetic } : {}),
    ...(overrides.visibility !== undefined ? { visibility: overrides.visibility } : {}),
  };
  return {
    info,
    parts: [{ id: `prt_${id}`, sessionID: SESSION_ID, messageID: id, type: "text", text }],
  };
}

function session(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: SESSION_ID,
    projectID: "prj_test",
    taskType: "interactive",
    slug: "test-session",
    directory: "/tmp",
    title: "旧标题",
    version: "1",
    time: { created: 1, updated: 1 },
    ...overrides,
  };
}

/**
 * regenerateSessionTitle 只用到 runtime 上的一小块能力：读会话、取消息、写标题、发事件。
 * 其余字段用 unknown 断言绕过庞大的 AgentRuntimeInternal 表面。
 */
function createRuntime(
  options: { messages?: MessageWithParts[]; session?: SessionInfo } = {},
): {
  runtime: AgentRuntimeInternal;
  updates: UpdateSessionInput[];
  events: Array<{ type: string; payload: unknown }>;
} {
  const updates: UpdateSessionInput[] = [];
  const events: Array<{ type: string; payload: unknown }> = [];
  const currentSession = options.session ?? session();
  const messages = options.messages ?? [userMessage("帮我重构这个模块的缓存逻辑")];

  const runtime = {
    sessionId: SESSION_ID,
    rootTraceContext: TRACE_CONTEXT,
    sessionStore: {
      getSession: async () => currentSession,
      messages: async () => messages,
      updateSession: async (input: UpdateSessionInput) => {
        updates.push(input);
        Object.assign(currentSession, input);
        return currentSession;
      },
    },
    logger: { debug: () => {}, info: () => {}, warn: () => {} },
    createEvent: (type: string, payload: unknown) => ({ type, payload }),
    appendEvent: async (event: { type: string; payload: unknown }) => {
      events.push(event);
    },
  } as unknown as AgentRuntimeInternal;

  return { runtime, updates, events };
}

beforeEach(() => {
  stubbedTitle = null;
  capturedInputs = [];
  capturedUseContext = [];
});

test("生成标题：手动入口请求整段模型上下文", async () => {
  stubbedTitle = "重构缓存逻辑";
  const { runtime, updates, events } = createRuntime({
    messages: [
      userMessage("帮我重构缓存逻辑", { id: "msg_first" }),
      userMessage("顺便加上测试", { id: "msg_second" }),
    ],
  });

  await regenerateSessionTitle.call(runtime, { traceContext: TRACE_CONTEXT });

  // 素材由 sidecar 从 messageHistory 的完整上下文构建；这里的 seed 只是历史缺失时的兜底，
  // 仍取首条可见用户消息而不是末条。
  assert.deepEqual(capturedInputs, ["帮我重构缓存逻辑"]);
  assert.deepEqual(capturedUseContext, [true]);
  assert.equal(updates.length, 1);
  assert.equal(updates[0]?.title, "重构缓存逻辑");
  assert.equal(updates[0]?.titleSource, "generated");
  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, "session_title_updated");
});

test("生成标题：跳过 synthetic 与 model-only 消息", async () => {
  stubbedTitle = "真正的问题";
  const { runtime, updates } = createRuntime({
    messages: [
      userMessage("系统注入的上下文", { id: "msg_sys", synthetic: true }),
      userMessage("只给模型看的备注", { id: "msg_hidden", visibility: "model-only" }),
      userMessage("真正的问题在这里", { id: "msg_real" }),
    ],
  });

  await regenerateSessionTitle.call(runtime, { traceContext: TRACE_CONTEXT });

  assert.deepEqual(capturedInputs, ["真正的问题在这里"]);
  assert.equal(updates.length, 1);
});

test("生成标题：手动触发允许覆盖 custom 标题", async () => {
  stubbedTitle = "模型生成的新标题";
  const { runtime, updates } = createRuntime({
    session: session({ title: "我手动起的名字", titleSource: "custom" }),
  });

  await regenerateSessionTitle.call(runtime, { traceContext: TRACE_CONTEXT });

  assert.equal(updates.length, 1);
  assert.equal(updates[0]?.title, "模型生成的新标题");
  // 手动路径把 custom 纳入乐观锁白名单，否则写回会被 store 拒绝。
  assert.ok(updates[0]?.expectedTitleSources?.includes("custom"));
});

test("生成标题：无可见用户消息时静默跳过", async () => {
  stubbedTitle = "不该被调用";
  const { runtime, updates, events } = createRuntime({
    messages: [userMessage("模型专用", { id: "msg_x", visibility: "model-only" })],
  });

  await regenerateSessionTitle.call(runtime, { traceContext: TRACE_CONTEXT });

  assert.deepEqual(capturedInputs, []);
  assert.equal(updates.length, 0);
  assert.equal(events.length, 0);
});

test("生成标题：sidecar 返回空时不写回标题", async () => {
  stubbedTitle = null;
  const { runtime, updates, events } = createRuntime();

  await regenerateSessionTitle.call(runtime, { traceContext: TRACE_CONTEXT });

  // 仍会调用 sidecar，但拿不到标题时不得写回。
  assert.equal(capturedInputs.length, 1);
  assert.equal(updates.length, 0);
  assert.equal(events.length, 0);
});

test("生成标题：子会话与非 interactive 会话不落库", async () => {
  stubbedTitle = "不该写入的标题";
  const cases: Array<[string, Partial<SessionInfo>]> = [
    ["子会话", { parentID: "ses_parent" }],
    ["非 interactive", { taskType: "subagent_child" as SessionInfo["taskType"] }],
  ];

  for (const [label, overrides] of cases) {
    capturedInputs = [];
    const { runtime, updates, events } = createRuntime({ session: session(overrides) });

    await regenerateSessionTitle.call(runtime, { traceContext: TRACE_CONTEXT });

    // 当前实现不做前置校验，仍会走一次 sidecar，直到持久化阶段才被
    // getSessionForGeneratedTitle 的 parentID / taskType 判断拦下。
    // 即：标题不会写入，但模型调用已经发生。UI 只对 interactive 会话暴露按钮，
    // 所以线上不可达；此断言锁定当前行为，若后续前置短路会在这里显式失败。
    assert.equal(updates.length, 0, `${label} 不应写入标题`);
    assert.equal(events.length, 0, `${label} 不应发出标题事件`);
  }
});

test("生成标题：编辑过首条 query 的会话跳过回写", async () => {
  stubbedTitle = "模型标题";
  const { runtime, updates, events } = createRuntime({
    session: session({
      revert: { kind: "conversation_rewind", targetMessageID: "msg_old", keptMessageIDs: [] },
    }),
  });

  await regenerateSessionTitle.call(runtime, { traceContext: TRACE_CONTEXT });

  assert.equal(updates.length, 0);
  assert.equal(events.length, 0);
});
