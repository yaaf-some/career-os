import {
  columnFilteringFeature,
  createColumnHelper,
  createFilteredRowModel,
  createSortedRowModel,
  filterFns,
  flexRender,
  globalFilteringFeature,
  rowSortingFeature,
  sortFns,
  tableFeatures,
  useTable,
  type SortingState,
} from '@tanstack/react-table';
import { ArrowUpDown, ChevronDown, ChevronRight, ExternalLink, Plus, Radar, Search } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import {
  useCreateSourceMutation,
  useScanSourcesMutation,
  useSetSourceEnabledMutation,
  useSourcesQuery,
} from '@/api/queries';
import type { JobSource } from '@/api/types';
import {
  Badge,
  Button,
  Input,
  InsetGroup,
  PaperSheet,
  Select,
  Switch,
  useToast,
} from '@/components/ui';
import { buildXSearchUrl, DEFAULT_X_SEARCH_PRESETS } from '@/lib/twitterSearch';

const SOURCE_KIND_OPTIONS = [
  { value: 'greenhouse', label: 'Greenhouse' },
  { value: 'ashby', label: 'Ashby' },
  { value: 'lever', label: 'Lever' },
  { value: 'reddit', label: 'Reddit' },
  { value: 'custom', label: 'Custom' },
] as const;

const sourceTableFeatures = tableFeatures({
  columnFilteringFeature,
  globalFilteringFeature,
  rowSortingFeature,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
  filterFns,
  sortFns,
});

const columnHelper = createColumnHelper<typeof sourceTableFeatures, JobSource>();

export function SourcesView() {
  const sourcesQuery = useSourcesQuery();
  const createSourceMutation = useCreateSourceMutation();
  const scanMutation = useScanSourcesMutation();
  const toggleMutation = useSetSourceEnabledMutation();
  const { showToast } = useToast();

  const [name, setName] = useState('');
  const [kind, setKind] = useState<JobSource['kind']>('greenhouse');
  const [boardUrl, setBoardUrl] = useState('');
  const [customXKeywords, setCustomXKeywords] = useState('Rust, TypeScript, Systems');
  const [globalFilter, setGlobalFilter] = useState('');
  const [sorting, setSorting] = useState<SortingState>([]);
  const [auditExpanded, setAuditExpanded] = useState(true);

  const data = sourcesQuery.data;
  const sources = useMemo(() => data?.sources ?? [], [data?.sources]);

  const columns = useMemo(
    () =>
      columnHelper.columns([
        columnHelper.accessor('name', {
          header: 'Board',
          cell: (info) => {
            const src = info.row.original;
            return (
              <div className="min-w-0 py-0.5">
                <div className="truncate text-sm font-medium text-[var(--wp-ink)]">{src.name}</div>
                <div className="truncate text-xs text-[var(--wp-muted)]">{src.boardUrl}</div>
                {src.lastError ? (
                  <div className="truncate text-xs text-[var(--wp-bad)]" title={src.lastError}>
                    Last scan failed: {src.lastError}
                  </div>
                ) : null}
              </div>
            );
          },
        }),
        columnHelper.accessor('kind', {
          header: 'Provider',
          cell: (info) => <Badge variant="neutral">{info.getValue()}</Badge>,
        }),
        columnHelper.accessor('matchedCount', {
          header: 'Matches',
          cell: (info) => (
            <span className="font-mono-meta text-xs text-[var(--wp-secondary)]">
              {info.getValue()} matched
            </span>
          ),
        }),
        columnHelper.display({
          id: 'enabled',
          header: 'Scan',
          cell: (info) => {
            const src = info.row.original;
            return (
              <div className="flex justify-end">
                <Switch
                  checked={src.enabled}
                  disabled={toggleMutation.isPending}
                  ariaLabel={`Scan ${src.name}`}
                  onCheckedChange={(checked) =>
                    toggleMutation.mutate(
                      { id: src.id, enabled: checked },
                      {
                        onSuccess: () =>
                          showToast({
                            message: `${src.name} scanning ${checked ? 'enabled' : 'paused'}`,
                          }),
                      },
                    )
                  }
                />
              </div>
            );
          },
        }),
      ]),
    [showToast, toggleMutation],
  );

  const table = useTable(
    {
      features: sourceTableFeatures,
      data: sources,
      columns,
      state: { sorting, globalFilter },
      onSortingChange: setSorting,
      onGlobalFilterChange: setGlobalFilter,
    },
    (state) => state,
  );

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
        onSuccess: (created) => {
          setName('');
          setBoardUrl('');
          showToast({ tone: 'success', message: `Added ${created.name}` });
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

  const filteredAudit = data?.filteredAudit ?? [];

  return (
    <div className="mx-auto max-w-[760px] space-y-6" data-testid="sources-view">
      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <div>
          <h1 className="text-base font-medium text-[var(--wp-ink)]">Job boards &amp; sources</h1>
          <p className="mt-0.5 text-xs text-[var(--wp-muted)]">
            {sources.length} configured · filtered by targeting.yml
          </p>
        </div>
        <Button
          variant="primary"
          disabled={scanMutation.isPending}
          onClick={() =>
            scanMutation.mutate(undefined, {
              onSuccess: (res) =>
                showToast({
                  tone: 'success',
                  message: `Scanned ${res.scannedSources} boards · ${res.newMatches} new matches`,
                }),
            })
          }
        >
          <Radar className="h-4 w-4" />
          <span>{scanMutation.isPending ? 'Scanning…' : 'Trigger ATS / Reddit Scan'}</span>
        </Button>
      </div>

      {scanMutation.isError ? (
        <p
          role="alert"
          className="rounded-[12px] bg-[var(--wp-bad-soft)] px-4 py-2.5 text-xs text-[var(--wp-bad)]"
        >
          Scan failed:{' '}
          {scanMutation.error instanceof Error ? scanMutation.error.message : 'unknown error'}
        </p>
      ) : null}

      {scanMutation.data ? (
        <PaperSheet className="bg-[var(--wp-good-soft)] px-4 py-3 text-xs text-[var(--wp-good)]">
          Scan finished: {scanMutation.data.scannedSources} sources checked,{' '}
          <strong>{scanMutation.data.newMatches}</strong> new matches queued,{' '}
          {scanMutation.data.filteredOut} filtered out.
        </PaperSheet>
      ) : null}

      {/* Add Board + TanStack Table */}
      <section className="space-y-3">
        <PaperSheet className="space-y-4 p-4">
          <form onSubmit={handleAddSource} className="grid gap-2 sm:grid-cols-[1fr_auto_1.4fr_auto]">
            <Input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Company / board"
              aria-label="Board name"
            />
            <Select
              ariaLabel="Board provider"
              value={kind}
              onValueChange={setKind}
              options={SOURCE_KIND_OPTIONS}
              className="h-10"
            />
            <Input
              type="url"
              required
              value={boardUrl}
              onChange={(e) => setBoardUrl(e.target.value)}
              placeholder="https://boards.greenhouse.io/example"
              aria-label="Board URL"
            />
            <Button type="submit" variant="secondary" disabled={createSourceMutation.isPending}>
              <Plus className="h-4 w-4" />
              <span>Add</span>
            </Button>
          </form>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--wp-muted)]" />
            <Input
              type="search"
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              placeholder="Filter boards…"
              aria-label="Filter boards"
              className="h-9 pl-9 text-xs"
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm" data-testid="sources-table">
              <thead>
                {table.getHeaderGroups().map((hg) => (
                  <tr
                    key={hg.id}
                    className="border-b border-[var(--wp-hairline)] text-xs text-[var(--wp-muted)]"
                  >
                    {hg.headers.map((header) => {
                      const canSort = header.column.getCanSort();
                      return (
                        <th key={header.id} className="py-2 pr-3 font-medium last:pr-0 last:text-right">
                          {canSort ? (
                            <button
                              type="button"
                              onClick={header.column.getToggleSortingHandler()}
                              className="inline-flex items-center gap-1 hover:text-[var(--wp-ink)]"
                            >
                              {flexRender(header.column.columnDef.header, header.getContext())}
                              <ArrowUpDown className="h-3 w-3 opacity-60" />
                            </button>
                          ) : (
                            flexRender(header.column.columnDef.header, header.getContext())
                          )}
                        </th>
                      );
                    })}
                  </tr>
                ))}
              </thead>
              <tbody className="divide-y divide-[var(--wp-hairline)]">
                {table.getRowModel().rows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-xs text-[var(--wp-muted)]">
                      No matching job boards.
                    </td>
                  </tr>
                ) : (
                  table.getRowModel().rows.map((row) => (
                    <tr key={row.id}>
                      {row.getAllCells().map((cell) => (
                        <td key={cell.id} className="py-3 pr-3 align-middle last:pr-0">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </PaperSheet>
      </section>

      {/* X / Twitter Saved Searches */}
      <InsetGroup label="1-click X / Twitter searches">
        {DEFAULT_X_SEARCH_PRESETS.map((preset) => (
          <a
            key={preset.id}
            href={buildXSearchUrl(preset)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-[var(--wp-raised)]/45"
          >
            <div className="min-w-0">
              <div className="text-sm font-medium text-[var(--wp-ink)]">{preset.label}</div>
              <div className="text-xs text-[var(--wp-muted)]">{preset.description}</div>
            </div>
            <ExternalLink className="h-4 w-4 shrink-0 text-[var(--wp-accent)]" />
          </a>
        ))}
        <div className="space-y-2 px-4 py-3">
          <label className="block space-y-1 text-xs text-[var(--wp-muted)]">
            <span>Custom keywords (comma-separated)</span>
            <Input
              type="text"
              value={customXKeywords}
              onChange={(e) => setCustomXKeywords(e.target.value)}
            />
          </label>
          <a
            href={customXUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="tap-control inline-flex items-center gap-1.5 rounded-[10px] bg-[var(--wp-raised)] px-3 py-1.5 text-xs font-medium text-[var(--wp-ink)] hover:opacity-90"
          >
            <span>Launch Custom X Search</span>
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </InsetGroup>

      {/* Collapsible filtered_audit Rejection Log */}
      <section className="space-y-2">
        <PaperSheet className="overflow-hidden">
          <button
            type="button"
            aria-expanded={auditExpanded}
            onClick={() => setAuditExpanded((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-3 text-left text-xs font-medium text-[var(--wp-ink)] hover:bg-[var(--wp-raised)]/40"
          >
            <span className="flex items-center gap-2">
              {auditExpanded ? (
                <ChevronDown className="h-4 w-4 text-[var(--wp-muted)]" />
              ) : (
                <ChevronRight className="h-4 w-4 text-[var(--wp-muted)]" />
              )}
              <span>filtered_audit Rejection Log</span>
            </span>
            <Badge variant="warning">{filteredAudit.length} entries</Badge>
          </button>

          {auditExpanded ? (
            <div className="border-t border-[var(--wp-hairline)] px-4 py-3">
              {filteredAudit.length === 0 ? (
                <p className="text-xs text-[var(--wp-muted)]">No rejected postings logged yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-[var(--wp-hairline)] text-[var(--wp-muted)]">
                        <th className="py-2 pr-3 font-medium">Role</th>
                        <th className="py-2 pr-3 font-medium">Company / Source</th>
                        <th className="py-2 pr-3 font-medium">Rule</th>
                        <th className="py-2 font-medium">Reason</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--wp-hairline)]">
                      {filteredAudit.map((item) => (
                        <tr key={item.id}>
                          <td className="py-2 pr-3 font-medium text-[var(--wp-ink)]">{item.title}</td>
                          <td className="py-2 pr-3 text-[var(--wp-muted)]">
                            {item.company} ({item.sourceName})
                          </td>
                          <td className="py-2 pr-3">
                            <code className="font-mono-meta rounded bg-[var(--wp-raised)] px-1.5 py-0.5 text-[11px]">
                              {item.rule}
                            </code>
                          </td>
                          <td className="py-2 text-[var(--wp-muted)]">{item.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : null}
        </PaperSheet>
      </section>
    </div>
  );
}
