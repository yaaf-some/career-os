import { useEffect, useState } from 'react';
import { describeAiError } from '@/api/client';
import { useCommutePreviewMutation, useUpdateSettingsMutation } from '@/api/queries';
import type { SettingsState } from '@/api/types';
import { CommuteBadgeDisplay } from '@/components/CommuteBadge';
import { Badge, Button, Input, Notice, PaperSheet, SegmentedControl } from '@/components/ui';

export function CommuteCard({ settings }: { settings: SettingsState }) {
  const updateMutation = useUpdateSettingsMutation();
  const commutePreviewMutation = useCommutePreviewMutation();
  const [homeArea, setHomeArea] = useState(settings.homeLocationArea || 'West Los Angeles, CA');
  const [travelMode, setTravelMode] = useState<'drive' | 'transit'>(
    settings.defaultTravelMode ?? 'drive',
  );
  const [previewDestination, setPreviewDestination] = useState('Santa Monica, CA');

  useEffect(() => {
    if (settings.homeLocationArea) setHomeArea(settings.homeLocationArea);
    if (settings.defaultTravelMode) setTravelMode(settings.defaultTravelMode);
  }, [settings.homeLocationArea, settings.defaultTravelMode]);

  return (
    <section className="space-y-2" data-testid="la-commute-card">
      <div className="flex items-center justify-between px-1 text-xs font-medium text-[var(--wp-muted)]">
        <span>LA commute &amp; Maps</span>
        <Badge variant={settings.mapsConfigured ? 'success' : 'neutral'}>
          {settings.mapsConfigured ? 'Maps + Places Ready' : 'Configure API Key'}
        </Badge>
      </div>
      <PaperSheet className="space-y-3 p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="space-y-1 text-xs">
            <span className="font-medium text-[var(--wp-secondary)]">Home area</span>
            <Input
              type="text"
              value={homeArea}
              onChange={(e) => setHomeArea(e.target.value)}
              placeholder="West Los Angeles, CA"
            />
          </label>

          <div className="space-y-1 text-xs">
            <span className="block font-medium text-[var(--wp-secondary)]">Travel mode</span>
            <SegmentedControl
              ariaLabel="Default travel mode"
              fullWidth
              value={travelMode}
              onValueChange={setTravelMode}
              options={[
                { value: 'drive', label: 'Drive' },
                { value: 'transit', label: 'Transit' },
              ]}
            />
          </div>

          <label className="space-y-1 text-xs">
            <span className="font-medium text-[var(--wp-secondary)]">Preview</span>
            <div className="flex gap-2">
              <Input
                type="text"
                value={previewDestination}
                onChange={(e) => setPreviewDestination(e.target.value)}
                placeholder="Santa Monica, CA"
              />
              <Button
                variant="secondary"
                disabled={commutePreviewMutation.isPending || !previewDestination.trim()}
                onClick={() => {
                  updateMutation.mutate({
                    homeLocationArea: homeArea,
                    defaultTravelMode: travelMode,
                  });
                  commutePreviewMutation.mutate({
                    originArea: homeArea,
                    destination: previewDestination,
                    travelMode,
                  });
                }}
              >
                {commutePreviewMutation.isPending ? '…' : 'Preview'}
              </Button>
            </div>
          </label>
        </div>

        {commutePreviewMutation.isError ? (
          <Notice tone="danger">
            Commute preview failed: {describeAiError(commutePreviewMutation.error)}
          </Notice>
        ) : null}
        {updateMutation.isError ? (
          <Notice tone="danger">
            Commute settings were not saved: {describeAiError(updateMutation.error)}
          </Notice>
        ) : null}

        {commutePreviewMutation.data ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] bg-[var(--wp-raised)]/60 p-3 text-xs">
            <CommuteBadgeDisplay commute={commutePreviewMutation.data} />
            {commutePreviewMutation.data.resolvedAddress ? (
              <span className="text-[var(--wp-muted)]">
                Resolved: {commutePreviewMutation.data.resolvedAddress}
              </span>
            ) : null}
          </div>
        ) : null}
      </PaperSheet>
    </section>
  );
}
