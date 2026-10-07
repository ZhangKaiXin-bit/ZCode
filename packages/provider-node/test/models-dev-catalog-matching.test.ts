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
  // openrouter 的显示名同为 Claude Sonnet 4.5，归一后也算命中（共 2 条）；
  // provider 线索仍把采信锁定在 anthropic，价格取 provider 而不是共识。
  const metadata = resolveModelsDevEntriesMetadata(catalog, {
    modelId: "claude-sonnet-4-5",
    providerId: "anthropic",
  });
  assert.equal(metadata.exactMatches, 2);
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

const solCatalog = [
  entry({
    providerId: "openai",
    providerName: "OpenAI",
    id: "gpt-6.1-sol",
    name: "GPT-6.1 Sol",
    contextWindow: 1050000,
    maxTokens: 128000,
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  }),
  entry({
    providerId: "nano-gpt",
    providerName: "NanoGPT",
    id: "openai/gpt-6.1-sol-pro",
    name: "GPT 6.1 Sol Pro",
    contextWindow: 1050000,
    maxTokens: 128000,
  }),
];

test("metadata: 空格/点号/大小写差异与显示名都能命中同一条目", () => {
  // 用户常直接粘显示名或换一种分隔符，归一化后必须等价于目录里的 id。
  for (const modelId of [
    "gpt-6.1-sol",
    "GPT 6.1 Sol",
    "GPT-6.1Sol",
    "gpt_6_1_sol",
    "models/gpt-6.1-sol",
    "gpt61sol",
  ]) {
    const metadata = resolveModelsDevEntriesMetadata(solCatalog, {
      modelId,
      providerId: "openai",
    });
    assert.equal(metadata.exactMatches, 1, `exactMatches for ${modelId}`);
    assert.equal(metadata.metadataMethod, "provider", `method for ${modelId}`);
    assert.equal(metadata.preset.contextWindow, 1050000, `context for ${modelId}`);
    assert.equal(metadata.preset.maxTokens, 128000, `maxTokens for ${modelId}`);
  }
});

test("metadata: 目录里只有带 provider 前缀的 -pro 变体时按显示名命中", () => {
  // 用户填裸 id "gpt-6.1-sol-pro"，目录只有 nano-gpt 的 "openai/gpt-6.1-sol-pro"，
  // 但它的显示名归一后与输入一致，因此仍是精确命中而不是候选。
  const metadata = resolveModelsDevEntriesMetadata(solCatalog, { modelId: "gpt-6.1-sol-pro" });
  assert.equal(metadata.exactMatches, 1);
  assert.equal(metadata.price.status, "unreliable");
  assert.equal(metadata.preset.contextWindow, 1050000);
});

test("metadata: 精确无命中时退化为候选列表（不再直接空面板）", () => {
  const candidateCatalog = [
    entry({
      providerId: "nano-gpt",
      providerName: "NanoGPT",
      id: "openai/gpt-6.1-sol-pro",
      name: "Pro Sol（NanoGPT）",
      contextWindow: 1050000,
      maxTokens: 128000,
    }),
    entry({
      providerId: "openai",
      providerName: "OpenAI",
      id: "gpt-6.1-sol",
      name: "Sol 6.1",
      contextWindow: 1050000,
    }),
  ];
  const metadata = resolveModelsDevEntriesMetadata(candidateCatalog, { modelId: "gpt-6.1-sol-pro" });
  assert.equal(metadata.exactMatches, 0);
  assert.equal(metadata.metadataMethod, "none");
  assert.equal(metadata.preset.contextWindow, undefined);
  const candidates = metadata.candidates ?? [];
  assert.ok(candidates.length >= 2);
  // 包含查询键的条目（rank 2）排在仅被查询键包含的缩短候选（rank 3）前面。
  assert.equal(candidates[0]!.id, "openai/gpt-6.1-sol-pro");
  assert.equal(candidates[0]!.providerId, "nano-gpt");
  assert.equal(candidates[1]!.id, "gpt-6.1-sol");
});

test("metadata: 完全无关的输入不给候选", () => {
  const metadata = resolveModelsDevEntriesMetadata(solCatalog, { modelId: "totally-unrelated" });
  assert.equal(metadata.exactMatches, 0);
  assert.equal(metadata.candidates, undefined);
});

test("metadata: 版本号打错时用相似度给出近似候选", () => {
  // 目录里只有 6.1，输入 6.2：精确无命中，但应给出 6.1 作为候选让用户挑。
  const metadata = resolveModelsDevEntriesMetadata(solCatalog, {
    modelId: "gpt-6.2-sol",
    providerId: "openai",
  });
  assert.equal(metadata.exactMatches, 0);
  const candidates = metadata.candidates ?? [];
  assert.ok(candidates.some((candidate) => candidate.id === "gpt-6.1-sol"));
});

test("metadata: 结构化输出/推理档位/PDF 随元数据一起返回", () => {
  const withCapabilities = [
    entry({
      providerId: "openai",
      providerName: "OpenAI",
      id: "gpt-6.1-sol",
      name: "GPT-6.1 Sol",
      contextWindow: 1050000,
      maxTokens: 128000,
      reasoning: true,
      structuredOutput: true,
      reasoningLevels: ["low", "medium", "high", "xhigh", "max"],
      input: ["text", "image", "pdf"],
    }),
  ];
  const metadata = resolveModelsDevEntriesMetadata(withCapabilities, {
    modelId: "GPT-6.1 Sol",
    providerId: "openai",
  });
  assert.equal(metadata.exactMatches, 1);
  assert.equal(metadata.preset.contextWindow, 1050000);
  assert.equal(metadata.preset.maxTokens, 128000);
  assert.equal(metadata.preset.structuredOutput, true);
  assert.deepEqual(metadata.preset.reasoningLevels, ["low", "medium", "high", "xhigh", "max"]);
  assert.deepEqual(metadata.preset.input, ["text", "image", "pdf"]);
});

test("candidate: 候选里也带结构化输出与推理档位", () => {
  const candidateCatalog = [
    entry({
      providerId: "openai",
      providerName: "OpenAI",
      id: "gpt-6.1-sol",
      name: "GPT-6.1 Sol",
      structuredOutput: true,
      reasoningLevels: ["low", "high"],
      input: ["text", "image", "pdf"],
    }),
  ];
  const metadata = resolveModelsDevEntriesMetadata(candidateCatalog, { modelId: "gpt-6.2-sol" });
  assert.equal(metadata.exactMatches, 0);
  const candidate = (metadata.candidates ?? [])[0];
  assert.ok(candidate);
  assert.equal(candidate.structuredOutput, true);
  assert.deepEqual(candidate.reasoningLevels, ["low", "high"]);
  assert.deepEqual(candidate.input, ["text", "image", "pdf"]);
});
