import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { Input } from "@/components/ui/input.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { IProviderSettingsService } from "@zcode/services";
import type { DiscoveredProviderModel } from "@zcode/shared";
import type { ProviderApiType } from "@zcode/provider";
import { cn } from "@/components/lib/utils.js";

/**
 * 上游模型发现对话框：从 Provider 兼容端点（/models）自动拉取模型 ID 列表。
 *
 * 发现的模型只是“候选 ID”；真正添加仍走现有 addPersonalModel 唯一写边界，
 * 配置由 ZCode 智能配置（Built-in 推荐）解析，不在此预填元数据。
 */
export function ProviderModelsDiscoveryDialog({
  open,
  baseUrl,
  apiType,
  apiKey,
  existingModelIds,
  providerSettingsService,
  onOpenChange,
  onAddModels,
}: {
  open: boolean;
  baseUrl?: string;
  apiType?: ProviderApiType;
  apiKey?: string;
  existingModelIds: readonly string[];
  providerSettingsService?: IProviderSettingsService;
  onOpenChange: (open: boolean) => void;
  onAddModels: (modelIds: readonly string[]) => Promise<void> | void;
}) {
  const { intl } = useZCodeIntl();
  const [state, setState] = useState<{
    status: "idle" | "loading" | "success" | "error";
    models: readonly DiscoveredProviderModel[];
    endpoint?: string;
    error?: string;
  }>({ status: "idle", models: [] });
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const generationRef = useRef(0);

  const canDiscover = Boolean(baseUrl?.trim() && apiType && providerSettingsService);

  const runDiscovery = useCallback(async () => {
    if (!canDiscover || !providerSettingsService || !baseUrl?.trim() || !apiType) return;
    const generation = ++generationRef.current;
    setState((current) => ({ ...current, status: "loading", error: undefined }));
    try {
      const result = await providerSettingsService.discoverProviderModels({
        baseUrl: baseUrl.trim(),
        apiType,
        ...(apiKey?.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      if (generationRef.current !== generation) return;
      setState({ status: "success", models: result.models, endpoint: result.endpoint });
    } catch (error) {
      if (generationRef.current !== generation) return;
      setState({
        status: "error",
        models: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, [apiKey, apiType, baseUrl, canDiscover, providerSettingsService]);

  useEffect(() => {
    if (!open) {
      generationRef.current += 1;
      setState({ status: "idle", models: [] });
      setFilter("");
      setSelected(new Set());
      setAdding(false);
      return;
    }
    // 打开即自动拉取；baseUrl 尚未配置时停在 idle 引导态。
    if (canDiscover) void runDiscovery();
  }, [open, canDiscover, runDiscovery]);

  const existingSet = useMemo(() => new Set(existingModelIds), [existingModelIds]);
  const visibleModels = useMemo(() => {
    const normalizedFilter = filter.trim().toLocaleLowerCase();
    if (!normalizedFilter) return state.models;
    return state.models.filter(
      (model) =>
        model.id.toLocaleLowerCase().includes(normalizedFilter) ||
        model.name?.toLocaleLowerCase().includes(normalizedFilter),
    );
  }, [filter, state.models]);

  const toggleSelected = (modelId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      return next;
    });
  };

  const commitAdd = async () => {
    const modelIds = [...selected];
    if (modelIds.length === 0) return;
    setAdding(true);
    try {
      await onAddModels(modelIds);
      onOpenChange(false);
    } finally {
      setAdding(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[min(36rem,calc(100vh-4rem))] max-w-xl grid-rows-[auto_minmax(0,1fr)_auto] overflow-clip"
        data-no-model-drag="true"
      >
        <DialogHeader className="pr-8">
          <DialogTitle>
            {intl.formatMessage({ id: "settings.modelProvider.discover.title" })}
          </DialogTitle>
          <DialogDescription>
            {state.endpoint
              ? intl.formatMessage(
                  { id: "settings.modelProvider.discover.descriptionWithEndpoint" },
                  { endpoint: state.endpoint },
                )
              : intl.formatMessage({ id: "settings.modelProvider.discover.description" })}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-3 overflow-y-auto pr-1">
          {!canDiscover ? (
            <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-ui-sm text-foreground-subtle">
              {intl.formatMessage({ id: "settings.modelProvider.discover.missingBaseUrl" })}
            </div>
          ) : state.status === "loading" || state.status === "idle" ? (
            <div
              className="flex items-center justify-center gap-2 rounded-lg border border-border px-4 py-8 text-ui-sm text-foreground-subtle"
              role="status"
            >
              <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
              {intl.formatMessage({ id: "settings.modelProvider.discover.loading" })}
            </div>
          ) : state.status === "error" ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-ui-sm text-destructive">
                {intl.formatMessage(
                  { id: "settings.modelProvider.discover.error" },
                  { message: state.error ?? "" },
                )}
              </div>
              <Button type="button" variant="secondary" size="sm" onClick={() => void runDiscovery()}>
                {intl.formatMessage({ id: "settings.modelProvider.discover.retry" })}
              </Button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <Input
                  type="text"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder={intl.formatMessage({
                    id: "settings.modelProvider.discover.filterPlaceholder",
                  })}
                />
                {selected.size > 0 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="shrink-0"
                    onClick={() => setSelected(new Set())}
                  >
                    {intl.formatMessage({ id: "settings.modelProvider.discover.clearSelection" })}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="shrink-0"
                    onClick={() =>
                      setSelected(
                        new Set(
                          visibleModels
                            .filter((model) => !existingSet.has(model.id))
                            .map((model) => model.id),
                        ),
                      )
                    }
                  >
                    {intl.formatMessage({ id: "settings.modelProvider.discover.selectAll" })}
                  </Button>
                )}
              </div>
              {visibleModels.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-ui-sm text-foreground-subtle">
                  {intl.formatMessage({ id: "settings.modelProvider.discover.empty" })}
                </div>
              ) : (
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {visibleModels.map((model) => {
                    const alreadyAdded = existingSet.has(model.id);
                    const isSelected = selected.has(model.id);
                    return (
                      <li key={model.id}>
                        <button
                          type="button"
                          disabled={alreadyAdded}
                          onClick={() => toggleSelected(model.id)}
                          className={cn(
                            "flex w-full items-center gap-3 px-3 py-2 text-left transition-colors",
                            alreadyAdded
                              ? "cursor-default opacity-50"
                              : "hover:bg-hover cursor-pointer",
                          )}
                        >
                          <span
                            aria-hidden="true"
                            className={cn(
                              "flex size-4 shrink-0 items-center justify-center rounded border",
                              isSelected
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-input-border",
                            )}
                          >
                            {isSelected ? <CheckIcon className="size-3" /> : null}
                          </span>
                          <span className="min-w-0 flex-1 truncate font-mono text-ui-sm">
                            {model.id}
                          </span>
                          {alreadyAdded ? (
                            <span className="shrink-0 text-ui-xs text-foreground-subtlest">
                              {intl.formatMessage({
                                id: "settings.modelProvider.discover.alreadyAdded",
                              })}
                            </span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="text-ui-sm text-foreground-subtle">
            {state.status === "success"
              ? intl.formatMessage(
                  { id: "settings.modelProvider.discover.selectedCount" },
                  { count: selected.size },
                )
              : ""}
          </span>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {intl.formatMessage({ id: "common.cancel" })}
            </Button>
            <Button
              type="button"
              disabled={selected.size === 0 || adding || state.status !== "success"}
              onClick={() => void commitAdd()}
            >
              {adding ? (
                <Loader2Icon className="size-4 animate-spin" data-icon="inline-start" />
              ) : null}
              {intl.formatMessage(
                { id: "settings.modelProvider.discover.addSelected" },
                { count: selected.size },
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
