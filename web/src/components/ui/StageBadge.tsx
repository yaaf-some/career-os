import type { PipelineStage } from '@/api/types';
import { cn } from '@/lib/cn';
import { stageStyle, tint } from '@/lib/stages';

export function StageBadge({ stage, className }: { stage: PipelineStage; className?: string }) {
  const { label, color } = stageStyle(stage);
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium', className)}
      style={{ color, backgroundColor: tint(color) }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}
