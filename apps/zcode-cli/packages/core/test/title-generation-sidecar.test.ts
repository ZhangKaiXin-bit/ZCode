import assert from "node:assert/strict";
import test from "node:test";
import type { RuntimeMessageEntry } from "../src/agent/message-history.js";
import type { ModelInputMessage } from "../src/runtime/deps.js";
import {
  buildTitleContextMessages,
  sanitizeTitleContextMessages,
} from "../src/runtime/methods/title-generation-sidecar.js";

const INSTRUCTION = "RETURN-ONE-TITLE";

function systemPrompt(text: string): RuntimeMessageEntry {
  return { message: { role: "system", content: text } };
}

function userMessage(text: string): RuntimeMessageEntry {
  return { message: { role: "user", content: text }, metadata: { source: "real_user" } };
}

function assistantMessage(text: string): RuntimeMessageEntry {
  return { message: { role: "assistant", content: text } };
}

test("buildTitleContextMessages：整段上下文之后只追加一条标题指令", () => {
  const entries: RuntimeMessageEntry[] = [
    systemPrompt("agent system prompt"),
    userMessage("帮我重构缓存逻辑"),
    assistantMessage("缓存已按 LRU 重构完成，并补了单测"),
  ];

  const messages = buildTitleContextMessages(entries, INSTRUCTION);

  assert.deepEqual(
    messages.map((message) => message.role),
    ["system", "user", "assistant", "user"],
  );
  assert.equal(messages[0]?.content, "agent system prompt");
  assert.equal(messages[1]?.content, "帮我重构缓存逻辑");
  assert.equal(messages[2]?.content, "缓存已按 LRU 重构完成，并补了单测");
  assert.equal(messages.at(-1)?.content, INSTRUCTION);
  // 只读：标题请求不得原地改写 canonical history。
  assert.equal(entries.length, 3);
});

test("buildTitleContextMessages：cache 断点落在标题指令之前", () => {
  const entries: RuntimeMessageEntry[] = [
    systemPrompt("agent system prompt"),
    userMessage("帮我重构缓存逻辑"),
    assistantMessage("重构完成"),
  ];

  const messages = buildTitleContextMessages(entries, INSTRUCTION);
  const instructionIndex = messages.length - 1;

  // skipCacheWrite：断点前移到对话最后一条，命中主链路刚写下的前缀缓存，而不是新写一份。
  assert.deepEqual(messages[instructionIndex - 1]?.cacheControl, { type: "ephemeral" });
  assert.equal(messages[instructionIndex]?.cacheControl, undefined);
});

test("sanitizeTitleContextMessages：丢掉没有结果的 toolCall", () => {
  const messages: ModelInputMessage[] = [
    { role: "system", content: "agent system prompt" },
    { role: "user", content: "跑一下构建" },
    // 取消的 turn 会留下悬空 toolCall：没有配对的 tool result。
    { role: "assistant", content: "", toolCalls: [{ id: "call_1", name: "Bash", input: {} }] },
    { role: "user", content: "算了" },
  ];

  const sanitized = sanitizeTitleContextMessages(messages);

  assert.deepEqual(
    sanitized.map((message) => message.role),
    ["system", "user", "user"],
  );
});

test("sanitizeTitleContextMessages：保留成对的 toolCall 与 toolResult", () => {
  const messages: ModelInputMessage[] = [
    { role: "user", content: "跑一下构建" },
    { role: "assistant", content: "", toolCalls: [{ id: "call_1", name: "Bash", input: {} }] },
    { role: "tool", content: "build ok", toolCallId: "call_1", toolName: "Bash" },
  ];

  const sanitized = sanitizeTitleContextMessages(messages);

  assert.deepEqual(
    sanitized.map((message) => message.role),
    ["user", "assistant", "tool"],
  );
  assert.deepEqual(sanitized[1]?.toolCalls, [{ id: "call_1", name: "Bash", input: {} }]);
});

test("sanitizeTitleContextMessages：丢掉孤立的 toolResult", () => {
  const messages: ModelInputMessage[] = [
    { role: "user", content: "hi" },
    { role: "tool", content: "orphan", toolCallId: "call_missing", toolName: "Bash" },
    { role: "user", content: "继续" },
  ];

  const sanitized = sanitizeTitleContextMessages(messages);

  assert.deepEqual(
    sanitized.map((message) => message.role),
    ["user", "user"],
  );
});
