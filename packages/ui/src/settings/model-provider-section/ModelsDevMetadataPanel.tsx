import { Loader2Icon, SparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { ModelsDevModelMetadata } from "@zcode/shared";
import { TID_MODEL_PROVIDER_MODELS_DEV_FILL_BUTTON } from "@zcode/shared";
import { formatModelContextWindowLabel } from "@/lib/tokenNumberFormat.js";

/**
 * models.dev 元数据匹配面板（添加模型对话框内）。
 *
 * 展示 models.dev 目录命中的推荐事实与置信度；只在用户显式点击时把
 * contextWindow / maxOutputTokens / inputFormat 填入表单。
 */
export function ModelsDevMetadataPanel({
  metadata,
  fetching,
  onApply,
}: {
  metadata: ModelsDevModelMetadata;
  fetching: boolean;
  onApply: () => void;
}) {
  const { intl } = useZCodeIntl();
  const { preset, price, metadataMethod, matchedProviderName } = metadata;
  const presetInput = preset.input ?? null;
  const presetContextWindow = preset.contextWindow ?? null;
  const presetMaxTokens = preset.maxTokens ?? null;
  const hasMetadata =
    presetContextWindow !== null || presetMaxTokens !== null || (presetInput?.length ?? 0) > 0;
  if (!hasMetadata) return null;

  const facts: string[] = [];
  if (presetContextWindow !== null) {
    facts.push(
      intl.formatMessage(
        { id: "settings.modelProvider.modelsDev.contextWindow" },
        { value: formatModelContextWindowLabel(presetContextWindow) },
      ),
    );
  }
  if (presetMaxTokens !== null) {
    facts.push(
      intl.formatMessage(
        { id: "settings.modelProvider.modelsDev.maxTokens" },
        { value: formatModelContextWindowLabel(presetMaxTokens) },
      ),
    );
  }
  if (presetInput?.includes("image")) {
    facts.push(intl.formatMessage({ id: "settings.modelProvider.modelsDev.supportsImage" }));
  }
  if (preset.reasoning === true) {
    facts.push(intl.formatMessage({ id: "settings.modelProvider.modelsDev.supportsReasoning" }));
  }

  const methodLabel = intl.formatMessage({
    id: `settings.modelProvider.modelsDev.method.${metadataMethod}`,
  });

  return (
    <div
      className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-muted/30 px-3 py-2"
      data-models-dev-panel="true"
      role="status"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2 text-ui-sm text-foreground-subtle">
        <SparklesIcon className="size-4 shrink-0 text-foreground-subtle" aria-hidden="true" />
        <span className="min-w-0 truncate">
          {intl.formatMessage(
            { id: "settings.modelProvider.modelsDev.matched" },
            {
              provider: matchedProviderName ?? "models.dev",
              method: methodLabel,
              facts: facts.join(" · "),
            },
          )}
        </span>
        {fetching ? (
          <Loader2Icon className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
        ) : null}
      </div>
      {price.status === "reliable" && price.cost ? (
        <span className="shrink-0 text-ui-xs text-foreground-subtlest">
          {intl.formatMessage(
            { id: "settings.modelProvider.modelsDev.price" },
            { input: price.cost.input, output: price.cost.output },
          )}
        </span>
      ) : null}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="shrink-0 rounded-lg"
        data-testid={TID_MODEL_PROVIDER_MODELS_DEV_FILL_BUTTON}
        onClick={onApply}
      >
        {intl.formatMessage({ id: "settings.modelProvider.modelsDev.fill" })}
      </Button>
    </div>
  );
}
