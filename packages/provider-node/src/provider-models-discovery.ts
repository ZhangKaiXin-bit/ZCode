import type {
  DiscoverProviderModelsInput,
  DiscoverProviderModelsResult,
  DiscoveredProviderModel,
} from "@zcode/shared";

/**
 * 从 Provider 的兼容端点自动发现模型 ID 列表（OpenAI /models、Anthropic /v1/models）。
 * 语义对齐 pi-web 的 models-config/discover：按 API 格式补版本段与 /models 路径，
 * 鉴权头按格式注入，响应兼容 data/models/results/items 多种形态。
 */

const DISCOVER_TIMEOUT_MS = 20_000;

export interface ProviderModelsDiscoveryOptions {
  /** 注入的网络装配；默认 globalThis.fetch 仅限测试。 */
  readonly request?: (url: string | URL, init: RequestInit) => Promise<Response>;
}

export class ProviderModelsDiscovery {
  readonly #request: (url: string | URL, init: RequestInit) => Promise<Response>;

  constructor(options: ProviderModelsDiscoveryOptions = {}) {
    this.#request = options.request ?? ((url, init) => globalThis.fetch(url, init));
  }

  async discover(input: DiscoverProviderModelsInput): Promise<DiscoverProviderModelsResult> {
    const endpoint = buildModelsEndpointUrl(input.baseUrl, input.apiType);
    const headers = buildAuthHeaders(input.apiType, input.apiKey);
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, DISCOVER_TIMEOUT_MS);
    timer.unref?.();
    try {
      const response = await this.#request(endpoint, {
        method: "GET",
        signal: controller.signal,
        credentials: "omit",
        headers: { Accept: "application/json", ...headers },
      });
      if (!response.ok) {
        const bodyText = (await response.text()).slice(0, 500);
        throw new ProviderModelsDiscoveryError(
          bodyText || `Upstream returned HTTP ${response.status}`,
          response.status,
        );
      }
      const payload: unknown = await response.json();
      const models = parseModelList(payload);
      return { models: Object.freeze(models), endpoint };
    } catch (error) {
      if (error instanceof ProviderModelsDiscoveryError) throw error;
      const reason =
        controller.signal.aborted && timedOut ? "请求超时" : error instanceof Error ? error.message : String(error);
      throw new Error(`上游模型列表拉取失败: ${reason}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

export class ProviderModelsDiscoveryError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "ProviderModelsDiscoveryError";
    this.status = status;
  }
}

export function buildModelsEndpointUrl(
  baseUrl: string,
  apiType: DiscoverProviderModelsInput["apiType"],
): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Base URL 无效");
  }
  const path = parsed.pathname.replace(/\/+$/, "");
  if (!path.endsWith("/models")) {
    const segments = path.split("/").filter((segment) => segment.length > 0);
    const last = segments.at(-1);
    if (apiType === "anthropic-messages" && !(last === "v1" || /^v\d+beta$/.test(last ?? ""))) {
      parsed.pathname = `${path}/v1/models`;
    } else if (apiType === "openai-responses" && last !== "v1" && last !== undefined) {
      // Responses 端点族没有独立的版本前缀约定；沿用原路径直接追加 /models。
      parsed.pathname = `${path}/models`;
    } else {
      parsed.pathname = `${path}/models`;
    }
  }
  if (apiType === "anthropic-messages" && !parsed.searchParams.has("limit")) {
    parsed.searchParams.set("limit", "1000");
  }
  return parsed.toString();
}

function buildAuthHeaders(
  apiType: DiscoverProviderModelsInput["apiType"],
  apiKey: string | undefined,
): Record<string, string> {
  if (!apiKey?.trim()) return {};
  const token = apiKey.trim();
  if (apiType === "anthropic-messages") {
    return { "x-api-key": token, "anthropic-version": "2023-06-01" };
  }
  return { Authorization: `Bearer ${token}` };
}

function parseModelList(payload: unknown): DiscoveredProviderModel[] {
  const candidates = extractModelItems(payload);
  const seen = new Set<string>();
  const models: DiscoveredProviderModel[] = [];
  for (const item of candidates) {
    const model = parseModelItem(item);
    if (!model || seen.has(model.id)) continue;
    seen.add(model.id);
    models.push(model);
  }
  return models.sort((left, right) =>
    (left.name ?? left.id).localeCompare(right.name ?? right.id, undefined, { numeric: true }),
  );
}

function extractModelItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (typeof payload !== "object" || payload === null) return [];
  const record = payload as Record<string, unknown>;
  for (const key of ["data", "models", "results", "items"]) {
    const value = record[key];
    if (Array.isArray(value)) return value;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      // 某些网关把模型挂在对象 value 上；仅当值为对象时展开其 values。
      const nested = Object.values(value as Record<string, unknown>);
      if (nested.length > 0 && nested.every((item) => typeof item === "object" && item !== null)) {
        return nested;
      }
    }
  }
  return [];
}

function parseModelItem(item: unknown): DiscoveredProviderModel | undefined {
  if (typeof item === "string") {
    const id = item.trim();
    return id ? { id } : undefined;
  }
  if (typeof item !== "object" || item === null) return undefined;
  const record = item as Record<string, unknown>;
  const rawId = record.id ?? record.model ?? record.name;
  if (typeof rawId !== "string") return undefined;
  const id = rawId.trim().replace(/^models\//, "");
  if (!id) return undefined;
  const displayName = record.display_name ?? record.displayName;
  const name =
    typeof displayName === "string" && displayName.trim()
      ? displayName.trim()
      : typeof record.name === "string" && record.name.trim()
        ? record.name.trim()
        : undefined;
  return name ? { id, name } : { id };
}
