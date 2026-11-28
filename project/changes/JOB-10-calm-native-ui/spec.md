# JOB-10 — Warm Paper Calm Native UX & Mobile-First UI Overhaul

**Status:** In Progress (PR 10A) (Warm Paper + Terracotta mobile-first prototype approved; awaiting final spec/plan OK to start PR 10A)
**Issue:** JOB-10 · Target Branches: `feat/job-10a-design-system-shell`, `feat/job-10b-focus-triage-today`, `feat/job-10c-tracker-sources-settings`

## Problem / Context

The current `web/` frontend feels generic and high-cognitive-load for daily use:
1. **Hand-rolled primitive layer & card soup:** A single 111-line [`web/src/components/ui.tsx`](../../../web/src/components/ui.tsx) renders flat bordered cards stacked vertically with 4–5 pill badges per row and unstyled native `<input>` / `<select>` elements despite `@base-ui/react` + Tailwind v4 already being installed.
2. **Cognitive overload on Triage & Today:** Every screen dumps full metadata and action buttons at once instead of guiding attention sequentially, lacks a thumb-friendly Focus Queue (`A/S/X`, `←/→`, drag-to-verdict, Undo toast), and clutters the global header with persistent status pills.
3. **Weak mobile-first & calm native craft:** Navigation, sheets, forms, settings rows, and motion feel like a generic admin template rather than a quiet iOS/macOS companion tailored for an ADHD workflow.

## Design North Star (Approved Prototype: `job10-paper-mobile-prototype.html`)

- **Warm Paper + Terracotta Aesthetic:** Tactile, editorial calm inspired by **Apple HIG (iOS/macOS)**, **Things 3**, and **Craft**, built on **`@base-ui/react` + `coss ui`** copy-and-own primitives and **`@tanstack/react-table`**.
  - **Light (Warm Paper):** sidebar `#EDE7DC`, canvas `#F7F4EE`, paper surface `#FDFBF7`, raised `#EFE9DF`, hairline `rgba(31, 27, 22, 0.08)`, ink `#1F1B16`, secondary `#5E554A`, muted `#7B7266`, terracotta accent `#9E472A`, good `#2B7A54`, bad `#B83B33`, subtle warm elevation shadows.
  - **Dark (Warm Charcoal):** sidebar `#12110F`, canvas `#161513`, paper surface `#1C1A18`, raised `#262421`, hairline `rgba(239, 233, 222, 0.08)`, ink `#EFE9DE`, secondary `#AAA398`, muted `#8A847A`, warm terracotta `#DC8562`, good `#4CC38A`, bad `#E5645C`, subtle top inset highlight (`inset 0 1px 0 rgba(255, 255, 255, 0.06)`), high-contrast primary CTA (`#EFE9DE` on `#161513`).
  - **Typography:** Editorial serif display titles (`"New York", "Iowan Old Style", Georgia, serif`, weight 400, `-0.015em` tracking), native sans UI (`-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif`), and tabular monospace (`ui-monospace, "SF Mono", Menlo, monospace`, `tabular-nums`) for scores, dates, and counts.
- **Mobile-First, ADHD-Friendly Progressive Disclosure:** Show at most 3–4 signals on the primary surface (company/location, serif role title, concise summary, 4-part Fit Horizon); keep full job descriptions, deep A–G analysis, Gmail/Calendar/Draft actions, and queue browsing in pull-up bottom sheets (mobile) / slide-over sheets (desktop).
- **Purposeful Calm Motion:** `--ease-calm: cubic-bezier(0.22, 1, 0.36, 1)`, subtle `scale(0.975)` tap response, `sheetRise`/`drawerUp` transitions, `inkCheck` SVG draw on approve, direct 1:1 pointer drag physics on the Triage Focus Sheet, and strict `prefers-reduced-motion: reduce` compliance. Zero purple gradients or pill-badge clutter.

## Goals

1. **Warm Paper Token System & `coss ui` Primitive Layer (`web/src/index.css`, `web/src/lib/theme.ts`, `web/src/components/ui/*`):**
   - Replace monolithic `ui.tsx` with modular copy-and-own `@base-ui/react` primitives (`Button`, `Badge`, `InsetGroup` / `PaperSheet`, `Input`, `Textarea`, `Select`, `Switch`, `Tabs`, `SegmentedControl`, `Sheet`, `Dialog`, `Command`, `Popover`, `Tooltip`, `Toast`, `Meter`, `Kbd`, `Skeleton`, `Empty`, `Separator`).
   - Implement Warm Paper Light / Warm Charcoal Dark / System theme support persisted in `localStorage` with instant `data-theme` attribute application (zero flash).
2. **Mobile-First 4-Tab Shell, Quiet Status & Global `+` / `⌘K` Capture (`AppShell.tsx`, `CommandPalette.tsx`, `QuickAddDialog.tsx`):**
   - **Mobile PWA:** Clean 4-tab safe-area bottom bar (`Today`, `Triage`, `Tracker`, `Settings`) with `Sources` cleanly linked from Settings (`Job boards`) and `⌘K` while preserving the `/sources` route.
   - **Desktop:** Quiet `#EDE7DC` / `#12110F` sidebar (`w-60`) with `+` quick-capture button, nav items (including Sources link), and a single quiet footer status dot opening an AI/Google status popover on click.
   - **Conditional Alert Banner:** Remove permanently crowded top-bar pills; render a calm top alert banner **only** when user action is required (Google OAuth expiring/missing scopes or AI bridge unreachable).
   - **Global `+` / `⌘K`:** Quick-Add Job URL sheet/dialog + Command Palette (route navigation, Quick-Add, Scan Boards, Sync Google/Drive) accessible from every view.
3. **Today — Quiet 3-Section Daily Briefing (`TodayView.tsx`):**
   - Editorial serif date header + one-line summary count + `+` quick capture trigger.
   - Strictly 3 calm paper groups: **Needs a reply**, **Follow ups & upcoming**, and **Worth a look** (top matches tapping straight into Triage Focus or `RoleDetailSheet`).
4. **Triage — Single-Role Focus Paper Sheet, 4-Part Fit Horizon & Drag/Undo (`TriageView.tsx`, `FitHorizon.tsx`, `RoleDetailSheet.tsx`):**
   - Single-role centered Focus Paper Sheet with hairline progress bar (`1 / N`), signature terracotta bookmark notch when saved, dealbreaker soft-tint notice (if triggered), concise summary, and **Signature 4-Part Fit Horizon** (`Role /35`, `Level /25`, `Vibe /25`, `Logistics /15`, terracotta score highlight when `>= 75`).
   - Direct 1:1 pointer/touch horizontal drag physics (`>96px` Approve/Skip threshold, subtle `±2.5deg` tilt, intent labels) paired with thumb-zone action dock (`Skip [X]`, bookmark `[S]`, primary `Approve [A]` with `inkCheck` animation) and calm **Undo toast** reverting accidental verdicts.
   - Pull-up/slide-over **Queue Browser sheet** (`Inbox | Saved | All` filter + jump-to-role; desktop `Queue | List` option) and **`RoleDetailSheet`** (`Posting details` | `Deep analysis` + full Gmail/Calendar/Draft/Commute actions).
5. **Tracker — Things-3-Style Grouped Stage Lists (`TrackerView.tsx`):**
   - Stage-grouped paper lists (`Interview`, `Applied`, `Saved`, collapsing empty stages), subtle Gmail reply/waiting status dots, tabular follow-up dates, Linear issue links, pull-up/inline Stage Picker sheet/select, and `RoleDetailSheet` inspection.
6. **Sources & macOS/iOS System Settings (`SourcesView.tsx`, `SettingsView.tsx`):**
   - **Sources:** Compact `@tanstack/react-table` board list with inline Base UI `Switch` toggles, scan trigger with toast feedback, and collapsible rejection audit section (also reachable from Settings → **Job boards**).
   - **Settings:** Calm grouped paper panels for **Appearance** (`Light | Dark | System`), **AI routing** (`Auto | Claude | Gemini` segmented control + read-only Claude 5h/7d & Gemini health meters), **Profile & sources** (Candidate Profile file count, Drive Project Docs **Sync** & **Rescore**, **Job boards** link, **Google Workspace**, **Maps & LA Commute**, and **Linear** live status).

## Non-Goals

- Adding new backend API endpoints or modifying `crates/api` contracts (consumes `JOB-8` and `JOB-9` APIs directly).
- Native Swift/Electron/Tauri packaging (remains a fast responsive web PWA bundled into `/app/static`).

## Security & Trust Boundary Notes

- Preserve existing XSS/untrusted-content rendering discipline (plain React text/preformatted blocks, `rel="noopener noreferrer"` on external URLs, zero raw HTML injection from job descriptions or emails).
- Maintain public-repo PII hygiene across demo fixtures (`demoData.ts`) and tests.

## Acceptance Criteria

- [ ] **AC1 — Warm Paper Tokens, Theme System & `coss ui` Primitives:** Legacy `ui.tsx` replaced by modular `@base-ui/react` primitives styled with Warm Paper Light / Warm Charcoal Dark tokens, terracotta accent, serif/sans/mono typography, and persisted `Light | Dark | System` selector.
- [ ] **AC2 — Mobile-First Quiet Shell & Global `+` / `⌘K`:** 4-tab mobile bottom nav with safe-area padding + quiet desktop sidebar with status footer popover; conditional alert banner shown only on actionable Google/AI issues; `+` / `⌘K` opens Quick-Add URL & Command Palette from any route (`/sources` route preserved).
- [ ] **AC3 — Focus Triage Sheet, 4-Part Fit Horizon, Drag Physics & Undo:** Default Triage presents single-role Focus Paper Sheet with 4-Part Fit Horizon (`Role/Level/Vibe/Logistics`), bookmark notch, pointer drag-to-verdict, keyboard shortcuts (`A`, `S`, `X`, `←`, `→`), `inkCheck` approve feedback, Undo toast, and Queue Browser (`Inbox | Saved | All`).
- [ ] **AC4 — Calm Today, Grouped Tracker, `RoleDetailSheet` & TanStack Sources:** Today shows max 3 focused paper groups; `RoleDetailSheet` presents Posting details, Deep analysis, and comms/draft actions cleanly; Tracker groups roles by stage with Gmail dots & stage picker; Sources uses `@tanstack/react-table` + collapsible rejection audit.
- [ ] **AC5 — Grouped Settings & Toast Feedback:** Settings uses Warm Paper inset sections for Appearance, AI routing (`Auto | Claude | Gemini`) + provider health meters, Candidate Profile/Drive Sync/Rescore, Job boards link, Google Workspace, LA Commute preview, and Linear status, with Base UI toasts for mutations.
- [ ] **AC6 — Responsive Craft, Motion & Accessibility:** CSS `@container` queries and `tabular-nums` applied consistently; calm motion (`--ease-calm`) and drag physics respect `prefers-reduced-motion`; full keyboard and ARIA compliance across sheets, dialogs, tabs, switches, and menus.
- [ ] **AC7 — Web Verification Suite:** `cd web && npm run typecheck && npm test && npm run build` passes with updated Vitest tests covering Focus Triage navigation/shortcuts/Undo, `+`/`⌘K` Quick-Add, theme switching, grouped Tracker, Sources table, and Settings.
- [ ] **AC8 — Live Desktop & Mobile Tailnet Verification:** Deployed on M2 container stack and visually verified at both desktop and iPhone viewport sizes in Warm Paper Light & Warm Charcoal Dark modes.

## Docs Impact

- `docs/architecture.md` — Update frontend UI stack summary (`@base-ui/react`, `coss ui` patterns, `@tanstack/react-table`, Warm Paper Calm Native design system).
- `README.md` — Update UI feature highlights (Focus Triage Paper Sheet, 4-Part Fit Horizon, `⌘K` Quick Capture, mobile-first Warm Paper PWA).
