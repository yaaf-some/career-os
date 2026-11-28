# JOB-10 Plan — Calm Native iOS/macOS UX & UI Overhaul

Prerequisite: `JOB-9` merged (so APIs and UI share `fast`/`balanced`/`deep` and `auto`/`prefer_claude`/`prefer_agy` cleanly). Branch per PR off `main`; never rebase pushed history; verify `npm run typecheck && npm test && npm run build` on every PR.

## PR 10A — Design System, `@coss` Base UI Primitives, Quiet Shell & `⌘K` (`feat/job-10a-design-system-shell`)

- [ ] **1.1 Dependencies & Design Tokens** — `web/package.json`, `web/index.html`, `web/src/index.css`, `web/src/lib/theme.ts`:
  - Install `@tanstack/react-table` (reusing existing `@base-ui/react` v1 + Tailwind v4).
  - Define Calm Native Apple HIG semantic tokens (Light paper & Dark carbon, subtle layered ambient shadows, signal blue accent, sans/mono font stack, `tabular-nums`, View Transitions & `prefers-reduced-motion` rules).
  - Add persisted Light / Dark / System theme manager.
- [ ] **1.2 Copy-and-Own Primitive Suite** — `web/src/components/ui/*`:
  - Replace monolithic `ui.tsx` with clean modular components on `@base-ui/react`: `Button`, `Badge`, `InsetGroup` (Frame), `Input`, `Textarea`, `Select`, `Switch`, `Tabs`, `SegmentedControl`, `Sheet`, `Dialog`, `Command`, `Popover`, `Tooltip`, `Toast`, `Meter`, `Kbd`, `Skeleton`, `Empty`, `Separator`.
  - Add unit tests for interactive primitives (`Select`, `Switch`, `Dialog`/`Sheet`, `Toast`).
- [ ] **1.3 Quiet AppShell, Conditional Alert Banner & Global `⌘K` / Quick-Add** — `web/src/components/{AppShell.tsx,CommandPalette.tsx,QuickAddDialog.tsx,StatusFooter.tsx}`, `web/src/main.tsx`:
  - Replace cluttered header badges with translucent sidebar + sidebar footer status dot popover; render top alert banner only when action is required (OAuth missing scopes/expiring or bridge offline).
  - Wire `⌘K` Command Palette (route switching, Quick-Add modal trigger, manual scan/sync shortcuts) + global Quick-Add URL dialog.
  - Verify: `cd web && npm run typecheck && npm test && npm run build`.

## PR 10B — Focus-First Triage Queue, Calm Today & Detail Sheet (`feat/job-10b-focus-triage-today`)

- [ ] **2.1 Focus-First Triage Queue** — `web/src/routes/TriageView.tsx`, `web/src/components/ScoreBreakdown.tsx`:
  - Build single-role distraction-free Focus Queue with calm card-advance transition, match score meter, expandable 4-dimension breakdown, commute pill, dealbreaker callout, `Overview | JD | Deep Analysis` tabs, bottom verdict bar (`Approve [A] · Shortlist [S] · Skip [X]`, `←/→`), and `Queue | List` segmented toggle.
  - Ignore keyboard shortcuts cleanly when typing in inputs or when dialogs/palettes are open.
- [ ] **2.2 Quiet 3-Section Today Briefing** — `web/src/routes/TodayView.tsx`:
  - Remove inline Quick-Add form in favor of global `+` / `⌘K` button; present max 3 grouped sections (**Replies**, **Upcoming & Follow-ups**, **Top Matches**) linking cleanly to Triage Focus or `RoleDetailSheet`.
- [ ] **2.3 Refactored `RoleDetailSheet`** — `web/src/components/RoleDetailSheet.tsx` (replacing `RoleDetailDrawer.tsx`):
  - Migrate to Base UI `Sheet` + `Tabs` + `Meter` + `InsetGroup` with progressive disclosure and smooth spring/ease-out slide-over.
  - Verify: `cd web && npm run typecheck && npm test && npm run build`.

## PR 10C — Grouped Tracker, TanStack Table Sources, macOS Settings & Docs (`feat/job-10c-tracker-sources-settings`)

- [ ] **3.1 Things-3-Style Grouped Tracker** — `web/src/routes/TrackerView.tsx`:
  - Replace flat card list with stage-grouped inset lists, inline Base UI `Select` stage transition, subtle Gmail status dots, tabular follow-up dates, Linear issue links, and `RoleDetailSheet` inspection.
- [ ] **3.2 TanStack Table Sources & Audit Drawer** — `web/src/routes/SourcesView.tsx`:
  - Migrate ATS/Reddit boards to `@tanstack/react-table` with sorting/filtering, inline `Switch` toggles, clean add-source dialog/bar, and collapsible rejection audit section.
- [ ] **3.3 macOS System Settings Panel** — `web/src/routes/SettingsView.tsx`:
  - Organize Settings into Calm Native grouped inset sections (Appearance Light/Dark/System, Candidate Profile & Project Docs with Sync/Rescore actions, AI Routing mode & read-only provider health, Google Workspace, LA Commute preview, and live Linear integration indicator).
- [ ] **3.4 Vitest Polish, Container Queries & Living Docs** — `web/src/__tests__/*`, `docs/architecture.md`, `README.md`:
  - Update test suite cleanly (`npm run typecheck && npm test && npm run build`).

## Verify & Archive

- [ ] **4.1 Live M2 Desktop & Mobile Check** — Pull updated container on Mac mini, verify Light/Dark/System, Focus Queue keyboard & touch triage, `⌘K` Quick-Add, Tracker, Sources, and Settings on desktop + iOS viewport.
- [ ] **4.2 `project-verify-archive`** — Tick all ACs, archive `JOB-10-calm-native-ui`, update `project/STATE.md`.
