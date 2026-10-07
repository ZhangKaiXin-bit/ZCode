import assert from "node:assert/strict";
import test from "node:test";
import { ModelsDevCatalogSource } from "../src/models-dev-catalog-source.js";

function sourceFor(payload: unknown): ModelsDevCatalogSource {
  return new ModelsDevCatalogSource({
    request: async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  });
}

test("catalog source: 解析上下文/最大输出/模态/结构化输出/推理档位", async () => {
  const source = sourceFor({
    openai: {
      name: "OpenAI",
      api: "https://api.openai.com/v1",
      models: {
        "gpt-6.1-sol": {
          id: "gpt-6.1-sol",
          name: "GPT-6.1 Sol",
          reasoning: true,
          reasoning_options: [{ type: "effort", values: ["low", "medium", "high", "xhigh", "max"] }],
          structured_output: true,
          modalities: { input: ["text", "image", "pdf"], output: ["text"] },
          limit: { context: 1050000, input: 922000, output: 128000 },
          cost: { input: 2, output: 10, cache_read: 0.1, cache_write: 2.5 },
        },
        "toggle-model": {
          id: "toggle-model",
          name: "Toggle Model",
          reasoning: true,
          reasoning_options: [{ type: "toggle" }],
        },
        "no-reasoning-model": { id: "no-reasoning-model", name: "No Reasoning", reasoning: false },
      },
    },
  });

  const metadata = await source.resolveModelMetadata({
    modelId: "gpt-6.1-sol",
    providerId: "openai",
  });
  assert.equal(metadata.preset.contextWindow, 1050000);
  assert.equal(metadata.preset.maxTokens, 128000);
  assert.deepEqual(metadata.preset.input, ["text", "image", "pdf"]);
  assert.equal(metadata.preset.structuredOutput, true);
  assert.deepEqual(metadata.preset.reasoningLevels, ["low", "medium", "high", "xhigh", "max"]);
  assert.equal(metadata.price.status, "reliable");

  // toggle 型推理按本产品约定落成 disabled/enabled；明确不支持推理的模型只留 disabled。
  const toggle = await source.resolveModelMetadata({ modelId: "toggle-model" });
  assert.deepEqual(toggle.preset.reasoningLevels, ["disabled", "enabled"]);

  const noReasoning = await source.resolveModelMetadata({ modelId: "no-reasoning-model" });
  assert.deepEqual(noReasoning.preset.reasoningLevels, ["disabled"]);
});
