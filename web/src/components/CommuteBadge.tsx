import { Car, ExternalLink, Globe2, MapPin, Train } from 'lucide-react';
import { useJobCommuteQuery } from '@/api/queries';
import type { CommuteInfo } from '@/api/types';
import { cn } from '@/lib/cn';

function formatCommuteText(commute: CommuteInfo): string {
  if (commute.isRemote) return 'Remote';
  if (!commute.configured && commute.distanceMiles === null) {
    return 'Commute unconfigured';
  }
  const mins =
    commute.durationMinutes !== null ? `~${commute.durationMinutes} min` : null;
  const miles =
    commute.distanceMiles !== null
      ? `${commute.distanceMiles.toFixed(1)} mi`
      : null;
  const isApprox = commute.estimateSource === 'places_haversine';
  const parts = [mins, miles].filter(Boolean).join(' · ');
  if (!parts) return 'Commute unavailable';
  return isApprox ? `${parts} est.` : parts;
}

export function CommuteBadgeDisplay({
  commute,
  compact = false,
}: {
  commute: CommuteInfo;
  compact?: boolean;
}) {
  const Icon = commute.isRemote
    ? Globe2
    : commute.travelMode === 'transit'
      ? Train
      : commute.distanceMiles !== null
        ? Car
        : MapPin;

  const tone = commute.isRemote
    ? 'border-transparent bg-[var(--wp-raised)] text-[var(--wp-secondary)]'
    : commute.durationMinutes !== null && commute.durationMinutes <= 25
      ? 'border-transparent bg-[var(--wp-good-soft)] text-[var(--wp-good)]'
      : commute.distanceMiles !== null
        ? 'border-transparent bg-[var(--wp-warn-soft)] text-[var(--wp-warn)]'
        : 'border-[var(--wp-hairline)] bg-[var(--wp-raised)] text-[var(--wp-muted)]';

  const label = formatCommuteText(commute);
  const title = commute.originArea
    ? `From ${commute.originArea}${commute.resolvedAddress ? ` → ${commute.resolvedAddress}` : ''}`
    : commute.resolvedAddress ?? label;

  const badge = (
    <span
      className={cn(
        'font-mono-meta inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
        tone,
      )}
      data-testid="commute-badge"
      title={title}
    >
      <Icon className="h-3 w-3 shrink-0" />
      <span>{label}</span>
      {!compact && commute.originArea && !commute.isRemote ? (
        <span className="font-sans text-[11px] opacity-80">from {commute.originArea}</span>
      ) : null}
    </span>
  );

  if (commute.mapsUrl && !commute.isRemote) {
    return (
      <a
        href={commute.mapsUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="inline-flex items-center gap-1 hover:opacity-90"
        title={`Open directions in Google Maps (${title})`}
      >
        {badge}
        {!compact ? <ExternalLink className="h-3 w-3 text-[var(--wp-muted)]" /> : null}
      </a>
    );
  }

  return badge;
}

export function CommuteBadge({
  jobId,
  remotePolicy,
  compact = false,
}: {
  jobId: string;
  remotePolicy?: string;
  compact?: boolean;
}) {
  const isObviousRemote = Boolean(
    remotePolicy && remotePolicy.toLowerCase().includes('remote'),
  );
  const commuteQuery = useJobCommuteQuery(jobId, !isObviousRemote);

  if (isObviousRemote) {
    return (
      <CommuteBadgeDisplay
        compact={compact}
        commute={{
          isRemote: true,
          configured: true,
          originArea: null,
          destinationQuery: null,
          resolvedAddress: null,
          distanceMiles: null,
          durationMinutes: null,
          travelMode: 'drive',
          estimateSource: 'remote',
          cached: false,
          mapsUrl: null,
        }}
      />
    );
  }

  if (commuteQuery.isLoading || !commuteQuery.data) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full border border-[var(--wp-hairline)] bg-[var(--wp-raised)] px-2 py-0.5 text-xs text-[var(--wp-muted)]"
        data-testid="commute-badge-loading"
      >
        <MapPin className="h-3 w-3" />
        <span>Checking LA commute…</span>
      </span>
    );
  }

  return <CommuteBadgeDisplay commute={commuteQuery.data} compact={compact} />;
}
