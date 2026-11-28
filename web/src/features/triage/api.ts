import { careerApi } from '@/api/client';
import { request } from '@/api/core';

export type VerdictAction = 'shortlist' | 'skip';
export type ServerAction = VerdictAction | 'restore';

export interface VerdictOutcome {
  jobId: string;
  /** For `restore`, the pipeline entry the server kept, if any. */
  applicationId: string | null;
}

export interface BatchOutcome {
  done: VerdictOutcome[];
  failed: { jobId: string; error: string }[];
}

interface ApiTriageResponse {
  job_id: string;
  triage_status: string;
  application_id: string | null;
}

interface ApiTriageBatchResponse {
  results: ApiTriageResponse[];
  failed?: { job_id: string; error: string }[];
}

/** The server's cap on one batch. */
const BATCH_LIMIT = 100;

const isDemoBuild = () => import.meta.env.VITE_DEMO_MODE === 'true';

const fromApi = (r: ApiTriageResponse): VerdictOutcome => ({
  jobId: r.job_id,
  applicationId: r.application_id,
});

/** One verdict. `keepalive` lets it finish while the page is being closed. */
export async function sendVerdict(jobId: string, action: ServerAction): Promise<VerdictOutcome> {
  if (isDemoBuild()) {
    await careerApi.triageJob(jobId, { action });
    return { jobId, applicationId: null };
  }
  return fromApi(
    await request<ApiTriageResponse>(`/api/triage/${encodeURIComponent(jobId)}`, {
      method: 'POST',
      body: JSON.stringify({ action }),
      keepalive: true,
    }),
  );
}

/** Many verdicts. Never throws: every job comes back as done or failed. */
export async function sendBatch(jobIds: string[], action: ServerAction): Promise<BatchOutcome> {
  const out: BatchOutcome = { done: [], failed: [] };
  const chunks: string[][] = [];
  for (let i = 0; i < jobIds.length; i += BATCH_LIMIT) {
    chunks.push(jobIds.slice(i, i + BATCH_LIMIT));
  }
  // All at once, so every request has started if the page is closing.
  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        if (isDemoBuild()) {
          for (const id of chunk) out.done.push(await sendVerdict(id, action));
          return;
        }
        const res = await request<ApiTriageBatchResponse>('/api/triage/batch', {
          method: 'POST',
          body: JSON.stringify({ job_ids: chunk, action }),
          keepalive: true,
        });
        const done = new Set(res.results.map((r) => r.job_id));
        const reasons = new Map((res.failed ?? []).map((f) => [f.job_id, f.error]));
        out.done.push(...res.results.map(fromApi));
        // A job missing from the results failed, whether or not a reason came back.
        for (const jobId of chunk) {
          if (!done.has(jobId)) {
            out.failed.push({ jobId, error: reasons.get(jobId) ?? 'not updated' });
          }
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : 'request failed';
        for (const jobId of chunk) out.failed.push({ jobId, error });
      }
    }),
  );
  return out;
}
