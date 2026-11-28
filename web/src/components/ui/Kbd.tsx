import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Kbd({ className, children }: { className?: string; children: ReactNode }) {
  return <kbd className={cn('keycap inline-flex items-center justify-center', className)}>{children}</kbd>;
}
