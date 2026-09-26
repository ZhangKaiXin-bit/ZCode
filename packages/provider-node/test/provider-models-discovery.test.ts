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
