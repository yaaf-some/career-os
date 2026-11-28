import { ChevronRight } from 'lucide-react';
import { describeAiError } from '@/api/client';
import { useSettingsQuery, useSourcesQuery } from '@/api/queries';
import { InsetGroup, Notice, PageHeader, Skeleton } from '@/components/ui';
import { AiRoutingSection } from './ai/AiRoutingSection';
import { AppearanceSection } from './appearance/AppearanceSection';
import { CommuteCard } from './connections/CommuteCard';
import { GoogleCallbackNotice } from './connections/ConnectionsSection';
import { GoogleCard } from './connections/GoogleCard';
import { LinearCard } from './connections/LinearCard';
import { RulesSection } from './rules/RulesSection';

/** Composition only: each section lives in its own folder. */
export function SettingsView({ onOpenSources }: { onOpenSources?: () => void }) {
  const settingsQuery = useSettingsQuery();
  const sourcesQuery = useSourcesQuery();
  const settings = settingsQuery.data;

  return (
    <div className="mx-auto max-w-[680px] space-y-6" data-testid="settings-view">
      <PageHeader title="Settings" subtitle="Look, scoring rules, AI and connections" />
      <GoogleCallbackNotice />
      <AppearanceSection />

      {settingsQuery.isError ? (
        <Notice tone="danger">
          Settings could not be loaded: {describeAiError(settingsQuery.error)}
        </Notice>
      ) : settingsQuery.isLoading || !settings ? (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-44 w-full" />
        </div>
      ) : (
        <div className="space-y-6">
          <RulesSection />
          <AiRoutingSection settings={settings} />
                    <InsetGroup label="Job boards">
            {onOpenSources ? (
              <button
                type="button"
                onClick={onOpenSources}
                className="tap-control flex w-full items-center justify-between px-4 py-3.5 text-left hover:bg-[var(--wp-raised)]/45"
              >
                <div>
                  <div className="text-sm font-medium text-[var(--wp-ink)]">
                    Manage ATS &amp; Reddit boards
                  </div>
                  <div className="text-xs text-[var(--wp-muted)]">
                    {sourcesQuery.data?.sources.length ?? 0} configured · profile-filtered
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-[var(--wp-muted)]" />
              </button>
            ) : (
              <a
                href="/sources"
                className="tap-control flex w-full items-center justify-between px-4 py-3.5 text-left hover:bg-[var(--wp-raised)]/45"
              >
                <div>
                  <div className="text-sm font-medium text-[var(--wp-ink)]">
                    Manage ATS &amp; Reddit boards
                  </div>
                  <div className="text-xs text-[var(--wp-muted)]">
                    {sourcesQuery.data?.sources.length ?? 0} configured · profile-filtered
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-[var(--wp-muted)]" />
              </a>
            )}
          </InsetGroup>

          <GoogleCard settings={settings} />
          <CommuteCard settings={settings} />
          <LinearCard />
        </div>
      )}
    </div>
  );
}
