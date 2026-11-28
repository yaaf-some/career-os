import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, request } from '@/api/core';
import type { ApiEvaluationRecord, ApiJobDetailResponse, ApiJobRecord } from '@/api/jobs';
import { queryKeys } from '@/api/queries';

/** The stored job row, including fields the shared job detail does not carry. */
export interface JobRow extends ApiJobRecord {
  yoe_label: string | null;
  guard_flags_json: string | null;
}

export type EvaluationRow = ApiEvaluationRecord & { report_md: string | null };

export type RawJobDetail = Omit<ApiJobDetailResponse, 'job' | 'evaluations'> & {
  job: JobRow;
  evaluations: EvaluationRow[];
};

/** Only the fields that are sent change; `null` clears an optional one. */
export interface JobPatch {
  title?: string;
  company?: string;
  url?: string;
  location?: string | null;
  workplace_type?: string | null;
  salary_min?: number | null;
  salary_max?: number | null;
  salary_currency?: string | null;
  yoe_label?: string | null;
}

export interface JobNote {
  id: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface JobAnnotations {
  notes: JobNote[];
  tags: string[];
}

const jobPath = (id: string) => `/api/jobs/${encodeURIComponent(id)}`;

/** The API prefixes its messages with the error kind; people don't need it. */
export function errorText(err: unknown): string {
  const message = err instanceof ApiError || err instanceof Error ? err.message : '';
  return message.replace(/^(bad request|conflict|not found): /, '') || 'Something went wrong';
}

/** Both keys sit under the job's detail key, so its invalidations reach them. */
const rawKey = (id: string) => [...queryKeys.jobDetail(id), 'raw'] as const;
const annotationsKey = (id: string) => [...queryKeys.jobDetail(id), 'annotations'] as const;

export function useRawJobQuery(jobId: string) {
  return useQuery({
    queryKey: rawKey(jobId),
    queryFn: () => request<RawJobDetail>(jobPath(jobId)),
  });
}

/** A job's fields and visibility show up in every job screen. */
function useRefreshEverywhere() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: queryKeys.jobs });
    void qc.invalidateQueries({ queryKey: queryKeys.today });
    void qc.invalidateQueries({ queryKey: queryKeys.tracker });
  };
}

export function useUpdateJobMutation(jobId: string) {
  const refresh = useRefreshEverywhere();
  return useMutation({
    mutationFn: (patch: JobPatch) =>
      request<JobRow>(jobPath(jobId), { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: refresh,
  });
}

export function useArchiveJobMutation(jobId: string) {
  const refresh = useRefreshEverywhere();
  return useMutation({
    mutationFn: (archived: boolean) =>
      request<JobRow>(`${jobPath(jobId)}/archive`, {
        method: 'PUT',
        body: JSON.stringify({ archived }),
      }),
    onSuccess: refresh,
  });
}

export function useDeleteJobMutation(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      request<{ deleted: string }>(`${jobPath(jobId)}?confirm=true`, { method: 'DELETE' }),
    onSuccess: () => {
      // Refetching the deleted job would flash an error before the page is left.
      void qc.invalidateQueries({
        queryKey: queryKeys.jobs,
        predicate: (query) => query.queryKey[1] !== jobId,
      });
      void qc.invalidateQueries({ queryKey: queryKeys.today });
      void qc.invalidateQueries({ queryKey: queryKeys.tracker });
    },
  });
}

export function useAnnotationsQuery(jobId: string) {
  return useQuery({
    queryKey: annotationsKey(jobId),
    queryFn: () => request<JobAnnotations>(`${jobPath(jobId)}/annotations`),
  });
}

export type AnnotationChange =
  | { type: 'addNote'; body: string }
  | { type: 'editNote'; noteId: string; body: string }
  | { type: 'deleteNote'; noteId: string }
  | { type: 'addTag'; tag: string }
  | { type: 'renameTag'; from: string; to: string }
  | { type: 'removeTag'; tag: string };

export function annotationRequest(jobId: string, change: AnnotationChange): [string, RequestInit] {
  const base = jobPath(jobId);
  const send = (method: string, body: unknown) => ({ method, body: JSON.stringify(body) });
  switch (change.type) {
    case 'addNote':
      return [`${base}/notes`, send('POST', { body: change.body })];
    case 'editNote':
      return [
        `${base}/notes/${encodeURIComponent(change.noteId)}`,
        send('PATCH', { body: change.body }),
      ];
    case 'deleteNote':
      return [`${base}/notes/${encodeURIComponent(change.noteId)}`, { method: 'DELETE' }];
    case 'addTag':
      return [`${base}/tags`, send('POST', { tag: change.tag })];
    case 'renameTag':
      return [`${base}/tags`, send('PATCH', { from: change.from, to: change.to })];
    case 'removeTag':
      return [`${base}/tags?${new URLSearchParams({ tag: change.tag })}`, { method: 'DELETE' }];
  }
}

/** Every note and tag call answers with the new lists. */
export function useAnnotationMutation(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (change: AnnotationChange) =>
      request<JobAnnotations>(...annotationRequest(jobId, change)),
    onSuccess: (data, change) => {
      qc.setQueryData(annotationsKey(jobId), data);
      // Tags also show in the job list.
      if (change.type.endsWith('Tag')) {
        void qc.invalidateQueries({ queryKey: queryKeys.jobs, exact: true });
      }
    },
  });
}
