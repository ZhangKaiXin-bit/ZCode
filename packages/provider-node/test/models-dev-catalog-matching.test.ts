import assert from "node:assert/strict";
import test from "node:test";
import type {
  ModelsDevCatalogEntry,
  ModelsDevModelMetadata,
} from "@zcode/shared";
import {
  resolveModelsDevEntriesMetadata,
  searchModelsDevCatalogEntries,
} from "../src/models-dev-catalog-matching.js";

function entry(overrides: Partial<ModelsDevCatalogEntry> & { providerId: string; id: string }): ModelsDevCatalogEntry {
  return {
    key: `${overrides.providerId}/${overrides.id}`,
    providerName: overrides.providerId,
    id: overrides.id,
    name: overrides.id,
    ...overrides,
  };
}

const catalog = [
  entry({
    providerId: "openai",
    providerName: "OpenAI",
    id: "gpt-4o",
    name: "GPT-4o",
    providerBaseUrl: "https://api.openai.com/v1",
    contextWindow: 128000,
    maxTokens: 16384,
    input: ["text", "image"],
    cost: { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 2.5 },
  }),
  entry({
    providerId: "azure",
    providerName: "Azure OpenAI",
    id: "gpt-4o",
    name: "GPT-4o",
    contextWindow: 128000,
    maxTokens: 16384,
    cost: { input: 2.5, output: 10, cacheRead: 0, cacheWrite: 0 },
  }),
  entry({
    providerId: "anthropic",
    providerName: "Anthropic",
    id: "claude-sonnet-4-5",
    name: "Claude Sonnet 4.5",
    providerBaseUrl: "https://api.anthropic.com",
    reasoning: true,
    contextWindow: 200000,
    maxTokens: 64000,
    input: ["text", "image"],
    cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  }),
  entry({
    providerId: "openrouter",
    providerName: "OpenRouter",
    id: "anthropic/claude-sonnet-4-5",
    name: "Claude Sonnet 4.5",
    providerBaseUrl: "https://openrouter.ai/api/v1",
    reasoning: true,
    contextWindow: 200000,
    maxTokens: 64000,
  }),
  entry({
    providerId: "deepseek",
    providerName: "DeepSeek",
    id: "deepseek-chat",
    name: "DeepSeek Chat",
    contextWindow: 64000,
    maxTokens: 8192,
    cost: { input: 0.14, output: 0.28, cacheRead: 0.014, cacheWrite: 0.14 },
  }),
];

test("search: 空查询按 provider/name 排序并限量", () => {
  const results = searchModelsDevCatalogEntries(catalog, { query: "", limit: 2 });
  assert.equal(results.length, 2);
  assert.ok(
    results[0]!.providerName.localeCompare(results[1]!.providerName, undefined, {
      sensitivity: "base",
    }) <= 0,
  );
});

test("search: 精确 ID 命中 rank 并列时按 providerName 字母序", () => {
  // pi-web 语义：rank 相同（都是精确命中）时按 providerName 升序。
  const results = searchModelsDevCatalogEntries(catalog, { query: "gpt-4o", limit: 10 });
  assert.equal(results[0]!.id, "gpt-4o");
  assert.equal(results[0]!.providerName, "Azure OpenAI");
});

test("search: providerId 线索在同 rank 时优先", () => {
  // anthropic 的 id 是精确命中(rank 0)；openrouter 的 id 带 anthropic/ 前缀只是包含(rank 4)，
  // providerId 加分只在其已匹配时生效，不能反超精确命中。
  const results = searchModelsDevCatalogEntries(catalog, {
    query: "claude-sonnet-4-5",
    providerId: "openrouter",
    limit: 10,
  });
  assert.equal(results[0]!.providerId, "anthropic");
  const openrouterIndex = results.findIndex((item) => item.providerId === "openrouter");
  const anthropicIndex = results.findIndex((item) => item.providerId === "anthropic");
  assert.ok(anthropicIndex >= 0 && openrouterIndex >= 0);
});

test("search: 模糊匹配包含 providerId/id 组合", () => {
  const results = searchModelsDevCatalogEntries(catalog, { query: "deepseek", limit: 10 });
  assert.equal(results.length, 1);
  assert.equal(results[0]!.providerId, "deepseek");
});

test("metadata: 无命中返回 none + 不可靠价格", () => {
  const metadata = resolveModelsDevEntriesMetadata(catalog, { modelId: "not-exist" });
  assert.equal(metadata.exactMatches, 0);
  assert.equal(metadata.metadataMethod, "none");
  assert.equal(metadata.price.status, "unreliable");
  assert.equal(metadata.preset.contextWindow, undefined);
});

test("metadata: 单条 provider 精确匹配可靠", () => {
  // openrouter 的 id 带 anthropic/ 前缀，不归一为裸 id；精确匹配只有 anthropic 一条。
  const metadata = resolveModelsDevEntriesMetadata(catalog, {
    modelId: "claude-sonnet-4-5",
    providerId: "anthropic",
  });
  assert.equal(metadata.exactMatches, 1);
  assert.equal(metadata.metadataMethod, "provider");
  assert.equal(metadata.preset.name, "Claude Sonnet 4.5");
  assert.equal(metadata.preset.contextWindow, 200000);
  assert.equal(metadata.preset.maxTokens, 64000);
  assert.deepEqual(metadata.preset.input, ["text", "image"]);
  assert.equal(metadata.price.status, "reliable");
  assert.equal(metadata.price.method, "provider");
  assert.deepEqual(metadata.price.cost, { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 });
});

test("metadata: baseUrl 命中同域 provider 优先", () => {
  const metadata = resolveModelsDevEntriesMetadata(catalog, {
    modelId: "gpt-4o",
    baseUrl: "https://api.openai.com/v1",
  });
  assert.equal(metadata.metadataMethod, "base-url");
  assert.equal(metadata.preset.contextWindow, 128000);
  assert.equal(metadata.price.method, "base-url");
  assert.deepEqual(metadata.price.cost, {
    input: 2.5,
    output: 10,
    cacheRead: 1.25,
    cacheWrite: 2.5,
  });
});

test("metadata: 跨家共识：两家同价时 consensus 可靠", () => {
  const metadata = resolveModelsDevEntriesMetadata(catalog, { modelId: "gpt-4o" });
  assert.equal(metadata.exactMatches, 2);
  assert.equal(metadata.metadataMethod, "consensus");
  assert.equal(metadata.preset.name, "GPT-4o");
  assert.equal(metadata.preset.contextWindow, 128000);
  assert.equal(metadata.price.status, "reliable");
  assert.equal(metadata.price.method, "consensus");
  assert.equal(metadata.price.cost?.input, 2.5);
  assert.equal(metadata.price.cost?.output, 10);
});

test("metadata: 共识冲突时价格不可靠", () => {
  const conflicting = [
    entry({ providerId: "a", id: "x", cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 } }),
    entry({ providerId: "b", id: "x", cost: { input: 3, output: 6, cacheRead: 0, cacheWrite: 0 } }),
  ];
  const metadata = resolveModelsDevEntriesMetadata(conflicting, { modelId: "x" });
  assert.equal(metadata.price.status, "unreliable");
  assert.equal(metadata.price.reason, "conflict");
});

test("metadata: models/ 前缀被归一", () => {
  const metadata: ModelsDevModelMetadata = resolveModelsDevEntriesMetadata(catalog, {
    modelId: "models/gpt-4o",
  });
  assert.equal(metadata.exactMatches, 2);
});

test("metadata: 单条精确命中直接采信（无分歧可裁）", () => {
  // deepseek-chat 仅一家提供：单条共识应返回该条的完整元数据（不应被多数派过滤吞掉）。
  const single = [
    entry({
      providerId: "deepseek",
      id: "deepseek-chat",
      name: "DeepSeek Chat",
      contextWindow: 64000,
      maxTokens: 8192,
      reasoning: true,
      cost: { input: 0.14, output: 0.28, cacheRead: 0.014, cacheWrite: 0.14 },
    }),
  ];
  const metadata = resolveModelsDevEntriesMetadata(single, { modelId: "deepseek-chat" });
  assert.equal(metadata.exactMatches, 1);
  assert.equal(metadata.metadataMethod, "consensus");
  assert.equal(metadata.preset.contextWindow, 64000);
  assert.equal(metadata.preset.maxTokens, 8192);
  assert.equal(metadata.preset.reasoning, true);
  // 单条价格仍保持 pi-web 的保守性：无佐证即不可靠，不混入 preset。
  assert.equal(metadata.price.status, "unreliable");
  assert.equal(metadata.price.reason, "insufficient-support");
});
