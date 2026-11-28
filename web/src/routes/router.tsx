import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  useCanGoBack,
  useNavigate,
  useRouter,
} from '@tanstack/react-router';
import { AppShell } from '@/components/AppShell';
import { Button, Empty } from '@/components/ui';
import { FilesView } from '@/features/files/FilesView';
import { JobPage } from '@/features/job/JobPage';
import { toJobTab, type JobTab } from '@/features/job/tabs';
import { JobsView, type JobsViewMode } from '@/features/jobs/JobsView';
import { SettingsView } from '@/features/settings/SettingsView';
import { SourcesView } from '@/features/sources/SourcesView';
import { TodayView } from '@/features/today/TodayView';
import { TriageView } from '@/features/triage/TriageView';

function RootLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

function useOpenJob() {
  const navigate = useNavigate();
  return (jobId: string) => void navigate({ to: '/jobs/$jobId', params: { jobId } });
}

function NotFound() {
  const navigate = useNavigate();
  return (
    <Empty
      title="Page not found"
      action={<Button onClick={() => void navigate({ to: '/' })}>Go to Jobs</Button>}
    />
  );
}

const rootRoute = createRootRoute({ component: RootLayout, notFoundComponent: NotFound });

const jobsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  validateSearch: (search: Record<string, unknown>): { view?: JobsViewMode } =>
    search.view === 'pipeline' ? { view: 'pipeline' } : {},
  component: function JobsRoute() {
    const { view = 'list' } = jobsRoute.useSearch();
    const navigate = useNavigate();
    return (
      <JobsView
        view={view}
        onViewChange={(next) =>
          void navigate({ to: '/', search: next === 'pipeline' ? { view: next } : {}, replace: true })
        }
        onSelectRole={useOpenJob()}
      />
    );
  },
});

const jobRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/jobs/$jobId',
  validateSearch: (search: Record<string, unknown>): { tab?: JobTab } => {
    const tab = toJobTab(search.tab);
    return tab === 'overview' ? {} : { tab };
  },
  component: function JobRoute() {
    const { jobId } = jobRoute.useParams();
    const { tab = 'overview' } = jobRoute.useSearch();
    const navigate = useNavigate();
    const appRouter = useRouter();
    const canGoBack = useCanGoBack();
    return (
      <JobPage
        jobId={jobId}
        tab={tab}
        onTabChange={(next) =>
          void navigate({
            to: '/jobs/$jobId',
            params: { jobId },
            search: next === 'overview' ? {} : { tab: next },
            replace: true,
          })
        }
        onBack={() => (canGoBack ? appRouter.history.back() : void navigate({ to: '/' }))}
      />
    );
  },
});

const todayRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/today',
  component: function TodayRoute() {
    return <TodayView onSelectRole={useOpenJob()} />;
  },
});

const triageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/triage',
  component: function TriageRoute() {
    return <TriageView onSelectRole={useOpenJob()} />;
  },
});

/** The tracker is now the Jobs pipeline. */
const trackerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tracker',
  beforeLoad: () => {
    throw redirect({ to: '/', search: { view: 'pipeline' } });
  },
});

const filesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/files',
  component: FilesView,
});

const sourcesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sources',
  component: SourcesView,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: function SettingsRoute() {
    const navigate = useNavigate();
    return <SettingsView onOpenSources={() => void navigate({ to: '/sources' })} />;
  },
});

const routeTree = rootRoute.addChildren([
  jobsRoute,
  jobRoute,
  todayRoute,
  triageRoute,
  trackerRoute,
  filesRoute,
  sourcesRoute,
  settingsRoute,
]);

export const router = createRouter({
  routeTree,
  scrollRestoration: true,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
