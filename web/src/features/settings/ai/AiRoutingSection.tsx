import { useAiUsageQuery, useUpdateSettingsMutation } from '@/api/queries';
import type { AiRoutingMode, SettingsState } from '@/api/types';
import { InsetGroup, Meter, Notice, SegmentedControl, useToast } from '@/components/ui';
import { describeAiError } from '@/api/client';
import { formatAntigravityStatus, formatUsagePercent, getUsageSeverity } from '@/lib/usage';

const ROUTING_OPTIONS: readonly { value: AiRoutingMode; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'prefer_claude', label: 'Claude' },
  { value: 'prefer_agy', label: 'Gemini' },
];

export function AiRoutingSection({ settings }: { settings: SettingsState }) {
  const usageQuery = useAiUsageQuery();
  const updateMutation = useUpdateSettingsMutation();
  const { showToast } = useToast();

  const usage = usageQuery.data;
  const claude5hPct = usage?.claude5h?.percentUsed ?? 0;
  const claude7dPct = usage?.claude7d?.percentUsed ?? 0;
  const claude5hSeverity = getUsageSeverity(usage?.claude5h?.percentUsed);
  const agStatus = usage ? formatAntigravityStatus(usage.antigravity) : null;

  return (
    <>
    <InsetGroup label="AI routing">
      <div className="space-y-3 px-4 py-4">
        <div>
          <div className="text-sm font-medium text-[var(--wp-ink)]">Provider balance</div>
          <p className="mt-0.5 text-xs text-[var(--wp-muted)]">
            Fast scores batches · Balanced runs A–G · matches &ge; 75 escalate to Deep.
          </p>
        </div>
        <SegmentedControl
          ariaLabel="AI routing mode"
          fullWidth
          value={settings.aiRoutingMode}
          onValueChange={(mode) =>
            updateMutation.mutate(
              { aiRoutingMode: mode },
              {
                onSuccess: () =>
                  showToast({ tone: 'success', message: `AI routing set to ${mode}` }),
              },
            )
          }
          options={ROUTING_OPTIONS}
        />
      </div>

      <div className="grid gap-4 px-4 py-4 sm:grid-cols-2">
        <Meter
          label="Claude 5h"
          value={claude5hPct}
          valueText={
            usage?.configured ? formatUsagePercent(usage.claude5h?.percentUsed) : 'Unconfigured'
          }
          tone={
            claude5hSeverity === 'critical'
              ? 'bad'
              : claude5hSeverity === 'warn'
                ? 'warn'
                : 'good'
          }
        />
        <Meter
          label="Claude 7d"
          value={claude7dPct}
          valueText={
            usage?.configured
              ? `${formatUsagePercent(usage.claude7d?.percentUsed)} · Gemini ${agStatus?.label ?? 'Ready'}`
              : '—'
          }
          tone="accent"
        />
      </div>
    </InsetGroup>
      {updateMutation.isError ? (
        <Notice tone="danger">AI routing was not saved: {describeAiError(updateMutation.error)}</Notice>
      ) : null}
    </>
  );
}
