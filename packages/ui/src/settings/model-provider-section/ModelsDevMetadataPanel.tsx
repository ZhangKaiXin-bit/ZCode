import { Loader2Icon, SparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { ModelsDevCatalogCandidate, ModelsDevModelMetadata } from "@zcode/shared";
import {
  TID_MODEL_PROVIDER_MODELS_DEV_CANDIDATE_FILL_BUTTON,
  TID_MODEL_PROVIDER_MODELS_DEV_FILL_BUTTON,
} from "@zcode/shared";
import { formatModelContextWindowLabel } from "@/lib/tokenNumberFormat.js";

/**
 * models.dev 元数据匹配面板（添加模型对话框内）。
 *
 * 精确命中时展示推荐事实与置信度，只写 contextWindow / maxOutputTokens /
 * inputFormat；精确无命中时退化为近似候选列表，由用户点选后再填入。
 * 两种情况都不改写模型 ID、不覆盖 Override。
 */
export function ModelsDevMetadataPanel({
  metadata,
  fetching,
  onApply,
  onApplyCandidate,
}: {
  metadata: ModelsDevModelMetadata;
  fetching: boolean;
  onApply?: () => void;
  onApplyCandidate?: (candidate: ModelsDevCatalogCandidate) => void;
}) {
  const { intl } = useZCodeIntl();
  const { preset, price, metadataMethod, matchedProviderName, candidates } = metadata;
  const presetInput = preset.input ?? null;
  const presetContextWindow = preset.contextWindow ?? null;
  const presetMaxTokens = preset.maxTokens ?? null;
  const hasMetadata =
    presetContextWindow !== null || presetMaxTokens !== null || (presetInput?.length ?? 0) > 0;
  const candidateList = hasMetadata ? [] : (candidates ?? []);

  if (!hasMetadata && candidateList.length === 0) return null;

  const candidateFacts = (candidate: ModelsDevCatalogCandidate): string[] => {
    const facts: string[] = [];
    if (typeof candidate.contextWindow === "number") {
      facts.push(
        intl.formatMessage(
          { id: "settings.modelProvider.modelsDev.contextWindow" },
          { value: formatModelContextWindowLabel(candidate.contextWindow) },
        ),
      );
    }
    if (typeof candidate.maxTokens === "number") {
      facts.push(
        intl.formatMessage(
          { id: "settings.modelProvider.modelsDev.maxTokens" },
          { value: formatModelContextWindowLabel(candidate.maxTokens) },
        ),
      );
    }
    if (candidate.cost) {
      facts.push(
        intl.formatMessage(
          { id: "settings.modelProvider.modelsDev.price" },
          { input: candidate.cost.input, output: candidate.cost.output },
        ),
      );
    }
    return facts;
  };

  if (!hasMetadata) {
    return (
      <div
        className="mt-2 flex flex-col gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2"
        data-models-dev-panel="true"
        data-models-dev-candidates="true"
        role="status"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2 text-ui-sm text-foreground-subtle">
          <SparklesIcon className="size-4 shrink-0 text-foreground-subtle" aria-hidden="true" />
          <span className="min-w-0 truncate">
            {intl.formatMessage({ id: "settings.modelProvider.modelsDev.candidates.title" })}
          </span>
          {fetching ? (
            <Loader2Icon className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
          ) : null}
        </div>
        <ul className="flex flex-col gap-1.5">
          {candidateList.map((candidate) => {
            const facts = candidateFacts(candidate);
            return (
            <li
              key={`${candidate.providerId}/${candidate.id}`}
              className="flex min-w-0 items-center gap-2"
            >
              <span className="min-w-0 flex-1 truncate text-ui-xs text-foreground-subtle">
                {intl.formatMessage(
                  { id: "settings.modelProvider.modelsDev.candidates.item" },
                  {
                    provider: candidate.providerName,
                    id: candidate.id,
                  },
                )}
                {facts.length > 0 ? ` · ${facts.join(" · ")}` : ""}
              </span>
              {onApplyCandidate ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="shrink-0 rounded-lg"
                  data-testid={TID_MODEL_PROVIDER_MODELS_DEV_CANDIDATE_FILL_BUTTON}
                  onClick={() => onApplyCandidate(candidate)}
                >
                  {intl.formatMessage({ id: "settings.modelProvider.modelsDev.fill" })}
                </Button>
              ) : null}
            </li>
            );
          })}
        </ul>
        <span className="text-ui-xs text-foreground-subtlest">
          {intl.formatMessage({ id: "settings.modelProvider.modelsDev.candidates.hint" })}
        </span>
      </div>
    );
  }

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
      {onApply ? (
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
      ) : null}
    </div>
  );
}
