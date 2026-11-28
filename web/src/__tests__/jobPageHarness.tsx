import { useState } from 'react';
import { JobPage } from '@/features/job/JobPage';
import type { JobTab } from '@/features/job/tabs';

/** The job page with the tab state the router normally holds. */
export function JobPageHarness({ jobId }: { jobId: string }) {
  const [tab, setTab] = useState<JobTab>('overview');
  return <JobPage jobId={jobId} tab={tab} onTabChange={setTab} onBack={() => {}} />;
}
