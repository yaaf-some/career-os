import { ExternalLink, FilterX, Plus, Radar, Search } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import {
  useCreateSourceMutation,
  useScanSourcesMutation,
  useSetSourceEnabledMutation,
  useSourcesQuery,
} from '@/api/queries';
import type { JobSource } from '@/api/types';
import { Badge, Button, Card, SectionHeader } from '@/components/ui';
import { buildXSearchUrl, DEFAULT_X_SEARCH_PRESETS } from '@/lib/twitterSearch';

export function SourcesView() {
  const sourcesQuery = useSourcesQuery();
  const createSourceMutation = useCreateSourceMutation();
  const scanMutation = useScanSourcesMutation();
  const toggleMutation = useSetSourceEnabledMutation();

  const [name, setName] = useState('');
  const [kind, setKind] = useState<JobSource['kind']>('greenhouse');
  const [boardUrl, setBoardUrl] = useState('');
  const [customXKeywords, setCustomXKeywords] = useState('Rust, TypeScript, Systems');

  const handleAddSource = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !boardUrl.trim()) return;
    createSourceMutation.mutate(
      {
        name: name.trim(),
        kind,
        boardUrl: boardUrl.trim(),
      },
      {
        onSuccess: () => {
          setName('');
          setBoardUrl('');
        },
      },
    );
  };

  const customXUrl = buildXSearchUrl({
    label: 'Custom Search',
    keywords: customXKeywords.split(',').map((s) => s.trim()),
    includeHiring: true,
    excludeRetweets: true,
    minFaves: 3,
  });

  const data = sourcesQuery.data;

  return (
    <div className="space-y-6" data-testid="sources-view">
      <SectionHeader
        title="Sources"
        subtitle="Manage ATS & Reddit boards, run discovery scans, inspect filtered_audit rejections, and launch X/Twitter searches."
        action={
          <Button
            variant="primary"
            disabled={scanMutation.isPending}
            onClick={() => scanMutation.mutate()}
          >
            <Radar className="h-4 w-4" />
            <span>{scanMutation.isPending ? 'Scanning…' : 'Trigger ATS / Reddit Scan'}</span>
          </Button>
        }
      />

      {scanMutation.isError ? (
        <p role="alert" className="rounded-md border border-red-500/40 bg-red-500/5 px-3 py-2 text-xs text-destructive">
          Scan failed: {scanMutation.error instanceof Error ? scanMutation.error.message : 'unknown error'}
        </p>
      ) : null}
            {scanMutation.data ? (
        <Card className="border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-700 dark:text-emerald-300">
          Scan finished: {scanMutation.data.scannedSources} sources checked,{' '}
          <strong>{scanMutation.data.newMatches}</strong> new matches queued,{' '}
          {scanMutation.data.filteredOut} filtered out.
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ATS / Reddit Boards */}
        <Card className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">ATS & Reddit Boards</h2>
            <Badge variant="neutral">{data?.sources.length ?? 0} configured</Badge>
          </div>

          <form onSubmit={handleAddSource} className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Board / Company name"
              className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
            />
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as JobSource['kind'])}
              className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm"
            >
              <option value="greenhouse">Greenhouse</option>
              <option value="ashby">Ashby</option>
              <option value="lever">Lever</option>
              <option value="reddit">Reddit</option>
              <option value="custom">Custom</option>
            </select>
            <input
              type="url"
              required
              value={boardUrl}
              onChange={(e) => setBoardUrl(e.target.value)}
              placeholder="https://boards.greenhouse.io/example"
              className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
            />
            <Button type="submit" size="sm" disabled={createSourceMutation.isPending}>
              <Plus className="h-3.5 w-3.5" />
              <span>Add Board</span>
            </Button>
          </form>

          <div className="space-y-2">
            {(data?.sources ?? []).map((src) => (
              <div
                key={src.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{src.name}</span>
                    <Badge variant="neutral">{src.kind}</Badge>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{src.boardUrl}</div>
                  {src.lastError ? (
                    <div className="truncate text-xs text-destructive" title={src.lastError}>
                      Last scan failed: {src.lastError}
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant="brand">{src.matchedCount} matched</Badge>
                  <label className="flex items-center gap-1 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={src.enabled}
                      disabled={toggleMutation.isPending}
                      onChange={(e) => toggleMutation.mutate({ id: src.id, enabled: e.target.checked })}
                      aria-label={`Scan ${src.name}`}
                    />
                    <span>Scan</span>
                  </label>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* X / Twitter Saved Searches */}
        <Card className="p-4 space-y-4">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-accent-brand" />
            <h2 className="text-sm font-semibold">1-Click X / Twitter Saved Searches</h2>
          </div>

          <div className="space-y-2">
            {DEFAULT_X_SEARCH_PRESETS.map((preset) => {
              const href = buildXSearchUrl(preset);
              return (
                <a
                  key={preset.id}
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm transition-colors hover:bg-accent"
                >
                  <div>
                    <div className="font-medium">{preset.label}</div>
                    <div className="text-xs text-muted-foreground">{preset.description}</div>
                  </div>
                  <ExternalLink className="h-4 w-4 shrink-0 text-accent-brand" />
                </a>
              );
            })}
          </div>

          <div className="space-y-2 border-t border-border pt-3">
            <label className="block text-xs font-medium text-muted-foreground">
              Custom X Query Keywords (comma-separated)
              <input
                type="text"
                value={customXKeywords}
                onChange={(e) => setCustomXKeywords(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground"
              />
            </label>
            <a
              href={customXUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-1.5 text-xs font-medium hover:bg-accent"
            >
              <span>Launch Custom X Search</span>
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </Card>
      </div>

      {/* filtered_audit Rejection Log */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <FilterX className="h-4 w-4 text-amber-500" />
            <span>filtered_audit Rejection Log</span>
          </div>
          <Badge variant="warning">{data?.filteredAudit.length ?? 0} entries</Badge>
        </div>

        {(data?.filteredAudit ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No rejected postings logged yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Role</th>
                  <th className="py-2 pr-3 font-medium">Company / Source</th>
                  <th className="py-2 pr-3 font-medium">Rule</th>
                  <th className="py-2 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(data?.filteredAudit ?? []).map((item) => (
                  <tr key={item.id}>
                    <td className="py-2 pr-3 font-medium">{item.title}</td>
                    <td className="py-2 pr-3 text-muted-foreground">
                      {item.company} ({item.sourceName})
                    </td>
                    <td className="py-2 pr-3">
                      <code className="rounded bg-secondary px-1.5 py-0.5 text-xs">{item.rule}</code>
                    </td>
                    <td className="py-2 text-xs text-muted-foreground">{item.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
