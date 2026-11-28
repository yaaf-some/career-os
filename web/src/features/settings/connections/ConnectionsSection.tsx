import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { queryKeys } from '@/api/queries';
import { Notice } from '@/components/ui';

/** One-shot `?google=` result set by the OAuth callback redirect (JOB-11). */
const GOOGLE_CALLBACK_MESSAGES: Record<string, string> = {
  denied: 'Google sign-in was cancelled. Nothing was connected.',
  invalid_state: 'That Google sign-in link expired. Start the connection again.',
  not_configured: 'Google OAuth is not configured on the server (.env).',
  exchange_failed: 'Google sign-in failed while saving the token. Try again.',
};

type GoogleCallbackResult = { tone: 'success' | 'danger'; message: string };

function readGoogleCallbackResult(search: string): GoogleCallbackResult | null {
  const params = new URLSearchParams(search);
  const google = params.get('google');
  if (google === 'connected') return { tone: 'success', message: 'Google connected.' };
  if (google === 'error') {
    const reason = params.get('reason') ?? '';
    return {
      tone: 'danger',
      message: GOOGLE_CALLBACK_MESSAGES[reason] ?? 'Google sign-in failed. Try again.',
    };
  }
  return null;
}

/** Shows the result of the Google sign-in redirect once. */
export function GoogleCallbackNotice() {
  const queryClient = useQueryClient();
  const [googleCallback, setGoogleCallback] = useState<GoogleCallbackResult | null>(() =>
    typeof window === 'undefined' ? null : readGoogleCallbackResult(window.location.search),
  );

  // Read the callback result once, then drop it from the URL so a reload doesn't repeat it.
  useEffect(() => {
    if (!googleCallback) return;
    void queryClient.invalidateQueries({ queryKey: queryKeys.googleAuthStatus });
    const url = new URL(window.location.href);
    url.searchParams.delete('google');
    url.searchParams.delete('reason');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);

  if (!googleCallback) return null;
  return (
    <div data-testid="google-callback-notice" className="space-y-1">
      <Notice tone={googleCallback.tone}>{googleCallback.message}</Notice>
      <button
        type="button"
        className="px-1 text-xs text-[var(--wp-muted)] underline"
        onClick={() => setGoogleCallback(null)}
      >
        Dismiss
      </button>
    </div>
  );
}
