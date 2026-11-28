import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Sheet({
  open,
  onOpenChange,
  ariaLabel,
  maxWidthClass = 'md:max-w-2xl',
  className,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ariaLabel: string;
  maxWidthClass?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="fixed inset-0 z-50 bg-black/35 backdrop-blur-[2px]" />
        <BaseDialog.Popup
          aria-label={ariaLabel}
          className={cn(
            'paper-floating drawer-rise fixed inset-x-0 bottom-0 z-50 flex max-h-[86dvh] w-full flex-col rounded-t-[22px] text-[var(--wp-ink)] outline-none',
            'md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:rounded-t-none md:rounded-l-[20px]',
            maxWidthClass,
            className,
          )}
        >
          <div className="mx-auto mt-3 mb-1 h-1 w-10 shrink-0 rounded-full bg-[var(--wp-hairline)] md:hidden" />
          {children}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}

export const SheetTitle = BaseDialog.Title;
export const SheetDescription = BaseDialog.Description;
export const SheetClose = BaseDialog.Close;
