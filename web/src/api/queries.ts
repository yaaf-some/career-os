import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { careerApi } from './client';
import type {
  CalendarReminder,
  CommutePreviewRequest,
  CreateSourceRequest,
  GmailDraft,
  QuickAddJobRequest,
  TriageActionRequest,
  UpdateSettingsRequest,
  UpdateTrackerRequest,
} from './types';

export const queryKeys = {
  healthz: ['healthz'] as const,
  aiUsage: ['ai', 'usage'] as const,
  googleAuthStatus: ['auth', 'google', 'status'] as const,
  today: ['today'] as const,
  jobs: ['jobs'] as const,
  jobDetail: (id: string) => ['jobs', id] as const,
  jobCommute: (id: string) => ['jobs', id, 'commute'] as const,
  tracker: ['tracker'] as const,
  sources: ['sources'] as const,
  settings: ['settings'] as const,
};

export function useHealthQuery() {
  return useQuery({
    queryKey: queryKeys.healthz,
    queryFn: () => careerApi.healthz(),
    staleTime: 60_000,
  });
}

export function useAiUsageQuery() {
  return useQuery({
    queryKey: queryKeys.aiUsage,
    queryFn: () => careerApi.getAiUsage(),
    refetchInterval: 30_000,
  });
}

export function useTodayQuery() {
  return useQuery({
    queryKey: queryKeys.today,
    queryFn: () => careerApi.getToday(),
  });
}

export function useJobsQuery() {
  return useQuery({
    queryKey: queryKeys.jobs,
    queryFn: () => careerApi.listJobs(),
  });
}

export function useJobDetailQuery(jobId: string | null) {
  return useQuery({
    queryKey: queryKeys.jobDetail(jobId ?? 'none'),
    queryFn: () => careerApi.getJob(jobId as string),
    enabled: Boolean(jobId),
  });
}

export function useQuickAddJobMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: QuickAddJobRequest) => careerApi.quickAddJob(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.jobs });
      void qc.invalidateQueries({ queryKey: queryKeys.today });
    },
  });
}

export function useTriageMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: TriageActionRequest }) =>
      careerApi.triageJob(id, payload),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: queryKeys.jobs });
      void qc.invalidateQueries({ queryKey: queryKeys.today });
      void qc.invalidateQueries({ queryKey: queryKeys.tracker });
      void qc.invalidateQueries({ queryKey: queryKeys.jobDetail(vars.id) });
    },
  });
}

export function useEvaluateJobMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => careerApi.evaluateJob(id),
    onSuccess: (_data, id) => {
      void qc.invalidateQueries({ queryKey: queryKeys.jobDetail(id) });
      void qc.invalidateQueries({ queryKey: queryKeys.jobs });
    },
  });
}

export function useTailorJobMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => careerApi.tailorJob(id),
    onSuccess: (_data, id) => {
      void qc.invalidateQueries({ queryKey: queryKeys.jobDetail(id) });
    },
  });
}

export function useSaveEmailDraftMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: Pick<GmailDraft, 'to' | 'subject' | 'body' | 'confirmed'>;
    }) => careerApi.saveEmailDraft(id, payload),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: queryKeys.jobDetail(vars.id) });
      void qc.invalidateQueries({ queryKey: queryKeys.tracker });
      void qc.invalidateQueries({ queryKey: queryKeys.today });
    },
  });
}

export function useCalendarReminderMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: Pick<CalendarReminder, 'title' | 'startsAt' | 'notes'>;
    }) => careerApi.addCalendarReminder(id, payload),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: queryKeys.jobDetail(vars.id) });
      void qc.invalidateQueries({ queryKey: queryKeys.today });
    },
  });
}

export function useTrackerQuery() {
  return useQuery({
    queryKey: queryKeys.tracker,
    queryFn: () => careerApi.getTracker(),
  });
}

export function useUpdateTrackerMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpdateTrackerRequest) => careerApi.updateTracker(payload),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: queryKeys.tracker });
      void qc.invalidateQueries({ queryKey: queryKeys.today });
      void qc.invalidateQueries({ queryKey: queryKeys.jobDetail(vars.jobId) });
    },
  });
}

export function useSourcesQuery() {
  return useQuery({
    queryKey: queryKeys.sources,
    queryFn: () => careerApi.getSources(),
  });
}

export function useCreateSourceMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateSourceRequest) => careerApi.createSource(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.sources });
    },
  });
}

export function useScanSourcesMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => careerApi.scanSources(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.sources });
      void qc.invalidateQueries({ queryKey: queryKeys.jobs });
      void qc.invalidateQueries({ queryKey: queryKeys.today });
    },
  });
}

export function useSettingsQuery() {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => careerApi.getSettings(),
  });
}

export function useUpdateSettingsMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpdateSettingsRequest) => careerApi.updateSettings(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.settings });
    },
  });
}

export function useGoogleAuthStatusQuery() {
  return useQuery({
    queryKey: queryKeys.googleAuthStatus,
    queryFn: () => careerApi.getGoogleAuthStatus(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

export function useGoogleAuthMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => careerApi.startGoogleAuth(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.googleAuthStatus });
      void qc.invalidateQueries({ queryKey: queryKeys.settings });
    },
  });
}

export function useJobCommuteQuery(jobId: string | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.jobCommute(jobId ?? 'none'),
    queryFn: () => careerApi.getJobCommute(jobId as string),
    enabled: Boolean(jobId) && enabled,
    staleTime: 300_000,
  });
}

export function useCommutePreviewMutation() {
  return useMutation({
    mutationFn: (payload: CommutePreviewRequest) => careerApi.previewCommute(payload),
  });
}
