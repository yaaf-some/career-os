import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from '@tanstack/react-router';
import { createContext, useContext, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { RoleDetailSheet } from '@/components/RoleDetailSheet';
import { SettingsView } from '@/routes/SettingsView';
import { SourcesView } from '@/routes/SourcesView';
import { TodayView } from '@/routes/TodayView';
import { TrackerView } from '@/routes/TrackerView';
import { TriageView } from '@/routes/TriageView';

interface RoleDrawerContextValue {
  openRole: (jobId: string) => void;
}

const RoleDrawerContext = createContext<RoleDrawerContextValue>({
  openRole: () => {},
});

function useRoleDrawer() {
  return useContext(RoleDrawerContext);
}

function RootLayout() {
  const [activeRoleId, setActiveRoleId] = useState<string | null>(null);

  return (
    <RoleDrawerContext.Provider value={{ openRole: setActiveRoleId }}>
      <AppShell>
        <Outlet />
      </AppShell>
      <RoleDetailSheet jobId={activeRoleId} onClose={() => setActiveRoleId(null)} />
    </RoleDrawerContext.Provider>
  );
}

function TodayRouteComponent() {
  const { openRole } = useRoleDrawer();
  return <TodayView onSelectRole={openRole} />;
}

function TriageRouteComponent() {
  const { openRole } = useRoleDrawer();
  return <TriageView onSelectRole={openRole} />;
}

function TrackerRouteComponent() {
  const { openRole } = useRoleDrawer();
  return <TrackerView onSelectRole={openRole} />;
}

const rootRoute = createRootRoute({
  component: RootLayout,
});

const todayRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: TodayRouteComponent,
});

const triageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/triage',
  component: TriageRouteComponent,
});

const trackerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tracker',
  component: TrackerRouteComponent,
});

const sourcesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sources',
  component: SourcesView,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsView,
});

const routeTree = rootRoute.addChildren([
  todayRoute,
  triageRoute,
  trackerRoute,
  sourcesRoute,
  settingsRoute,
]);

export const router = createRouter({
  routeTree,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
