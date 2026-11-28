import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

const FIELD_CLASS =
  'w-full rounded-[12px] border border-[var(--wp-hairline)] bg-[var(--wp-canvas)] px-3 text-sm text-[var(--wp-ink)] placeholder:text-[var(--wp-muted)] outline-none transition-colors focus:border-[var(--wp-accent)] focus-visible:ring-2 focus-visible:ring-[var(--wp-accent-soft)] disabled:opacity-50';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(FIELD_CLASS, 'h-10', className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(FIELD_CLASS, 'py-2.5 leading-relaxed', className)} {...props} />;
}
