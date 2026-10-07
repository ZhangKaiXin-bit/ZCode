import assert from "node:assert/strict";
import test from "node:test";
import { buildProviderModelOverlay } from "@zcode/shared";

test("overlay: 上游自报优先于 models.dev 目录", () => {
  const overlay = buildProviderModelOverlay(
    {
      contextWindow: 512000,
      maxOutputTokens: 524288,
      supportsImages: true,
      supportsReasoning: true,
      reasoningLevels: ["medium"],
    },
    {
      contextWindow: 1050000,
      maxTokens: 128000,
      input: ["text", "image", "pdf"],
      structuredOutput: true,
      reasoningLevels: ["low", "high"],
    },
  );
  assert.deepEqual(overlay, {
    properties: {
      contextWindow: 512000,
      inputFormat: { supportsText: true, supportsImage: true, supportsPdf: true },
      supportsJsonSchemaOutput: true,
    },
    optionSpecs: {
      maxOutputTokens: { max: 524288 },
      reasoningLevel: { values: ["medium"] },
    },
  });
});

test("overlay: 上游缺项回退 models.dev", () => {
  const overlay = buildProviderModelOverlay({ contextWindow: 200000 }, {
    maxTokens: 128000,
    input: ["text"],
    structuredOutput: false,
  });
  assert.deepEqual(overlay, {
    properties: {
      contextWindow: 200000,
      inputFormat: { supportsText: true, supportsImage: false, supportsPdf: false },
      supportsJsonSchemaOutput: false,
    },
    optionSpecs: { maxOutputTokens: { max: 128000 } },
  });
});

test("overlay: 上游明确不支持推理时只留 disabled 档", () => {
  const overlay = buildProviderModelOverlay({ supportsReasoning: false, contextWindow: 131072 }, undefined);
  assert.deepEqual(overlay, {
    properties: { contextWindow: 131072 },
    optionSpecs: { reasoningLevel: { values: ["disabled"] } },
  });
});

test("overlay: 没有任何可用事实时返回 undefined", () => {
  assert.equal(buildProviderModelOverlay(undefined, undefined), undefined);
  assert.equal(buildProviderModelOverlay({ contextWindow: -5, maxOutputTokens: 0 }, {}), undefined);
});
