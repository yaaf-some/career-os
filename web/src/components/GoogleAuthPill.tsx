import { KeyRound, RefreshCw } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import type { GoogleAuthStatusResponse } from '@/api/types';
import { cn } from '@/lib/cn';

function formatCountdown(hoursRemaining: number | null): string {
  if (hoursRemaining === null || hoursRemaining <= 0) return 'Expired';
  if (hoursRemaining >= 48) {
    return `${Math.floor(hoursRemaining / 24)}d left`;
  }
  return `${Math.max(1, Math.round(hoursRemaining))}h left`;
}

export function GoogleAuthPill({
  status,
  isLoading,
  onReconnect,
  isReconnecting = false,
}: {
  status?: GoogleAuthStatusResponse;
  isLoading?: boolean;
  onReconnect?: () => void;
  isReconnecting?: boolean;
}) {
  if (isLoading || !status) {
    return (
      <div
        className="flex items-center gap-1.5 rounded-[10px] border border-[var(--wp-hairline)] bg-[var(--wp-surface)] px-2.5 py-1.5 text-xs text-[var(--wp-muted)]"
        data-testid="google-auth-pill-loading"
      >
        <KeyRound className="h-3.5 w-3.5" />
        <span>Google OAuth…</span>
      </div>
    );
  }

  const testingLabel = status.authMode === 'testing' ? '7d test' : status.authMode;
  const countdown = formatCountdown(status.hoursRemaining);

  const tone = !status.connected
    ? 'border-transparent bg-[var(--wp-bad-soft)] text-[var(--wp-bad)]'
    : status.needsReconnect
      ? 'border-transparent bg-[var(--wp-warn-soft)] text-[var(--wp-warn)]'
      : 'border-transparent bg-[var(--wp-good-soft)] text-[var(--wp-good)]';

  const statusText = !status.connected
    ? 'Sign in'
    : status.needsReconnect
      ? `Reconnect (${countdown})`
      : countdown;

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-[10px] border px-2.5 py-1.5 text-xs font-medium',
        tone,
      )}
      data-testid="google-auth-pill"
      title={
        status.connected
          ? `Google OAuth (${testingLabel})${status.accountEmail ? ` · ${status.accountEmail}` : ''}`
          : 'Google OAuth disconnected — weekly Testing-mode sign-in required'
      }
    >
      <Link to="/settings" className="flex items-center gap-1.5 hover:underline">
        <KeyRound className="h-3.5 w-3.5 shrink-0" />
        <span>Google · {statusText}</span>
      </Link>
      {(status.needsReconnect || !status.connected) && onReconnect ? (
        <button
          type="button"
          onClick={onReconnect}
          disabled={isReconnecting}
          className="inline-flex items-center gap-1 rounded-[7px] bg-[var(--wp-surface)] px-2 py-0.5 text-[11px] font-semibold text-[var(--wp-ink)] hover:opacity-90 disabled:opacity-50"
          data-testid="google-auth-reconnect-btn"
        >
          <RefreshCw className={cn('h-3 w-3', isReconnecting && 'animate-spin')} />
          <span>{isReconnecting ? 'Opening…' : 'Sign in'}</span>
        </button>
      ) : null}
    </div>
  );
}
