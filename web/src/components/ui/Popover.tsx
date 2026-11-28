import { Popover as BasePopover } from '@base-ui/react/popover';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export const PopoverRoot = BasePopover.Root;
export const PopoverTrigger = BasePopover.Trigger;

export function PopoverContent({
  side = 'top',
  align = 'start',
  sideOffset = 8,
  className,
  children,
}: {
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <BasePopover.Portal>
      <BasePopover.Positioner side={side} align={align} sideOffset={sideOffset} className="z-50">
        <BasePopover.Popup
          className={cn(
            'paper-floating calm-rise w-72 rounded-[16px] p-4 text-xs text-[var(--wp-ink)] outline-none',
            className,
          )}
        >
          {children}
        </BasePopover.Popup>
      </BasePopover.Positioner>
    </BasePopover.Portal>
  );
}
