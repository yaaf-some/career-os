import { cn } from '@/lib/cn';
import { companyHue, tint } from '@/lib/stages';

const SIZES = {
  sm: 'h-8 w-8 rounded-[9px] text-xs',
  md: 'h-10 w-10 rounded-[12px] text-sm',
  lg: 'h-14 w-14 rounded-[16px] text-xl',
} as const;

/** Company initials in the company's own color. Decorative: show the name too. */
export function Monogram({
  company,
  size = 'md',
  className,
}: {
  company: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const words = company.split(/\s+/).filter(Boolean);
  const initials = (words.length > 1 ? words[0][0] + words[1][0] : company.slice(0, 2)).toUpperCase();
  const color = companyHue(company);
  return (
    <span
      aria-hidden="true"
      className={cn('inline-flex shrink-0 items-center justify-center font-semibold', SIZES[size], className)}
      style={{ color, backgroundColor: tint(color, 17) }}
    >
      {initials}
    </span>
  );
}
