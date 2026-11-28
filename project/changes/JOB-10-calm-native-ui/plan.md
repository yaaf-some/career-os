# JOB-10 Plan — Warm Paper Calm Native UX & Mobile-First UI Overhaul

Prerequisite: `JOB-9` merged & archived (`a74dce1`). Branch per PR off `main`; never rebase pushed history; verify `cd web && npm run typecheck && npm test && npm run build` on every PR.

## PR 10A — Warm Paper Design System, Base UI Primitives, Quiet Shell & `⌘K` (`feat/job-10a-design-system-shell`)

- [x] **1.1 Dependencies, Warm Paper Tokens & Theme Manager** — `web/package.json`, `web/index.html`, `web/src/index.css`, `web/src/lib/theme.ts`:
  - Install `@tanstack/react-table` (reusing `@base-ui/react` v1 + Tailwind v4).
  - Define Warm Paper Light (`#F7F4EE` / `#FDFBF7` / `#9E472A` terracotta) and Warm Charcoal Dark (`#161513` / `#1C1A18` / `#DC8562`) semantic tokens, editorial serif / humanist sans / tabular mono font rules, `.paper-sheet` / `.paper-floating`, `--ease-calm` keyframes (`sheetRise`, `drawerUp`, `rowFade`, `inkCheck`), and `prefers-reduced-motion: reduce` overrides.
  - Add persisted `light | dark | system` theme provider with zero-flash initialization.
- [x] **1.2 Copy-and-Own `@base-ui/react` Primitive Suite** — `web/src/components/ui/*`:
  - Replace monolithic `ui.tsx` with modular Warm Paper primitives: `Button`, `Badge`, `InsetGroup` (`PaperSheet`), `Input`, `Textarea`, `Select`, `Switch`, `Tabs`, `SegmentedControl`, `Sheet` (bottom sheet on mobile / right slide-over on desktop), `Dialog`, `Command`, `Popover`, `Tooltip`, `Toast` (with Undo action support), `Meter`, `Kbd`, `Skeleton`, `Empty`, `Separator`.
  - Keep a thin compatibility barrel if needed during 10A so unmodified views compile cleanly until 10B/10C migrate them.
  - Add unit tests for interactive primitives (`Select`, `Switch`, `Sheet`/`Dialog`, `Toast` Undo).
- [x] **1.3 Mobile-First Quiet Shell, Status Popover & Global `+` / `⌘K`** — `web/src/components/{AppShell.tsx,CommandPalette.tsx,QuickAddDialog.tsx,StatusFooter.tsx,AlertBanner.tsx}`, `web/src/main.tsx`:
  - Mobile: clean 4-tab safe-area bottom bar (`Today`, `Triage`, `Tracker`, `Settings`). Desktop: `#EDE7DC` / `#12110F` quiet sidebar with `+` Quick-Add trigger, primary nav + Sources link, and quiet footer status dot popover (AI routing/quota + Google connection summary).
  - Conditional top alert banner rendered **only** when user action is required (Google OAuth expiring/missing scopes or AI bridge unreachable).
  - Global `⌘K` Command Palette (route navigation, Quick-Add URL, Scan Boards, Sync Google/Drive) + Quick-Add URL sheet/dialog.
  - Verify: `cd web && npm run typecheck && npm test && npm run build`.

## PR 10B — Focus-First Triage Paper Sheet, Fit Horizon, Calm Today & `RoleDetailSheet` (`feat/job-10b-focus-triage-today`)

- [x] **2.1 Signature 4-Part Fit Horizon & Focus Triage Paper Sheet** — `web/src/components/FitHorizon.tsx`, `web/src/routes/TriageView.tsx`:
  - Build single-role Focus Paper Sheet with hairline progress bar (`1 / N`), terracotta bookmark notch when saved, soft-tint dealbreaker callout, concise summary, and 4-Part Fit Horizon (`Role /35`, `Level /25`, `Vibe /25`, `Logistics /15`, terracotta score emphasis at `>= 75`).
  - Add direct 1:1 pointer drag physics (`translate3d` + `±2.5deg` tilt, Approve/Skip intent cues, `>96px` commit, disabled under `prefers-reduced-motion`).
  - Build thumb-zone Action Dock (`Skip [X]`, bookmark `[S]`, primary `Approve [A]` with `inkCheck` SVG draw) + calm **Undo toast** reverting accidental verdicts, plus Queue Browser sheet (`Inbox | Saved | All` filter + jump-to-role; desktop `Queue | List` toggle).
  - Ignore keyboard shortcuts cleanly when typing in inputs or when dialogs/sheets/palettes are open.
- [x] **2.2 Quiet 3-Section Today Briefing** — `web/src/routes/TodayView.tsx`:
  - Editorial serif date header + summary counts + `+` quick capture trigger; remove inline Quick-Add form.
  - Render strictly 3 Warm Paper inset groups: **Needs a reply**, **Follow ups & upcoming**, and **Worth a look** (jumping directly into Triage Focus or `RoleDetailSheet`).
- [x] **2.3 Refactored `RoleDetailSheet`** — `web/src/components/RoleDetailSheet.tsx` (replacing `RoleDetailDrawer.tsx`):
  - Migrate to Warm Paper Base UI `Sheet` (pull-up bottom sheet on mobile, slide-over on desktop) with `Posting details | Deep analysis` tabs, Fit Horizon card, Deep Analysis trigger/report, commute badge, and Gmail/Calendar/Draft controls.
  - Verify: `cd web && npm run typecheck && npm test && npm run build`.

## PR 10C — Grouped Tracker, TanStack Table Sources, Grouped Settings & Docs (`feat/job-10c-tracker-sources-settings`)

- [ ] **3.1 Things-3-Style Grouped Tracker & Stage Picker** — `web/src/routes/TrackerView.tsx`:
  - Stage-grouped Warm Paper lists (`Interview`, `Applied`, `Saved`, collapsing empty stages), subtle Gmail reply/waiting dots, tabular follow-up dates, Linear issue links, pull-up/inline Stage Picker (`Sheet`/`Select`), and `RoleDetailSheet` inspection.
- [ ] **3.2 TanStack Table Sources & Rejection Audit** — `web/src/routes/SourcesView.tsx`:
  - Migrate ATS/Reddit boards to `@tanstack/react-table` with sorting/filtering, inline Base UI `Switch` toggles, scan trigger with toast feedback, clean Add Source dialog, and collapsible rejection audit section.
- [ ] **3.3 Grouped Warm Paper Settings** — `web/src/routes/SettingsView.tsx`:
  - Organize into Warm Paper inset sections: **Appearance** (`Light | Dark | System`), **AI routing** (`Auto | Claude | Gemini` segmented control + read-only Claude & Gemini usage meters), **Profile & sources** (Candidate Profile file status, Drive **Sync** & **Rescore**, **Job boards** link to `/sources`, **Google Workspace**, **Maps & LA Commute** preview, and live **Linear** status).
- [ ] **3.4 Vitest Polish, Container Queries & Living Docs** — `web/src/__tests__/*`, `docs/architecture.md`, `README.md`:
  - Update test suite cleanly covering Focus Triage/Undo, `+`/`⌘K` Quick-Add, theme toggle, grouped Tracker, Sources table, and Settings; sync `docs/architecture.md` & `README.md`.
  - Verify: `cd web && npm run typecheck && npm test && npm run build`.

## Verify & Archive

- [ ] **4.1 Live M2 Desktop & Mobile Check** — Pull updated container on Mac mini, verify Warm Paper Light / Warm Charcoal Dark / System, Focus Triage drag + keyboard + Undo, `⌘K` Quick-Add, Tracker, Sources, and Settings across desktop and iPhone viewports.
- [ ] **4.2 `project-verify-archive`** — Tick all ACs, archive `JOB-10-calm-native-ui`, update `project/STATE.md`.
