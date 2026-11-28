# JOB-10 — Calm Native iOS/macOS UX & UI Overhaul (ADHD-Friendly Focus Architecture)

**Status:** Proposed
**Issue:** JOB-10 (Linear) · Target Branches: `feat/job-10a-design-system-shell`, `feat/job-10b-focus-triage-today`, `feat/job-10c-tracker-sources-settings`

## Problem / Context

The current `web/` frontend feels generic and high-cognitive-load for daily use:
1. **Hand-rolled primitive layer & card soup:** A single 111-line `web/src/components/ui.tsx` renders flat bordered cards stacked vertically with 4–5 pill badges per row and unstyled native `<input>` / `<select>` elements despite `@base-ui/react` + Tailwind v4 already being installed.
2. **Cognitive overload on Triage & Today:** Every screen dumps full metadata and action buttons at once instead of guiding attention sequentially, lacks keyboard/focus-queue flow (`A/S/X`, `←/→`), and exposes cluttered internal status pills in the global top bar.
3. **Weak native mobile/desktop feel:** Navigation, forms, settings rows, and motion feel like a generic template rather than a calm macOS / iOS native companion app tailored for an ADHD workflow.

## Design North Star

- **Calmness & Clarity First:** Inspired by **Apple HIG (macOS / iOS)**, **Things 3**, and **Craft**, built on **`@base-ui/react` + `coss ui`** copy-and-own primitives and **`@tanstack/react-table`**.
- **ADHD-Friendly Progressive Disclosure:** Surface at most 3–4 signals by default (match score, role/company, location/commute, status dot); keep full JDs, 4-dimension score bars, and deep A–G analysis tucked behind clean tabs, expandable sections, and slide-over sheets.
- **Purposeful Motion & Modern Web Craft:** Zero lag on high-frequency actions (`⌘K`, `j/k`, `A/S/X` triage verdicts); gentle `ease-out` / spring curves on focus-card transitions, sheets, and toasts; CSS `@container` queries and View Transitions API; strict `prefers-reduced-motion` compliance; zero purple gradients or pill-badge clutter.

## Goals

1. **Design Token System & `coss ui` Primitive Layer (`web/src/index.css`, `web/src/components/ui/*`):**
   - Replace `ui.tsx` with modular, copy-and-own Base UI + `coss ui` components (`Button`, `Badge`, `InsetGroup` / `Frame`, `Input`, `Textarea`, `Select`, `Switch`, `Tabs`, `SegmentedControl`, `Sheet`, `Dialog`, `Command`, `Popover`, `Tooltip`, `Toast`, `Meter`, `Kbd`, `Skeleton`, `Empty`, `Separator`).
   - Implement Calm Native semantic tokens for **Light** (`#F7F7F5` paper canvas, `#FFFFFF` grouped inset surfaces), **Dark** (`#111214` charcoal canvas, `#1A1C20` grouped surfaces), and **System** mode (user-selectable + persisted in `localStorage`), with subtle layered ambient shadows + hairline borders, one restrained blue signal accent, humanist sans + tabular monospace (`tabular-nums`) for scores/dates/commutes.
2. **Quiet Navigation Chrome & Global `⌘K` Command + Quick-Add (`AppShell.tsx`):**
   - Translucent macOS-style sidebar (desktop) with calm icon-first nav and safe-area iOS bottom tab bar (mobile PWA).
   - Move Quick-Add Job URL into a global **`+` / `⌘K` Command Palette** accessible from every screen.
   - Replace permanently crowded top-bar pills with a quiet sidebar footer status dot (opening a popover with AI/Google details on click) and a calm top banner shown **only** when user action is required (e.g., Google OAuth expiring/missing scopes or AI bridge unreachable).
3. **Today — Quiet 3-Section Daily Briefing (`TodayView.tsx`):**
   - Restrict Today to 3 calm inset groups: **Replies Needing Action**, **Upcoming & Follow-ups**, and **Top Matches to Triage**.
   - Selecting any top match opens that role directly in Triage Focus Queue or its slide-over `RoleDetailSheet`.
4. **Triage — Focus-First Single-Role Queue + List Toggle (`TriageView.tsx`, `RoleDetailSheet.tsx`):**
   - Default to **Focus Queue**: distraction-free single-role workspace showing role header, match score meter + collapsible/clean 4-dimension bars, commute/remote summary, dealbreaker notice (if triggered), one-paragraph triage summary, `Overview | JD | Deep Analysis` tabs, and a calm pinned verdict dock (**Approve `[A]`**, **Shortlist `[S]`**, **Skip `[X]`**, `Prev/Next [←/→]`, progress indicator `1 of N`).
   - Provide a subtle **`Queue | List`** segmented control (plus search/inbox/approved filter) when batch-browsing is wanted.
5. **Tracker — Things-3-Style Grouped Stage Lists (`TrackerView.tsx`):**
   - Render applications in calm grouped inset sections per pipeline stage (collapsing empty stages cleanly), with subtle Gmail thread status dots, tabular follow-up dates, Linear issue links, quick inline stage transition, and slide-over `RoleDetailSheet`.
6. **Sources & Settings (`SourcesView.tsx`, `SettingsView.tsx`):**
   - **Sources:** Compact `@tanstack/react-table` board table with inline enable switches, scan trigger with toast feedback, and a collapsible rejection audit drawer/section.
   - **Settings:** macOS System Settings-style grouped inset sections (**Appearance**, **Candidate Profile & Project Docs**, **AI Routing & Provider Health**, **Google Workspace**, **LA Commute & Maps**, **Linear Integration** showing real connected status).

## Non-Goals

- Adding new backend API endpoints or modifying `crates/api` contracts (consumes `JOB-8` and `JOB-9` APIs directly).
- Desktop Electron/Tauri packaging (stays a fast responsive web PWA).

## Security & Trust Boundary Notes

- Preserve existing XSS/untrusted-content rendering discipline (plain React text/preformatted blocks, `rel="noopener noreferrer"` on external URLs, zero raw HTML injection from job descriptions or emails).
- Maintain public-repo PII hygiene across demo fixtures (`demoData.ts`) and tests.

## Acceptance Criteria

- [ ] **AC1 — `coss ui` + Base UI Component Library & Theme System:** Legacy `ui.tsx` replaced by modular `@base-ui/react` primitives styled with Calm Native tokens; Light/Dark/System selector works and persists cleanly.
- [ ] **AC2 — Quiet Chrome & `⌘K` Command / Quick-Add:** Desktop sidebar + iOS bottom tab bar with safe-area padding; global `⌘K` / `+` opens Command Palette & Quick-Add URL from any route; noisy header status pills are tucked into sidebar status popover and surface inline banners only on actionable alerts.
- [ ] **AC3 — Focus-First Triage Queue:** Default Triage presents one role at a time with match score + 4-dimension breakdown, Deep Analysis trigger, keyboard shortcuts (`A`, `S`, `X`, `←`, `→`), subtle progress counter, and working `Queue | List` segmented toggle.
- [ ] **AC4 — Calm Today, Grouped Tracker & Table Sources:** Today shows max 3 focused sections; Tracker displays stage-grouped inset lists with inline stage changes and Gmail/Linear metadata; Sources uses `@tanstack/react-table` + collapsible rejection log.
- [ ] **AC5 — macOS-Style Settings & Toast Feedback:** Settings uses grouped inset panels for Appearance, Profile/Docs sync & rescore, AI routing mode, Google OAuth, Maps preview, and Linear live status; mutations provide calm Base UI toasts instead of jarring inline banners.
- [ ] **AC6 — Responsive Craft, Motion & Accessibility:** CSS `@container` queries and `tabular-nums` applied consistently; View Transitions and spring/ease-out transitions respect `prefers-reduced-motion`; full keyboard and ARIA compliance across dialogs, sheets, tabs, and menus.
- [ ] **AC7 — Web Verification Suite:** `cd web && npm run typecheck && npm test && npm run build` passes with updated Vitest tests covering Focus Triage navigation/shortcuts, `⌘K` Quick-Add, theme toggle, grouped Tracker, and Settings.
- [ ] **AC8 — Live Desktop & Mobile Tailnet Verification:** Deployed on M2 container stack and visually verified at both desktop and iPhone viewport sizes (plus light & dark mode).

## Docs Impact

- `docs/architecture.md` — Briefly update frontend UI stack summary (`@base-ui/react`, `coss ui` patterns, `@tanstack/react-table`, Calm Native tokens).
- `README.md` — Update UI feature bullets (Focus Triage Queue, `⌘K` Command Palette, Calm Native PWA).
