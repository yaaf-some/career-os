import { describeAiError } from '@/api/client';
import { useLinearStatusQuery } from '@/api/queries';
import { Badge, InsetGroup, Notice, Skeleton } from '@/components/ui';

export function LinearCard() {
  const linearQuery = useLinearStatusQuery();

  return (
    <InsetGroup
      label={linearQuery.data?.teamKey ? `Linear ${linearQuery.data.teamKey}` : 'Linear'}
      trailing={
        linearQuery.data ? (linearQuery.data.configured ? 'Configured' : 'Not configured') : undefined
      }
    >
      <div data-testid="linear-card">
        {linearQuery.isError ? (
          <div className="px-4 py-3">
            <Notice tone="danger">
              Linear status could not be loaded: {describeAiError(linearQuery.error)}
            </Notice>
          </div>
        ) : linearQuery.isLoading || !linearQuery.data ? (
          <div className="px-4 py-3">
            <Skeleton className="h-8 w-full" />
          </div>
        ) : linearQuery.data.issues.length === 0 ? (
          <div className="px-4 py-3 text-xs text-[var(--wp-muted)]">
            {linearQuery.data.configured
              ? 'No Linear issues yet. One is created when an application is marked applied.'
              : 'Set LINEAR_API_KEY and LINEAR_TEAM_ID in .env to create an issue per application.'}
          </div>
        ) : (
          linearQuery.data.issues.map((issue) => (
            <div
              key={issue.key}
              className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
            >
              <div className="min-w-0">
                <div className="truncate font-medium text-[var(--wp-ink)]">{issue.title}</div>
                <div className="text-xs text-[var(--wp-muted)]">{issue.company}</div>
              </div>
              <Badge variant="neutral">
                <span className="font-mono-meta">{issue.key}</span>
              </Badge>
            </div>
          ))
        )}
      </div>
    </InsetGroup>
  );
}
