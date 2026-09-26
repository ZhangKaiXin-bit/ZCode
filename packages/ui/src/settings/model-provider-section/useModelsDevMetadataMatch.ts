import { useEffect, useMemo, useRef, useState } from "react";
import type { ModelsDevModelMetadata } from "@zcode/shared";
import type { IProviderSettingsService } from "@zcode/services";

const MODELS_DEV_MATCH_IDLE_MS = 400;

/**
 * 添加模型对话框的 models.dev 元数据匹配状态。
 *
 * 与 ZCode 智能配置（Built-in 推荐）独立：models.dev 只提供"候选事实"，
 * 是否采纳由用户点击"填入"决定，不自动覆盖表单或 Override。
 * 代次守卫：A→B→A 不能复用第一次 A 的回包（同 useModelConfigResolution 的身份语义）。
 */
export interface ModelsDevMetadataMatchState {
  readonly metadata: ModelsDevModelMetadata | null;
  readonly matchedModelId: string | null;
  readonly fetching: boolean;
}

const EMPTY_MATCH: ModelsDevMetadataMatchState = {
  metadata: null,
  matchedModelId: null,
  fetching: false,
};

export function useModelsDevMetadataMatch({
  open,
  modelId,
  providerId,
  baseUrl,
  providerSettingsService,
  disabled,
}: {
  open: boolean;
  modelId: string;
  providerId: string;
  baseUrl?: string;
  providerSettingsService?: IProviderSettingsService;
  disabled?: boolean;
}): ModelsDevMetadataMatchState {
  const [state, setState] = useState<ModelsDevMetadataMatchState>(EMPTY_MATCH);
  const generationRef = useRef(0);
  const normalizedModelId = modelId.trim();
  const enabled =
    open && !disabled && Boolean(providerSettingsService) && normalizedModelId.length > 0;

  const serviceRef = useRef(providerSettingsService);
  serviceRef.current = providerSettingsService;
  const hintsRef = useRef({ providerId, baseUrl });
  hintsRef.current = { providerId, baseUrl };

  // 输入停止后拉取一次目录推荐；失败静默降级为无面板，不能让设置页报错。
  useEffect(() => {
    if (!open) {
      generationRef.current += 1;
      setState(EMPTY_MATCH);
      return;
    }
    if (!enabled || !normalizedModelId) {
      generationRef.current += 1;
      setState(EMPTY_MATCH);
      return;
    }
    const generation = ++generationRef.current;
    setState((current) => ({ ...current, fetching: true }));
    const timer = setTimeout(() => {
      const service = serviceRef.current;
      if (!service) return;
      const { providerId: hintProviderId, baseUrl: hintBaseUrl } = hintsRef.current;
      void service
        .resolveModelsDevModelMetadata({
          modelId: normalizedModelId,
          providerId: hintProviderId,
          ...(hintBaseUrl?.trim() ? { baseUrl: hintBaseUrl.trim() } : {}),
        })
        .then((metadata) => {
          if (generationRef.current !== generation) return;
          if (metadata.exactMatches === 0) {
            setState({ metadata: null, matchedModelId: null, fetching: false });
            return;
          }
          setState({ metadata, matchedModelId: normalizedModelId, fetching: false });
        })
        .catch(() => {
          if (generationRef.current !== generation) return;
          setState({ metadata: null, matchedModelId: null, fetching: false });
        });
    }, MODELS_DEV_MATCH_IDLE_MS);
    return () => clearTimeout(timer);
  }, [open, enabled, normalizedModelId]);

  // 严格身份守卫：返回的 metadata 只与生成它的 modelId 一起展示；
  // 用户中途改 ID 时旧面板立即消失，不能在新 ID 上闪烁旧推荐。
  return useMemo(() => {
    if (!state.matchedModelId) return state.fetching ? { ...state, metadata: null } : state;
    return state.matchedModelId === normalizedModelId ? state : { ...state, metadata: null };
  }, [normalizedModelId, state]);
}
