import { z } from "zod";

/**
 * models.dev 公共模型目录的数据合同。
 *
 * 目录只承载“推荐事实”（元数据与价格），不落盘、不进入 Provider Registry；
 * 用户确认填充后仍走 Personal Provider Overlay 的唯一写边界。
 * 上游形态: https://models.dev/api.json -> { [providerId]: { name?, api?, models: { [id]: {...} } } }
 */

export const MODELS_DEV_CATALOG_URL = "https://models.dev/api.json";

/**
 * 目录里可表达、且本产品输入类型控件能承载的模态。视频/音频目录里不提供，保持不支持。
 */
export const MODELS_DEV_INPUT_MODALITIES = ["text", "image", "pdf"] as const;

const modelsDevInputModalitiesSchema = z
  .array(z.enum(MODELS_DEV_INPUT_MODALITIES))
  .readonly()
  .nullable()
  .optional();

/** 推理等级取值列表（按推理强度从低到高），与设置页「推理等级」同语义。 */
const modelsDevReasoningLevelsSchema = z
  .array(z.string().min(1))
  .readonly()
  .nullable()
  .optional();

/** models.dev 目录的原始条目（只保留本产品消费的字段，其余字段在下载边界丢弃）。 */
export const modelsDevCatalogEntrySchema = z
  .object({
    key: z.string().min(1),
    providerId: z.string().min(1),
    providerName: z.string().min(1),
    id: z.string().min(1),
    name: z.string().min(1),
    /** 每百万 Token 的美元单价；缺失表示该条目无价格事实。 */
    cost: z
      .object({
        input: z.number().nonnegative(),
        output: z.number().nonnegative(),
        cacheRead: z.number().nonnegative(),
        cacheWrite: z.number().nonnegative(),
      })
      .strict()
      .nullable()
      .optional(),
    providerBaseUrl: z.string().min(1).nullable().optional(),
    reasoning: z.boolean().nullable().optional(),
    input: modelsDevInputModalitiesSchema,
    structuredOutput: z.boolean().nullable().optional(),
    reasoningLevels: modelsDevReasoningLevelsSchema,
    contextWindow: z.number().int().positive().nullable().optional(),
    maxTokens: z.number().int().positive().nullable().optional(),
  })
  .strict();

export type ModelsDevCatalogEntry = z.infer<typeof modelsDevCatalogEntrySchema>;

/** 目录搜索的排序键；rank 越小越靠前，rank === 20 表示不匹配。 */
export interface ModelsDevCatalogRankedEntry {
  readonly entry: ModelsDevCatalogEntry;
  readonly rank: number;
}

export interface ModelsDevCatalogSearchParams {
  /** 模糊搜索词；空串表示按 provider 前缀列条目。 */
  readonly query: string;
  /** 精确 providerId 过滤（大小写不敏感）。 */
  readonly providerId?: string;
  /** 返回条数上限。 */
  readonly limit?: number;
}

export interface ModelsDevCatalogSearchResult {
  readonly models: readonly ModelsDevCatalogEntry[];
  readonly source: string;
}

/** 元数据匹配方法：provider 精确 > base-url 精确 > 跨家共识。 */
export type ModelsDevMetadataMethod = "provider" | "base-url" | "consensus" | "none";

/** 价格置信度：单条精确匹配或强共识才视为可靠。 */
export const modelsDevPriceSchema = z
  .object({
    status: z.enum(["reliable", "unreliable"]),
    method: z.enum(["provider", "base-url", "consensus"]).nullable().optional(),
    reason: z.enum(["no-exact-match", "no-valid-price", "insufficient-support", "conflict"])
      .nullable()
      .optional(),
    cost: z
      .object({
        input: z.number().nonnegative(),
        output: z.number().nonnegative(),
        cacheRead: z.number().nonnegative(),
        cacheWrite: z.number().nonnegative(),
      })
      .strict()
      .nullable()
      .optional(),
    support: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  })
  .strict();

export type ModelsDevPrice = z.infer<typeof modelsDevPriceSchema>;

/**
 * 精确未命中时的近似候选。只用于展示与“用户点选后填入”，不参与自动采信，
 * 因此不带 price 置信度，只带条目自身的原始事实。
 */
export const modelsDevCatalogCandidateSchema = z
  .object({
    id: z.string().min(1),
    providerId: z.string().min(1),
    providerName: z.string().min(1),
    name: z.string().min(1),
    reasoning: z.boolean().nullable().optional(),
    input: modelsDevInputModalitiesSchema,
    structuredOutput: z.boolean().nullable().optional(),
    reasoningLevels: modelsDevReasoningLevelsSchema,
    contextWindow: z.number().int().positive().nullable().optional(),
    maxTokens: z.number().int().positive().nullable().optional(),
    cost: modelsDevPriceSchema.shape.cost,
  })
  .strict();

export type ModelsDevCatalogCandidate = z.infer<typeof modelsDevCatalogCandidateSchema>;

/** 依据一个模型 ID（可选 provider / baseUrl 线索）得到的元数据推荐。 */
export const modelsDevModelMetadataSchema = z
  .object({
    exactMatches: z.number().int().nonnegative(),
    metadataMethod: z.enum(["provider", "base-url", "consensus", "none"]),
    matchedProviderId: z.string().min(1).nullable().optional(),
    matchedProviderName: z.string().min(1).nullable().optional(),
    /** 精确无命中时给出的 models.dev 近似候选（最多 5 条），供用户手选。 */
    candidates: z.array(modelsDevCatalogCandidateSchema).readonly().nullable().optional(),
    preset: z
      .object({
        name: z.string().min(1).nullable().optional(),
        reasoning: z.boolean().nullable().optional(),
        input: modelsDevInputModalitiesSchema,
        structuredOutput: z.boolean().nullable().optional(),
        reasoningLevels: modelsDevReasoningLevelsSchema,
        contextWindow: z.number().int().positive().nullable().optional(),
        maxTokens: z.number().int().positive().nullable().optional(),
        cost: modelsDevPriceSchema.shape.cost,
      })
      .strict(),
    price: modelsDevPriceSchema,
  })
  .strict();

export type ModelsDevModelMetadata = z.infer<typeof modelsDevModelMetadataSchema>;

export interface ResolveModelsDevModelMetadataInput {
  /** 用户输入的模型 ID（原文，允许带 models/ 前缀）。 */
  readonly modelId: string;
  /** 当前 Provider 的 providerId；命中同目录家时优先采信。 */
  readonly providerId?: string;
  /** 当前 Provider 的 baseUrl；命中同域目录家时优先采信。 */
  readonly baseUrl?: string;
}

/** 从 Provider 的 OpenAI/Anthropic 兼容端点自动发现模型 ID 列表。 */
export interface DiscoverProviderModelsInput {
  /** Provider 的 baseUrl（形如 https://api.example.com/v1）。 */
  readonly baseUrl: string;
  /** API 格式决定 /models 路径与鉴权头的拼装。 */
  readonly apiType: "anthropic-messages" | "openai-chat-completions" | "openai-responses";
  /** 可选 API Key；仅用于本次发现请求，不落盘。 */
  readonly apiKey?: string;
}

export interface DiscoveredProviderModel {
  readonly id: string;
  readonly name?: string;
}

export interface DiscoverProviderModelsResult {
  readonly models: readonly DiscoveredProviderModel[];
  /** 实际请求的模型列表端点，便于诊断与展示。 */
  readonly endpoint: string;
}
