import type {
  ModelsDevCatalogEntry,
  ModelsDevModelMetadata,
  ModelsDevMetadataMethod,
  ModelsDevPrice,
  ResolveModelsDevModelMetadataInput,
} from "@zcode/shared";

/**
 * models.dev 目录的纯匹配逻辑（无 IO）：搜索排序、精确匹配、价格共识。
 * 语义对齐 pi-web 的 catalog recommendation engine。
 */

/** 已知 Provider 家族的官方 host，用于 baseUrl 匹配时优先采信。 */
const KNOWN_PROVIDER_HOSTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  anthropic: Object.freeze(["api.anthropic.com"]),
  google: Object.freeze(["generativelanguage.googleapis.com"]),
  openai: Object.freeze(["api.openai.com"]),
  openrouter: Object.freeze(["openrouter.ai"]),
});

/** rank 语义与 pi-web 一致：0 精确命中 … 10 无关；20 为不匹配哨兵值。 */
const RANK_UNMATCHED = 20;

interface SearchOptions {
  readonly query: string;
  readonly providerId?: string;
  readonly limit: number;
}

export function searchModelsDevCatalogEntries(
  entries: readonly ModelsDevCatalogEntry[],
  options: SearchOptions,
): ModelsDevCatalogEntry[] {
  const { query, providerId, limit } = options;
  const ranked = entries.map((entry) => ({
    entry,
    rank: rankEntry(entry, query, providerId),
  }));
  const matching = ranked
    .filter((item) => item.rank < RANK_UNMATCHED)
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        left.entry.providerName.localeCompare(right.entry.providerName, undefined, {
          sensitivity: "base",
        }) ||
        left.entry.name.localeCompare(right.entry.name, undefined, {
          numeric: true,
          sensitivity: "base",
        }) ||
        left.entry.id.localeCompare(right.entry.id, undefined, {
          numeric: true,
          sensitivity: "base",
        }),
    );
  return matching.slice(0, limit).map((item) => item.entry);
}

function rankEntry(
  entry: ModelsDevCatalogEntry,
  query: string,
  providerId: string | undefined,
): number {
  const id = entry.id.toLocaleLowerCase();
  const name = entry.name.toLocaleLowerCase();
  const entryProviderId = entry.providerId.toLocaleLowerCase();
  const providerName = entry.providerName.toLocaleLowerCase();
  const combined = `${entryProviderId}/${id}`;
  if (!query) return 10;
  let rank: number;
  if (id === query || combined === query) rank = 0;
  else if (name === query) rank = 1;
  else if (id.startsWith(query) || name.startsWith(query)) rank = 2;
  else if (combined.startsWith(query) || entryProviderId === query || providerName === query)
    rank = 3;
  else if (id.includes(query) || name.includes(query)) rank = 4;
  else if (combined.includes(query) || providerName.includes(query)) rank = 5;
  else rank = RANK_UNMATCHED;
  if (rank < RANK_UNMATCHED && providerId) {
    if (entryProviderId === providerId || providerName === providerId) rank -= 0.5;
  }
  return rank;
}

export function resolveModelsDevEntriesMetadata(
  entries: readonly ModelsDevCatalogEntry[],
  input: ResolveModelsDevModelMetadataInput,
): ModelsDevModelMetadata {
  const normalizedQuery = normalizeModelId(input.modelId);
  const normalizedProviderId = normalizeAlnum(input.providerId ?? "");
  const baseUrlHostname = parseHostname(input.baseUrl);
  const exactMatches = entries.filter((entry) => {
    const normalizedId = normalizeModelId(entry.id);
    const combined = `${entry.providerId.toLocaleLowerCase()}/${normalizedId}`;
    return normalizedId === normalizedQuery || combined === normalizedQuery;
  });
  if (exactMatches.length === 0) {
    return {
      exactMatches: 0,
      metadataMethod: "none",
      preset: {},
      price: {
        status: "unreliable",
        reason: "no-exact-match",
        support: 0,
        total: 0,
      },
    };
  }

  const providerMatches = exactMatches.filter(
    (entry) =>
      normalizedProviderId !== "" &&
      (normalizeAlnum(entry.providerId) === normalizedProviderId ||
        normalizeAlnum(entry.providerName) === normalizedProviderId),
  );
  const baseUrlMatches = baseUrlHostname
    ? exactMatches.filter((entry) => entryBaseUrlMatches(entry, baseUrlHostname))
    : [];
  const primary = providerMatches[0] ?? baseUrlMatches[0];
  const metadataMethod: ModelsDevMetadataMethod = providerMatches.length
    ? "provider"
    : baseUrlMatches.length
      ? "base-url"
      : "consensus";

  // 单条精确命中就是最强事实：无分歧可裁，直接采信（price 共识另算，保持 pi-web 的 
  // insufficient-support 保守性）。多条时才走多数派过滤冲突值。
  const preset: ModelsDevModelMetadata["preset"] = primary
    ? {
        ...(primary.name ? { name: primary.name } : {}),
        ...(primary.reasoning === undefined ? {} : { reasoning: primary.reasoning }),
        ...(primary.input === undefined ? {} : { input: primary.input }),
        ...(primary.contextWindow === undefined ? {} : { contextWindow: primary.contextWindow }),
        ...(primary.maxTokens === undefined ? {} : { maxTokens: primary.maxTokens }),
      }
    : exactMatches.length === 1
      ? {
          ...(exactMatches[0]!.name ? { name: exactMatches[0]!.name } : {}),
          ...(exactMatches[0]!.reasoning === undefined
            ? {}
            : { reasoning: exactMatches[0]!.reasoning }),
          ...(exactMatches[0]!.input === undefined ? {} : { input: exactMatches[0]!.input }),
          ...(exactMatches[0]!.contextWindow === undefined
            ? {}
            : { contextWindow: exactMatches[0]!.contextWindow }),
          ...(exactMatches[0]!.maxTokens === undefined
            ? {}
            : { maxTokens: exactMatches[0]!.maxTokens }),
        }
      : {
          ...(majorityString(exactMatches.map((entry) => entry.name))
            ? { name: majorityString(exactMatches.map((entry) => entry.name))! }
            : {}),
          ...consensusReasoning(exactMatches),
          ...consensusInput(exactMatches),
          ...consensusNumber(exactMatches, (entry) => entry.contextWindow, "contextWindow"),
          ...consensusNumber(exactMatches, (entry) => entry.maxTokens, "maxTokens"),
        };

  const price = resolvePrice(providerMatches, baseUrlMatches, exactMatches);
  if (price.status === "reliable" && price.cost) preset.cost = price.cost;
  return {
    exactMatches: exactMatches.length,
    metadataMethod,
    ...(primary ? { matchedProviderId: primary.providerId } : {}),
    ...(primary ? { matchedProviderName: primary.providerName } : {}),
    preset,
    price,
  };
}

function entryBaseUrlMatches(entry: ModelsDevCatalogEntry, hostname: string): boolean {
  const knownHosts =
    KNOWN_PROVIDER_HOSTS[normalizeAlnum(entry.providerId)] ??
    (entry.providerBaseUrl ? [parseHostname(entry.providerBaseUrl) ?? ""] : []);
  return knownHosts.some(
    (known) =>
      known !== "" &&
      (hostname === known || hostname.endsWith(`.${known}`) || known.endsWith(`.${hostname}`)),
  );
}

function resolvePrice(
  providerMatches: readonly ModelsDevCatalogEntry[],
  baseUrlMatches: readonly ModelsDevCatalogEntry[],
  exactMatches: readonly ModelsDevCatalogEntry[],
): ModelsDevPrice {
  const providerPriced = providerMatches.find(hasValidCost);
  if (providerPriced) {
    return {
      status: "reliable",
      method: "provider",
      cost: costOf(providerPriced),
      support: 1,
      total: 1,
    };
  }
  const baseUrlPriced = baseUrlMatches.find(hasValidCost);
  if (baseUrlPriced) {
    return {
      status: "reliable",
      method: "base-url",
      cost: costOf(baseUrlPriced),
      support: 1,
      total: 1,
    };
  }
  return resolveConsensusPrice(exactMatches);
}

function resolveConsensusPrice(
  exactMatches: readonly ModelsDevCatalogEntry[],
): ModelsDevPrice {
  const priced = exactMatches.filter(hasValidCost);
  if (priced.length === 0) {
    return {
      status: "unreliable",
      reason: "no-valid-price",
      support: 0,
      total: exactMatches.length,
    };
  }
  if (priced.length === 1) {
    return {
      status: "unreliable",
      reason: "insufficient-support",
      support: 1,
      total: exactMatches.length,
    };
  }
  // 按 [input, output] 分组求多数派；多数派须 ≥60% 或 ≥5 条，且严格多于第二名。
  const groups = new Map<string, ModelsDevCatalogEntry[]>();
  for (const entry of priced) {
    const signature = JSON.stringify([entry.cost!.input, entry.cost!.output]);
    const group = groups.get(signature);
    if (group) group.push(entry);
    else groups.set(signature, [entry]);
  }
  const sortedGroups = [...groups.values()].sort((left, right) => right.length - left.length);
  const majority = sortedGroups[0]!;
  if (!majority) {
    return {
      status: "unreliable",
      reason: "no-valid-price",
      support: 0,
      total: exactMatches.length,
    };
  }
  const runnerUp = sortedGroups[1];
  const strong = majority.length / priced.length >= 0.6 || majority.length >= 5;
  if (runnerUp?.length === majority.length || !strong) {
    return {
      status: "unreliable",
      reason: "conflict",
      support: majority.length,
      total: priced.length,
    };
  }
  return {
    status: "reliable",
    method: "consensus",
    cost: {
      input: majority[0]!.cost!.input,
      output: majority[0]!.cost!.output,
      cacheRead: mode(majority.map((entry) => entry.cost!.cacheRead)) ?? 0,
      cacheWrite: mode(majority.map((entry) => entry.cost!.cacheWrite)) ?? 0,
    },
    support: majority.length,
    total: priced.length,
  };
}

function hasValidCost(entry: ModelsDevCatalogEntry): boolean {
  return entry.cost !== null && entry.cost !== undefined;
}

function costOf(entry: ModelsDevCatalogEntry): NonNullable<ModelsDevCatalogEntry["cost"]> {
  return {
    input: entry.cost!.input,
    output: entry.cost!.output,
    cacheRead: entry.cost!.cacheRead ?? 0,
    cacheWrite: entry.cost!.cacheWrite ?? 0,
  };
}

function mode(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const sorted = [...counts.entries()].sort((left, right) => right[1] - left[1]);
  const [topValue, topCount] = sorted[0]!;
  const runnerUpCount = sorted[1]?.[1];
  return runnerUpCount === topCount ? undefined : topValue;
}

function majorityString(values: readonly string[]): string | undefined {
  if (values.length === 0) return undefined;
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const sorted = [...counts.entries()].sort((left, right) => right[1] - left[1]);
  const [topValue, topCount] = sorted[0]!;
  if (sorted[1]?.[1] === topCount) return undefined;
  return topValue;
}

function consensusReasoning(
  exactMatches: readonly ModelsDevCatalogEntry[],
): Partial<ModelsDevModelMetadata["preset"]> {
  const values = exactMatches
    .map((entry) => entry.reasoning)
    .filter((value): value is boolean => value !== null && value !== undefined)
    .map((value) => String(value));
  const majority = majorityString(values);
  return majority === undefined ? {} : { reasoning: majority === "true" };
}

function consensusInput(
  exactMatches: readonly ModelsDevCatalogEntry[],
): Partial<ModelsDevModelMetadata["preset"]> {
  const values = exactMatches
    .map((entry) => entry.input)
    .filter((value): value is ReadonlyArray<"text" | "image"> => value !== null && value !== undefined)
    .map((value) => [...value].sort().join(","));
  const majority = majorityString(values);
  if (majority === undefined) return {};
  const input = majority.split(",").filter((item) => item === "text" || item === "image") as Array<
    "text" | "image"
  >;
  return input.length > 0 ? { input } : {};
}

function consensusNumber(
  exactMatches: readonly ModelsDevCatalogEntry[],
  read: (entry: ModelsDevCatalogEntry) => number | null | undefined,
  key: "contextWindow" | "maxTokens",
): Partial<ModelsDevModelMetadata["preset"]> {
  const values = exactMatches
    .map(read)
    .filter((value): value is number => value !== null && value !== undefined)
    .map(String);
  const majority = majorityString(values);
  if (majority === undefined) return {};
  const parsed = Number(majority);
  if (!Number.isInteger(parsed) || parsed <= 0) return {};
  return { [key]: parsed };
}

function normalizeModelId(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/^models\//, "");
}

function normalizeAlnum(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseHostname(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return undefined;
  try {
    return new URL(trimmed).hostname.toLocaleLowerCase().replace(/\.$/, "");
  } catch {
    return undefined;
  }
}
