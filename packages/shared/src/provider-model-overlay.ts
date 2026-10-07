import type { DiscoveredProviderModel, ModelsDevModelMetadata } from "./models-dev-catalog.js";

/**
 * 添加模型时要写入的 Personal Overlay 事实：只包含确实拿到的字段。
 * 形状与 Provider 的 ModelConfigObject 对齐，便于调用方直接落盘。
 */
export interface ProviderModelOverlay {
  readonly properties?: {
    readonly contextWindow?: number;
    readonly inputFormat?: {
      readonly supportsText?: boolean;
      readonly supportsImage?: boolean;
      readonly supportsVideo?: boolean;
      readonly supportsAudio?: boolean;
      readonly supportsPdf?: boolean;
    };
    readonly supportsJsonSchemaOutput?: boolean;
  };
  readonly optionSpecs?: {
    readonly maxOutputTokens?: { readonly max?: number };
    readonly reasoningLevel?: { readonly values?: readonly string[] };
  };
}

export type UpstreamModelFacts = Pick<
  DiscoveredProviderModel,
  "contextWindow" | "maxOutputTokens" | "supportsImages" | "supportsReasoning" | "reasoningLevels"
>;

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function normalizeLevels(values: readonly string[] | null | undefined): string[] | undefined {
  if (!values) return undefined;
  const levels = [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
  return levels.length > 0 ? levels : undefined;
}

/**
 * 合并模型元数据，优先级：**上游自报 → models.dev 目录 → 内置规则**（内置由调用方在缺项时兜底）。
 *
 * 自建/中转网关经常把官方模型换成自部署版本，上下文与能力参数和官方并不一致，
 * 所以上游 /models 自报的值优先；上游没给的字段才用目录共识补，避免用官方口径覆盖实际网关。
 */
export function buildProviderModelOverlay(
  upstream: UpstreamModelFacts | undefined,
  modelsDev: ModelsDevModelMetadata["preset"] | undefined,
): ProviderModelOverlay | undefined {
  const contextWindow =
    positiveInteger(upstream?.contextWindow) ?? positiveInteger(modelsDev?.contextWindow);
  const maxTokens = positiveInteger(upstream?.maxOutputTokens) ?? positiveInteger(modelsDev?.maxTokens);

  const upstreamImages =
    typeof upstream?.supportsImages === "boolean" ? upstream.supportsImages : undefined;
  const modelsDevInput = modelsDev?.input ?? undefined;
  const supportsImage =
    upstreamImages ?? (modelsDevInput ? modelsDevInput.includes("image") : undefined);
  const supportsPdf = modelsDevInput ? modelsDevInput.includes("pdf") : undefined;

  const reasoningLevels =
    normalizeLevels(upstream?.reasoningLevels) ??
    (upstream?.supportsReasoning === false ? ["disabled"] : undefined) ??
    normalizeLevels(modelsDev?.reasoningLevels);

  const structuredOutput =
    typeof modelsDev?.structuredOutput === "boolean" ? modelsDev.structuredOutput : undefined;

  const properties: NonNullable<ProviderModelOverlay["properties"]> = {
    ...(contextWindow === undefined ? {} : { contextWindow }),
    ...(supportsImage === undefined && supportsPdf === undefined
      ? {}
      : {
          inputFormat: {
            supportsText: true,
            ...(supportsImage === undefined ? {} : { supportsImage }),
            ...(supportsPdf === undefined ? {} : { supportsPdf }),
          },
        }),
    ...(structuredOutput === undefined ? {} : { supportsJsonSchemaOutput: structuredOutput }),
  };
  const optionSpecs: NonNullable<ProviderModelOverlay["optionSpecs"]> = {
    ...(maxTokens === undefined ? {} : { maxOutputTokens: { max: maxTokens } }),
    ...(reasoningLevels === undefined ? {} : { reasoningLevel: { values: reasoningLevels } }),
  };

  if (Object.keys(properties).length === 0 && Object.keys(optionSpecs).length === 0) {
    return undefined;
  }
  return {
    ...(Object.keys(properties).length > 0 ? { properties } : {}),
    ...(Object.keys(optionSpecs).length > 0 ? { optionSpecs } : {}),
  };
}
