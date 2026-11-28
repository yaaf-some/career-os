import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type ToastTone = 'neutral' | 'success' | 'warning' | 'danger';

export interface ToastInput {
  message: string;
  tone?: ToastTone;
  actionLabel?: string;
  onAction?: () => void;
  durationMs?: number;
}

interface ActiveToast extends ToastInput {
  id: number;
}

interface ToastContextValue {
  showToast: (toast: ToastInput) => number;
  dismissToast: (id?: number) => void;
}

const ToastContext = createContext<ToastContextValue>({
  showToast: () => 0,
  dismissToast: () => {},
});

const TONE_DOT: Record<ToastTone, string> = {
  neutral: 'bg-[var(--wp-muted)]',
  success: 'bg-[var(--wp-good)]',
  warning: 'bg-[var(--wp-warn)]',
  danger: 'bg-[var(--wp-bad)]',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ActiveToast | null>(null);
  const timerRef = useRef<number | null>(null);
  const nextIdRef = useRef(1);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const dismissToast = useCallback(
    (id?: number) => {
      clearTimer();
      setToast((curr) => (id == null || curr?.id === id ? null : curr));
    },
    [clearTimer],
  );

  const showToast = useCallback(
    (input: ToastInput) => {
      clearTimer();
      const id = nextIdRef.current++;
      setToast({ ...input, id });
      const duration = input.durationMs ?? 3600;
      if (duration > 0) {
        timerRef.current = window.setTimeout(() => {
          setToast((curr) => (curr?.id === id ? null : curr));
        }, duration);
      }
      return id;
    },
    [clearTimer],
  );

  useEffect(() => () => clearTimer(), [clearTimer]);

  const value = useMemo(() => ({ showToast, dismissToast }), [showToast, dismissToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast ? (
        <div
          className="pointer-events-none fixed inset-x-4 bottom-20 z-50 flex justify-center md:bottom-6"
          aria-live="polite"
          role="status"
          data-testid="toast-viewport"
        >
          <div className="paper-floating drawer-rise pointer-events-auto flex items-center gap-3 rounded-[12px] px-4 py-2.5 text-xs text-[var(--wp-ink)]">
            <span
              className={cn('h-2 w-2 shrink-0 rounded-full', TONE_DOT[toast.tone ?? 'neutral'])}
              aria-hidden="true"
            />
            <span>{toast.message}</span>
            {toast.actionLabel && toast.onAction ? (
              <button
                type="button"
                onClick={() => {
                  const action = toast.onAction;
                  dismissToast(toast.id);
                  action?.();
                }}
                className="tap-control font-medium text-[var(--wp-accent)] hover:underline"
              >
                {toast.actionLabel}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}
