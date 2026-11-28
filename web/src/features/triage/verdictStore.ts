/**
 * Verdicts for this session. A single verdict is held briefly before it is
 * sent, and the last few can be undone before or after that. The store belongs
 * to the query client, so history survives a visit to another screen.
 */
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { queryKeys } from '@/api/queries';
import type { JobsListResponse, JobSummary, PipelineStage, TriageStatus } from '@/api/types';
import { useToast } from '@/components/ui';
import { stageStyle } from '@/lib/stages';
import { sendBatch, sendVerdict, type BatchOutcome, type VerdictAction } from './api';

const HISTORY_LIMIT = 20;

export interface DecidedJob {
  id: string;
  company: string;
  title: string;
  /** Its pipeline stage when it was decided, to spot later progress. */
  stage: PipelineStage;
}

export type EntryStatus = 'held' | 'sending' | 'sent' | 'undoing';

export interface HistoryEntry {
  key: number;
  action: VerdictAction;
  /** More than one for a bulk verdict. */
  jobs: DecidedJob[];
  status: EntryStatus;
}

export interface VerdictState {
  /** Decided here but not yet reflected in the job list. */
  hidden: ReadonlySet<string>;
  /** Newest first. */
  history: HistoryEntry[];
  saved: number;
  skipped: number;
}

export interface BulkFailure {
  job: DecidedJob;
  error: string;
}

const VERB: Record<VerdictAction, string> = { shortlist: 'Saved', skip: 'Skipped' };
const STATUS_AFTER: Record<VerdictAction, TriageStatus> = {
  shortlist: 'shortlisted',
  skip: 'skipped',
};

export function describeEntry(entry: Pick<HistoryEntry, 'action' | 'jobs'>): string {
  const what = entry.jobs.length === 1 ? entry.jobs[0].company : `${entry.jobs.length} jobs`;
  return `${VERB[entry.action]} ${what}`;
}

const stageOf = (job: JobSummary): PipelineStage => (job.inPipeline ? job.stage : 'saved');

const decided = (job: JobSummary): DecidedJob => ({
  id: job.id,
  company: job.company,
  title: job.title,
  stage: stageOf(job),
});

function createVerdictStore(client: QueryClient) {
  let state: VerdictState = { hidden: new Set(), history: [], saved: 0, skipped: 0 };
  let nextKey = 1;
  let held: { key: number; timer: number } | null = null;
  const sending = new Map<number, Promise<unknown>>();
  const listeners = new Set<() => void>();
  let notify: (message: string) => void = () => {};

  const set = (patch: Partial<VerdictState>) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  };
  const find = (key: number) => state.history.find((e) => e.key === key);
  const update = (key: number, patch: Partial<HistoryEntry>) =>
    set({ history: state.history.map((e) => (e.key === key ? { ...e, ...patch } : e)) });
  const drop = (key: number) => set({ history: state.history.filter((e) => e.key !== key) });

  const hide = (ids: string[], hidden: boolean) => {
    const next = new Set(state.hidden);
    for (const id of ids) {
      if (hidden) next.add(id);
      else next.delete(id);
    }
    set({ hidden: next });
  };
  const count = (action: VerdictAction, by: number) =>
    set(
      action === 'shortlist'
        ? { saved: Math.max(0, state.saved + by) }
        : { skipped: Math.max(0, state.skipped + by) },
    );

  /** Writes a confirmed change into the cached list, so nothing flickers back before the refetch. */
  const patchCache = (ids: string[], change: (job: JobSummary) => Partial<JobSummary>) => {
    const changed = new Set(ids);
    client.setQueryData<JobsListResponse>(queryKeys.jobs, (old) =>
      old
        ? {
            ...old,
            jobs: old.jobs.map((j) => (changed.has(j.id) ? { ...j, ...change(j) } : j)),
          }
        : old,
    );
  };
  const refresh = () => {
    // `jobs` is a prefix, so job pages and any other job lists are refreshed too.
    void client.invalidateQueries({ queryKey: queryKeys.jobs });
    void client.invalidateQueries({ queryKey: queryKeys.today });
    void client.invalidateQueries({ queryKey: queryKeys.tracker });
  };
  const confirm = (ids: string[], action: VerdictAction) =>
    patchCache(ids, (job) => ({
      triageStatus: STATUS_AFTER[action],
      inPipeline: job.inPipeline || action === 'shortlist',
    }));

  const record = (action: VerdictAction, jobs: DecidedJob[], status: EntryStatus) => {
    const key = nextKey++;
    set({ history: [{ key, action, jobs, status }, ...state.history].slice(0, HISTORY_LIMIT) });
    hide(
      jobs.map((j) => j.id),
      true,
    );
    count(action, jobs.length);
    return key;
  };

  /** Sends the held verdict now. Safe to call at any time. */
  function flush() {
    if (!held) return;
    const { key, timer } = held;
    window.clearTimeout(timer);
    held = null;
    const entry = find(key);
    if (!entry) return;
    const [job] = entry.jobs;
    update(key, { status: 'sending' });
    sending.set(
      key,
      sendVerdict(job.id, entry.action).then(
        () => {
          confirm([job.id], entry.action);
          hide([job.id], false);
          // An undo may already be waiting on this send.
          if (find(key)?.status === 'sending') update(key, { status: 'sent' });
          refresh();
        },
        () => {
          drop(key);
          hide([job.id], false);
          count(entry.action, -1);
          notify(`Could not save your choice for ${job.company}. It is back in the queue.`);
        },
      ),
    );
  }

  /** Decides one job. Returns false if it was already decided. */
  function commit(job: JobSummary, action: VerdictAction, holdMs: number): boolean {
    if (state.hidden.has(job.id)) return false;
    flush();
    const key = record(action, [decided(job)], 'held');
    held = { key, timer: window.setTimeout(flush, holdMs) };
    return true;
  }

  /** Decides many jobs at once and reports the ones the server did not take. */
  async function commitBulk(jobs: JobSummary[], action: VerdictAction): Promise<BulkFailure[]> {
    const targets = jobs.filter((j) => !state.hidden.has(j.id)).map(decided);
    if (targets.length === 0) return [];
    flush();
    const key = record(action, targets, 'sending');
    const ids = targets.map((j) => j.id);
    const send = sendBatch(ids, action).then((outcome: BatchOutcome) => {
      const done = new Set(outcome.done.map((d) => d.jobId));
      confirm([...done], action);
      hide(ids, false);
      count(action, -outcome.failed.length);
      const kept = targets.filter((j) => done.has(j.id));
      if (kept.length === 0) drop(key);
      else {
        const waitingForUndo = find(key)?.status === 'undoing';
        update(key, { jobs: kept, status: waitingForUndo ? 'undoing' : 'sent' });
      }
      refresh();
      const failures = outcome.failed.map((f) => ({
        job: targets.find((j) => j.id === f.jobId)!,
        error: f.error,
      }));
      if (failures.length > 0) {
        notify(`${failures.length} of ${targets.length} jobs were not updated.`);
      }
      return failures;
    });
    sending.set(key, send);
    return send;
  }

  /** Where the job has gone since the verdict, if undoing would now override that. */
  function movedOn(job: DecidedJob, action: VerdictAction): string | null {
    const now = client
      .getQueryData<JobsListResponse>(queryKeys.jobs)
      ?.jobs.find((j) => j.id === job.id);
    if (!now) return null;
    const stage = stageOf(now);
    if (stage !== 'saved' && stage !== job.stage) return `is now at ${stageStyle(stage).label}`;
    if (now.triageStatus !== 'pending' && now.triageStatus !== STATUS_AFTER[action]) {
      return 'was changed somewhere else';
    }
    return null;
  }

  /** Takes a verdict back. Returns the ids that are in the queue again. */
  async function undo(key: number): Promise<string[]> {
    const entry = find(key);
    if (!entry || entry.status === 'undoing') return [];

    if (held?.key === key) {
      window.clearTimeout(held.timer);
      held = null;
      const ids = entry.jobs.map((j) => j.id);
      drop(key);
      hide(ids, false);
      count(entry.action, -ids.length);
      return ids;
    }

    update(key, { status: 'undoing' });
    await sending.get(key);
    // Gone if the send failed: the job is already back.
    const current = find(key);
    if (!current) return [];

    const targets: DecidedJob[] = [];
    for (const job of current.jobs) {
      const reason = movedOn(job, current.action);
      if (reason) notify(`${job.company} ${reason}, so it was left as it is.`);
      else targets.push(job);
    }
    if (targets.length === 0) {
      drop(key);
      return [];
    }

    const ids = targets.map((j) => j.id);
    const outcome: BatchOutcome =
      ids.length === 1
        ? await sendVerdict(ids[0], 'restore').then(
            (done) => ({ done: [done], failed: [] }),
            (err: unknown) => ({
              done: [],
              failed: [{ jobId: ids[0], error: err instanceof Error ? err.message : '' }],
            }),
          )
        : await sendBatch(ids, 'restore');

    const restored = outcome.done.map((d) => d.jobId);
    const keptEntry = new Set(outcome.done.filter((d) => d.applicationId).map((d) => d.jobId));
    patchCache(restored, (job) => ({
      triageStatus: 'pending',
      inPipeline: keptEntry.has(job.id),
    }));
    count(current.action, -restored.length);

    const left = targets.filter((j) => !restored.includes(j.id));
    if (left.length > 0) {
      update(key, { jobs: left, status: 'sent' });
      notify(
        left.length === 1
          ? `Could not undo ${left[0].company}. Try again.`
          : `Could not undo ${left.length} jobs. Try again.`,
      );
    } else {
      drop(key);
      if (current.action === 'shortlist' && keptEntry.size > 0) {
        notify('Back in the queue. A pipeline entry with its own history was kept.');
      }
    }
    refresh();
    return restored;
  }

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setNotify(next: (message: string) => void) {
      notify = next;
    },
    commit,
    commitBulk,
    undo,
    flush,
  };
}

const stores = new WeakMap<QueryClient, ReturnType<typeof createVerdictStore>>();

export function useVerdicts() {
  const client = useQueryClient();
  const { showToast } = useToast();
  const storeRef = useRef<ReturnType<typeof createVerdictStore> | null>(null);
  let store = stores.get(client);
  if (!store) {
    store = createVerdictStore(client);
    stores.set(client, store);
  }
  storeRef.current = store;
  // The toast provider outlives this screen, so late failures are still reported.
  store.setNotify((message) => showToast({ message, tone: 'warning', durationMs: 6000 }));

  // Send the held verdict before the page is hidden, closed or suspended, or we leave.
  useEffect(() => {
    const flush = () => storeRef.current?.flush();
    const onHidden = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, []);

  const state = useSyncExternalStore(store.subscribe, store.getState);
  return {
    ...state,
    commit: store.commit,
    commitBulk: store.commitBulk,
    undo: store.undo,
  };
}
