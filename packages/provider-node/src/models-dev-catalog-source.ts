import {
  MODELS_DEV_CATALOG_URL,
  modelsDevCatalogEntrySchema,
  type ModelsDevCatalogEntry,
  type ModelsDevCatalogSearchParams,
  type ModelsDevCatalogSearchResult,
  type ModelsDevModelMetadata,
  type ModelsDevPrice,
  type ResolveModelsDevModelMetadataInput,
} from "@zcode/shared";
import { searchModelsDevCatalogEntries, resolveModelsDevEntriesMetadata } from "./models-dev-catalog-matching.js";

/**
 * models.dev 目录的下载与检索边界。
 *
 * - URL、预算、条目校验由 provider-node 唯一实现（对齐 zcode-builtin-download 边界）。
 * - 进程内缓存 1 小时；刷新失败时回退陈旧条目；在途请求去重。
 * - 目录只用于推荐展示，不写盘、不进入 Registry，无跨进程 lease 需求。
 */

const CATALOG_CACHE_TTL_MS = 60 * 60 * 1_000;
const CATALOG_TOTAL_BUDGET_MS = 20_000;
const CATALOG_BODY_LIMIT_BYTES = 20_000_000;

export interface ModelsDevCatalogSourceOptions {
  /** 注入的网络装配（Services 注入 ApiClient）；默认 globalThis.fetch 仅限测试。 */
  readonly request?: (url: string | URL, init: RequestInit) => Promise<Response>;
  readonly now?: () => number;
  readonly timeoutMs?: number;
}

interface CatalogCache {
  entries: ModelsDevCatalogEntry[];
  expiresAt: number;
  inFlight?: Promise<ModelsDevCatalogEntry[]>;
}

const globalCacheKey = Symbol.for("zcode.modelsDevCatalog.cache");

function globalCache(): CatalogCache {
  const holder = globalThis as { [key: symbol]: CatalogCache | undefined };
  const cache = holder[globalCacheKey];
  if (cache) return cache;
  const fresh: CatalogCache = { entries: [], expiresAt: 0 };
  holder[globalCacheKey] = fresh;
  return fresh;
}

export class ModelsDevCatalogSource {
  readonly #options: Required<Pick<ModelsDevCatalogSourceOptions, "request">> &
    ModelsDevCatalogSourceOptions;
  readonly #cache: CatalogCache;
  #disposed = false;

  constructor(options: ModelsDevCatalogSourceOptions = {}) {
    this.#options = { request: defaultRequest, ...options };
    this.#cache = globalCache();
  }

  dispose(): void {
    this.#disposed = true;
  }

  async search(
    params: ModelsDevCatalogSearchParams,
  ): Promise<ModelsDevCatalogSearchResult> {
    const entries = await this.#readEntries();
    const query = params.query.trim().toLocaleLowerCase();
    const providerId = params.providerId?.trim().toLocaleLowerCase();
    const limit = clampLimit(params.limit);
    const models = searchModelsDevCatalogEntries(entries, { query, providerId, limit });
    return Object.freeze({ models: Object.freeze(models), source: MODELS_DEV_CATALOG_URL });
  }

  async resolveModelMetadata(
    input: ResolveModelsDevModelMetadataInput,
  ): Promise<ModelsDevModelMetadata> {
    const entries = await this.#readEntries();
    return resolveModelsDevEntriesMetadata(entries, input);
  }

  async #readEntries(): Promise<ModelsDevCatalogEntry[]> {
    if (this.#disposed) throw new Error("ModelsDevCatalogSource 已 dispose");
    const cache = this.#cache;
    if (cache.entries.length > 0 && cache.expiresAt > (this.#options.now ?? Date.now)()) {
      return cache.entries;
    }
    cache.inFlight ??= this.#fetchEntries()
      .then((entries) => {
        cache.entries = entries;
        cache.expiresAt = (this.#options.now ?? Date.now)() + CATALOG_CACHE_TTL_MS;
        return entries;
      })
      .finally(() => {
        cache.inFlight = undefined;
      });
    try {
      return await cache.inFlight;
    } catch (error) {
      // 陈旧条目仍是合法推荐事实；刷新失败不能让设置页失去目录能力。
      if (cache.entries.length > 0) return cache.entries;
      throw error;
    }
  }

  async #fetchEntries(): Promise<ModelsDevCatalogEntry[]> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.#options.timeoutMs ?? CATALOG_TOTAL_BUDGET_MS);
    timer.unref?.();
    try {
      const response = await this.#options.request(MODELS_DEV_CATALOG_URL, {
        method: "GET",
        signal: controller.signal,
        credentials: "omit",
        redirect: "error",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        throw new Error(`models.dev 目录下载失败: HTTP ${response.status}`);
      }
      const entries = parseCatalogPayload(await readBodyJson(response, controller.signal));
      if (entries.length === 0) throw new Error("models.dev 目录为空");
      return entries;
    } catch (error) {
      const reason =
        controller.signal.aborted && timedOut
          ? "timeout"
          : error instanceof Error
            ? error.message
            : "invalid response";
      // 不把上游 URL / 正文交给上层日志。
      throw new Error(`models.dev 目录刷新失败: ${reason}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

function defaultRequest(url: string | URL, init: RequestInit): Promise<Response> {
  return globalThis.fetch(url, init);
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return 50;
  if (!Number.isFinite(limit)) return 50;
  return Math.max(1, Math.min(100, Math.floor(limit)));
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function parseCatalogPayload(payload: unknown): ModelsDevCatalogEntry[] {
  if (!isRecord(payload)) throw new Error("models.dev 目录必须是 JSON 对象");
  const entries: ModelsDevCatalogEntry[] = [];
  for (const [providerKey, provider] of Object.entries(payload)) {
    if (!isRecord(provider) || !isRecord(provider.models)) continue;
    const providerName =
      typeof provider.name === "string" && provider.name.trim() ? provider.name.trim() : providerKey;
    const providerBaseUrl =
      typeof provider.api === "string" && provider.api.trim() ? provider.api.trim() : undefined;
    for (const [modelKey, model] of Object.entries(provider.models)) {
      if (!isRecord(model)) continue;
      const id = typeof model.id === "string" && model.id.trim() ? model.id.trim() : modelKey;
      if (!id) continue;
      const name =
        typeof model.name === "string" && model.name.trim() ? model.name.trim() : id;
      const parsed = modelsDevCatalogEntrySchema.safeParse({
        key: `${providerKey}/${id}`,
        providerId: providerKey,
        providerName,
        id,
        name,
        cost: parseCost(model.cost),
        ...(providerBaseUrl ? { providerBaseUrl } : {}),
        ...(typeof model.reasoning === "boolean" ? { reasoning: model.reasoning } : {}),
        ...(typeof model.structured_output === "boolean"
          ? { structuredOutput: model.structured_output }
          : {}),
        ...(parseReasoningLevels(model) === undefined
          ? {}
          : { reasoningLevels: parseReasoningLevels(model) }),
        ...parseInputModalities(model.modalities),
        ...parseLimits(model.limit),
      });
      if (parsed.success) entries.push(parsed.data);
    }
  }
  return entries;
}

function parseCost(cost: unknown): ModelsDevCatalogEntry["cost"] {
  if (!isRecord(cost)) return null;
  const pick = (key: string): number | undefined => {
    const value = cost[key];
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
  };
  const input = pick("input");
  const output = pick("output");
  if (input === undefined || output === undefined) return null;
  return {
    input,
    output,
    cacheRead: pick("cache_read") ?? 0,
    cacheWrite: pick("cache_write") ?? 0,
  };
}

/**
 * 目录里的 `reasoning_options` 决定设置页「推理等级」候选：
 * - `effort` 直接给出档位（low/medium/high/...）
 * - `toggle` 只表示可开关，按本产品约定映射成 disabled/enabled
 * - 模型明确不支持推理时只保留 disabled，避免出现能选但无效的档位
 */
function parseReasoningLevels(model: Record<string, unknown>): ReadonlyArray<string> | undefined {
  const options = model.reasoning_options;
  if (Array.isArray(options)) {
    for (const option of options) {
      if (!isRecord(option) || option.type !== "effort") continue;
      if (!Array.isArray(option.values)) continue;
      const values = [
        ...new Set(
          option.values
            .filter((value): value is string => typeof value === "string")
            .map((value) => value.trim())
            .filter((value) => value.length > 0),
        ),
      ];
      if (values.length > 0) return values;
    }
    if (options.some((option) => isRecord(option) && option.type === "toggle")) {
      return ["disabled", "enabled"];
    }
  }
  return model.reasoning === false ? ["disabled"] : undefined;
}

function parseInputModalities(
  modalities: unknown,
): { input?: ReadonlyArray<"text" | "image" | "pdf"> } {
  if (!isRecord(modalities) || !Array.isArray(modalities.input)) return {};
  const allowed = new Set(["text", "image", "pdf"]);
  const input = [
    ...new Set(
      modalities.input
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().toLocaleLowerCase())
      .filter((item) => allowed.has(item)),
    ),
  ] as ReadonlyArray<"text" | "image" | "pdf">;
  return input.length > 0 ? { input } : {};
}

function parseLimits(limit: unknown): {
  contextWindow?: number;
  maxTokens?: number;
} {
  if (!isRecord(limit)) return {};
  const context = typeof limit.context === "number" ? limit.context : undefined;
  const output = typeof limit.output === "number" ? limit.output : undefined;
  return {
    ...(Number.isInteger(context) && context !== undefined && context > 0
      ? { contextWindow: context }
      : {}),
    ...(Number.isInteger(output) && output !== undefined && output > 0 ? { maxTokens: output } : {}),
  };
}

async function readBodyJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("empty body");
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > CATALOG_BODY_LIMIT_BYTES) throw new Error("body limit exceeded");
      chunks.push(decoder.decode(part.value, { stream: true }));
    }
    chunks.push(decoder.decode());
    signal.throwIfAborted();
    return JSON.parse(chunks.join("")) as unknown;
  } finally {
    reader.releaseLock();
  }
}

export type { ModelsDevPrice };
