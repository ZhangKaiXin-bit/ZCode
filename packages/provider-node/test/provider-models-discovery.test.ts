import assert from "node:assert/strict";
import test from "node:test";
import { buildModelsEndpointUrl, ProviderModelsDiscovery } from "../src/provider-models-discovery.js";

test("endpoint: openai 原样追加 /models", () => {
  assert.equal(
    buildModelsEndpointUrl("https://api.example.com/v1", "openai-chat-completions"),
    "https://api.example.com/v1/models",
  );
});

test("endpoint: 去掉尾随斜杠后追加", () => {
  assert.equal(
    buildModelsEndpointUrl("https://api.example.com/v1/", "openai-chat-completions"),
    "https://api.example.com/v1/models",
  );
});

test("endpoint: 已是 /models 不重复追加", () => {
  assert.equal(
    buildModelsEndpointUrl("https://api.example.com/v1/models", "openai-chat-completions"),
    "https://api.example.com/v1/models",
  );
});

test("endpoint: anthropic 补 /v1 前缀与 limit", () => {
  assert.equal(
    buildModelsEndpointUrl("https://api.anthropic.com", "anthropic-messages"),
    "https://api.anthropic.com/v1/models?limit=1000",
  );
});

test("endpoint: anthropic 已有 v1 不重复补", () => {
  assert.equal(
    buildModelsEndpointUrl("https://api.anthropic.com/v1", "anthropic-messages"),
    "https://api.anthropic.com/v1/models?limit=1000",
  );
});

test("endpoint: 非法 URL 抛错", () => {
  assert.throws(() => buildModelsEndpointUrl("not-a-url", "openai-chat-completions"));
});

test("discover: 保留上游自报的上下文/最大输出/模态/推理档位", async () => {
  // 形态取自 WorkBuddy 网关真实响应：自建网关会声明自己的参数（可能与官方不同）。
  const discovery = new ProviderModelsDiscovery({
    request: async () =>
      jsonResponse({
        data: [
          {
            id: "cn:hy4-preview",
            name: "Hy4 preview",
            context_length: 1000000,
            max_allowed_size: 1000000,
            max_output_tokens: 64000,
            supports_images: true,
            supports_reasoning: true,
            supports_tool_call: true,
            reasoning_supported_efforts: ["high"],
          },
          {
            id: "cn:no-reasoning",
            name: "No Reasoning",
            context_window: 131072,
            max_tokens: "8192",
            supports_vision: false,
            supports_reasoning: false,
          },
          // 脏数据：非法数值/类型不应写入，交给上层回退。
          { id: "cn:bad-values", context_length: -1, max_output_tokens: "abc", supports_images: "yes" },
        ],
      }),
  });
  const result = await discovery.discover({
    baseUrl: "http://192.168.5.2:7863/v1",
    apiType: "openai-chat-completions",
  });
  const hy4 = result.models.find((model) => model.id === "cn:hy4-preview");
  assert.equal(hy4?.contextWindow, 1000000);
  assert.equal(hy4?.maxOutputTokens, 64000);
  assert.equal(hy4?.supportsImages, true);
  assert.equal(hy4?.supportsReasoning, true);
  assert.deepEqual(hy4?.reasoningLevels, ["high"]);
  assert.equal(hy4?.name, "Hy4 preview");

  const plain = result.models.find((model) => model.id === "cn:no-reasoning");
  assert.equal(plain?.contextWindow, 131072);
  assert.equal(plain?.maxOutputTokens, 8192);
  assert.equal(plain?.supportsImages, false);
  assert.equal(plain?.supportsReasoning, false);
  assert.equal(plain?.reasoningLevels, undefined);

  const bad = result.models.find((model) => model.id === "cn:bad-values");
  assert.equal(bad?.contextWindow, undefined);
  assert.equal(bad?.maxOutputTokens, undefined);
  assert.equal(bad?.supportsImages, undefined);
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("discover: openai data 数组形态", async () => {
  const discovery = new ProviderModelsDiscovery({
    request: async () =>
      jsonResponse({
        object: "list",
        data: [{ id: "gpt-4o" }, { id: "gpt-4o-mini", owned_by: "openai" }],
      }),
  });
  const result = await discovery.discover({
    baseUrl: "https://api.openai.com/v1",
    apiType: "openai-chat-completions",
    apiKey: "sk-test",
  });
  assert.deepEqual(
    result.models.map((model) => model.id),
    ["gpt-4o", "gpt-4o-mini"],
  );
  assert.equal(result.endpoint, "https://api.openai.com/v1/models");
});

test("discover: 根数组与对象字段形态归一", async () => {
  const discovery = new ProviderModelsDiscovery({
    request: async () =>
      jsonResponse([
        "model-a",
        { id: "model-b", display_name: "Model B" },
        { model: "model-c" },
      ]),
  });
  const result = await discovery.discover({
    baseUrl: "https://x.example/v1",
    apiType: "openai-chat-completions",
  });
  assert.deepEqual(
    result.models.map((model) => model.id),
    ["model-b", "model-a", "model-c"],
  );
  assert.equal(result.models[0]!.name, "Model B");
});

test("discover: 去重并保持排序", async () => {
  const discovery = new ProviderModelsDiscovery({
    request: async () =>
      jsonResponse({ data: [{ id: "a" }, { id: "b" }, { id: "a" }] }),
  });
  const result = await discovery.discover({
    baseUrl: "https://x.example/v1",
    apiType: "openai-chat-completions",
  });
  assert.deepEqual(
    result.models.map((model) => model.id),
    ["a", "b"],
  );
});

test("discover: HTTP 错误携带状态码与截断正文", async () => {
  const discovery = new ProviderModelsDiscovery({
    request: async () => jsonResponse({ error: { message: "invalid key" } }, 401),
  });
  await assert.rejects(
    () =>
      discovery.discover({
        baseUrl: "https://x.example/v1",
        apiType: "openai-chat-completions",
        apiKey: "bad",
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /401|invalid key/);
      return true;
    },
  );
});
