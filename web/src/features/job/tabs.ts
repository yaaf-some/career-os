export const JOB_TABS = ['overview', 'fit', 'activity', 'documents'] as const;

export type JobTab = (typeof JOB_TABS)[number];

export function toJobTab(value: unknown): JobTab {
  return JOB_TABS.includes(value as JobTab) ? (value as JobTab) : 'overview';
}
