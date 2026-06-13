# UI Polish Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin every screen of the learn-wings SPA to match the Claude Design prototype "AIR Academy Redesign" — new visual system (deep navy `#10298f`, light sidebar, Hanken Grotesk, white cards on soft gray canvas, sliding tabs, micro-animations, in-button success feedback) — with **zero functional changes**: every existing feature stays wired to its hooks/endpoints exactly as today.

**Architecture:** The repo's theming is shadcn CSS-variables (`src/index.css`) + Tailwind (`tailwind.config.ts`), so most of the re-skin flows from (1) a foundation task that swaps token values/fonts/keyframes, (2) a shared-primitives task (SlidingTabs, StatCard, ProgressRing, LevelBadge, SaveButton/useFlash), then (3) per-screen restyle tasks that re-shape page JSX to the prototype while leaving all data hooks, mutations, routes, and guards untouched.

**Tech Stack:** React 18 + Vite, Tailwind + shadcn/ui (Radix), TanStack Query v5, i18next (en+da), vitest + @testing-library/react, lucide-react icons, @fontsource self-hosted fonts.

---

## THE SPEC (read before any task)

The design prototype lives at:

- **`C:\Users\EmilVladinov\learn-wings-ui-polish-handoff\project\AIR Academy Redesign.dc.html`** (3,645 lines)
  - Lines 1–48: global CSS — design tokens, keyframes, hover systems (`data-reveal`, `data-lift`, `data-cert`, `data-bulb`, `data-kcard`), select chevron, button micro-interactions. **Every implementer reads this range.**
  - Lines 49–131: app shell — Login (51–63), Sidebar (68–112), Header/breadcrumbs/viewing-as (114–127), content container (129–130).
  - Per-screen template ranges (each task lists its own below).
  - Lines 1885–3645: prototype logic — `SlidingTabs` (2091–2130), `levelBars` (2132–2137), `miniBar` (2139–2143), icon set (2146–2203), nav defs + breadcrumbs (2344–2414), `flash`/`saveBtn` (2271–2291), `ring` (2307–2314), per-screen viewmodel builders (read your screen's builder for exact colors/labels/extras).
- Reference image (visual north star): `C:\Users\EmilVladinov\learn-wings-ui-polish-handoff\project\uploads\pasted-1781287212295-0.png`

The prototype is the **visual** spec. The **functional** spec is the existing app: "Do not remove or add any functionality or features" (designer's instruction, confirmed in chat transcript).

## DESIGN BRIEF (shared by all tasks)

### Tokens (hex → HSL triplet for `src/index.css` shadcn vars)

| Role | Hex | HSL triplet |
|---|---|---|
| Primary (navy) | `#10298f` | `228 80% 31%` |
| Primary hover | `#0b1f73` | `229 83% 25%` |
| Primary tint bg (`#eef1fb`) | `#eef1fb` | `226 62% 96%` |
| Primary tint border | `#d7ddf4` | `227 55% 90%` |
| Canvas / background | `#f1f2f5` | `225 17% 95%` |
| Card | `#ffffff` | `0 0% 100%` |
| Card border | `#e8e9ef` | `231 18% 92%` |
| Input border | `#e2e4ec` | `228 21% 91%` |
| Text primary | `#171a26` | `228 25% 12%` |
| Text secondary | `#686d7e` | `226 10% 45%` |
| Text muted | `#9aa0af` | `223 12% 65%` |
| Nav inactive | `#4a4f60` | `226 13% 33%` |
| Success | `#1e9e6a` (bg `#e7f6ef`) | `156 68% 37%` |
| Danger | `#d23f3f` (bg `#fdf1f1`) | `0 62% 54%` |
| Warning fg/bg | `#b07514` / `#fbf2dd` | — |
| Tab container | `#e9eaf0` | `231 19% 93%` |
| Hero gradient | `linear-gradient(120deg,#10298f 0%,#1b3cb8 70%,#2a4fd0 100%)` | — |

(Verify conversions with `node -e` if in doubt; the hex is canonical.)

### Typography
- **Hanken Grotesk** everywhere (400/500/600/700/800), self-hosted via `@fontsource/hanken-grotesk` imports in `src/index.css`. Remove the Google Fonts `@import` (Inter / Plus Jakarta Sans) and any font preconnect/link in `index.html`. No CDN fonts (repo precedent: issue #56 removed unpkg from the critical path).
- Page H1: 26px/800/-0.02em. Section H2: 17px/700. Card titles: 14.5px/700. Body: 13–14px. Eyebrows/labels: 10.5–11px/700/uppercase/0.08em.

### Shape & chrome
- Cards: white, 1px `#e8e9ef` border, **16px radius** (`rounded-2xl`), padding ~18–20px.
- Buttons: 10–12px radius, weight 700, 13–13.5px. Primary = navy bg/white; secondary = white bg + `#dcdee6` border; tint = `#eef1fb` bg + navy text.
- Inputs/selects: 11–12px radius, border `#e2e4ec`, focus = navy border + `0 0 0 3px rgba(16,41,143,0.10)` ring.
- **Pills/badges: 6–7px radius (squarer, NOT fully rounded)** — 11px/700, padding 4–5px 10–11px.
- Selects: custom inset chevron (10×6 SVG data-URI, `right 14px center`, padding-right 38px) — applied globally.
- Content column: `max-width:1140px`, padding `30px 32px 56px`, centered.
- Empty states: dashed `#d6d8e0` border card, centered, 48px padding.

### Micro-interactions (global CSS in foundation task)
- All buttons: `transition: filter .15s, transform .15s` — hover `brightness(.95)`, active `scale(.965)`.
- Keyframes: `fadeUp`, `fadeIn`, `popIn` (0%→.3, 60%→1.18, 100%→1), `heartPop` (40%→1.4), `bulbWiggle`.
- Hover-lift cards (`.hover-lift` utility): `translateY(-3px)` + `0 12px 30px rgba(20,24,46,0.10)` shadow.
- Hover-reveal stat cards: hidden panel expands (`max-height` 0→84px + opacity) with one extra info line; whole card clickable → navigates.
- Respect `prefers-reduced-motion: reduce` (disable transforms/animations).

### Shared primitives (built in Task 2, used everywhere after)
- `src/components/ui/sliding-tabs.tsx` — `<SlidingTabs tabs={[{key,label,icon?,disabled?}]} active onChange>`: container `#e9eaf0` r12 p4, white sliding indicator r8 + shadow, `.28s cubic-bezier(.4,0,.2,1)`, active text navy / inactive `#686d7e`. Measured via refs + ResizeObserver.
- `src/components/ui/stat-card.tsx` — icon chip (42px, r12, tint bg) + value (22px/800) + label + hover-reveal `extra` line; `onClick` navigates.
- `src/components/ui/progress-ring.tsx` — SVG ring, rotate −90°, round linecap, centered % label (port of prototype `ring()`, lines 2307–2314).
- `src/components/ui/level-badge.tsx` — squarer pill + 3 signal bars (3px wide; heights 5/8/11; filled 1/2/3 for basic/intermediate/advanced; unfilled opacity .28). Colors from prototype `lvlStyles` (read its definition in the script).
- `src/hooks/useFlash.ts` + `src/components/ui/save-button.tsx` — in-button success morph: green `#1e9e6a` + check + done-label for 1.6s, then revert (port of `flash`/`saveBtn`, lines 2271–2291).

### Toast policy (Task 13 enforces app-wide)
Routine confirmations (saves, enroll, copy, kanban move, hide/lock, revoke invite, publish toggle, module/lesson edits, lesson complete) → **in-button morph / inline UI feedback, no toast**. Toasts remain for: destructive confirmations, submissions (post/report/idea/invitation), quiz failure, moderation decisions, **all errors** (errors always keep toasts).

### Hard constraints (every task)
1. **Zero functional change.** Same hooks, same queries/mutations, same routes, same guards, same i18n mechanism, same a11y roles/labels (DialogTitle/Description stay — issue #32). If the prototype contradicts the app's behavior, the app's behavior wins.
2. **Auth-bootstrap invariants** (`src/main.tsx`, `useAuth`, `ProtectedRoute`, `Login` logic) are load-bearing (issue #16, thrice-regressed): restyle Login's JSX only; do not touch logic or the other three files.
3. **i18n:** all user-visible strings via i18next; any new string gets keys in BOTH `en.json` and `da.json` (sensible Danish). Don't hardcode prototype copy.
4. **Ownership:** `profile?.id`, never `user?.id` (don't touch such code anyway).
5. **Tests must not be deleted/skipped/weakened.** If a test asserts UI text/structure you legitimately changed, update the assertion to pin the NEW behavior at equal-or-better strength (e.g., the #20 profile-save success-toast test becomes a save-button-morph test). Test counts may not decrease.
6. **Read before you write:** `.claude/rules/frontend.md` (hard-won conventions) and your screen's prototype line ranges (including its viewmodel builder in the script).
7. Conventional commit, ≤72-char subject, body explains the visual mapping. Use multiple `-m` flags (PowerShell mangles here-strings).

### Verification gates (every task, from repo root)
```
npm run lint          # 0 errors
npx tsc --noEmit -p tsconfig.app.json
npm test              # all pass, count never lower than before your task
npm run build
```

---

## Tasks

### Task 1: Foundation — tokens, fonts, global styles
**Files:** Modify `src/index.css`, `tailwind.config.ts`, `index.html`, `package.json` (add `@fontsource/hanken-grotesk`). Test: existing suite stays green.
- [ ] Install `@fontsource/hanken-grotesk`; import weights 400/500/600/700/800 at top of `src/index.css`; delete the Google Fonts `@import`; remove font `<link>`/preconnects from `index.html` if present.
- [ ] Replace `:root` token values with the Design Brief table (keep the existing variable NAMES so all shadcn components keep working; update `--sidebar-*` to the LIGHT sidebar: white bg, navy primary, `#4a4f60` fg). Update `--gradient-*` to the navy hero gradient. Set `--radius: 0.75rem`. Update the `.dark` block minimally so it stays coherent (navy-tinted darks) — the app ships light-only; don't invest beyond coherence.
- [ ] `tailwind.config.ts`: `fontFamily.sans` and `.display` → `'Hanken Grotesk'`. Add keyframes/animations `fade-up`, `pop-in`, `heart-pop`, `bulb-wiggle` per brief.
- [ ] Global CSS (in `@layer base`/`components`): button hover/active micro-interaction; global select chevron rule (the exact `data:image/svg+xml` from prototype line 32); `.hover-lift` utility; scrollbar styling (prototype lines 21–23); `@media (prefers-reduced-motion: reduce)` kill-switch.
- [ ] Gates green; commit `feat(ui): navy design tokens, Hanken Grotesk, global micro-interactions`.

### Task 2: Shared primitives
**Files:** Create the five primitives listed in the brief (+ colocated `.test.tsx` for SlidingTabs, LevelBadge, SaveButton at minimum). Modify `src/components/ui/{button,badge,card,input,dialog}.tsx` ONLY where base radii/focus need to match the brief.
- [ ] Port prototype `SlidingTabs` (lines 2091–2130) to a controlled React component (refs + ResizeObserver; no rAF watchdog — that was a capture-iframe workaround, skip it). Tests: renders tabs, indicator follows active, disabled tab unclickable.
- [ ] Build `StatCard`, `ProgressRing` (port lines 2307–2314), `LevelBadge` (+bars, lines 2132–2137 + `lvlStyles` from the script), `SaveButton`+`useFlash` (lines 2271–2291; timer cleanup on unmount). Tests: LevelBadge bars per level; SaveButton morphs then reverts (fake timers).
- [ ] Gates green; commit `feat(ui): shared primitives - sliding tabs, stat card, ring, level badge, save button`.

### Task 3: App shell — sidebar, header, Login
**Files:** Modify `src/components/layout/AppLayout.tsx`, `src/components/layout/AppSidebar.tsx`, `src/pages/Login.tsx` (JSX only). Prototype: lines 49–131 + nav builder 2344–2414.
- [ ] Sidebar → light: 252px white, logo top, org selector (when shown today), grouped nav with uppercase group labels, **pill active item** (navy bg, white text, r11), footer user card with popover menu (Switch view radios when platform admin + Settings + Sign out) exactly as the app has today, restyled.
- [ ] Header: 58px white bar, breadcrumbs (13px, hover navy), right-aligned "Viewing as …" chip (`#eef1fb`/navy, r7) when view-mode ≠ real role. Content wrapper: `max-width:1140px` centered, padding 30px 32px 56px, canvas `#f1f2f5`.
- [ ] Login: centered 380px white card (r20, navy-tinted shadow), logo, one-line blurb, navy "Sign in with Microsoft" button with the 4-square mark, footnote. Logic untouched.
- [ ] Keep every nav item/route/role rule EXACTLY as currently defined (compare against current AppSidebar; the prototype's nav set must match — if it differs, the app wins).
- [ ] Gates green (update layout-related test assertions if any pin old classes); commit `feat(ui): light shell - pill-nav sidebar, breadcrumb header, login card`.

### Task 4: Learner Dashboard
**Files:** `src/pages/learner/Dashboard.tsx` (+ its components under `src/components/learner/`), `Dashboard.test.tsx` assertions if needed. Prototype: lines 132–235; viewmodel ~2415–2510 (dashStats extras, hero variants incl. "All caught up" + first-time variants, ring).
- [ ] 4 StatCards with hover-reveal extras (use data already available client-side; derive "next lesson"/"latest completion" from existing query results — no new endpoints).
- [ ] Navy hero card: gradient, decorative circles, badge eyebrow, title, blurb, white CTA + progress label, 120px ProgressRing. Three variants: in-progress course / all-caught-up (100% ring + "Start a new course" CTA suggesting an unenrolled course) / first-time user.
- [ ] "In progress" grid (thumb area, LevelBadge, progress bar + label, tint Continue button), "Completed" cards, "Certificates" cards with **hover preview popover** of the certificate (prototype 213–223) and download button (existing handler; morph to "Saved ✓" via SaveButton pattern).
- [ ] Gates green; commit `feat(ui): dashboard - stat cards, hero with ring, certificate previews`.

### Task 5: Courses + Course Player
**Files:** `src/pages/learner/Courses.tsx`, `src/pages/learner/CoursePlayer.tsx` (+ `src/components/course/*`, `src/components/learner/*` they use), test files as needed. Prototype: Courses 237–296, Player 298–394; viewmodels ~2511–2600 and the player builder; `completeLesson` ux 2316–2327.
- [ ] Courses: search input w/ icon, level+status selects, Clear link, empty state, card grid (thumb w/ status badge, LevelBadge, 2-line clamp description, enroll/continue button + unenroll icon button). Enroll success = in-button morph ("Enrolled ✓" → Continue), no toast.
- [ ] Player: 320px sidebar card (course title, Progress label + **n/m · pct%**, bar), module groups (gray uppercase headers), lesson rows (status dot with popIn when completed, left edge marker for active, duration), content card (type chip + title, video/document/quiz bodies restyled), footer Previous / "Mark as complete" navy / popIn "Completed" badge / Next.
- [ ] Keep ALL existing player logic (completion awaits server — issue #18; quiz flow; PDF.js worker setup — issue #56). Quiz options as radio-row buttons; result panel green/red w/ retry.
- [ ] Gates green; commit `feat(ui): courses catalog and player restyle`.

### Task 6: Community feed + Post detail/edit
**Files:** `src/pages/community/CommunityFeed.tsx`, `PostDetail.tsx`, `PostEdit.tsx` + `src/components/community/*` used by them; tests as needed. Prototype: Feed 396–523, Post detail 524–578 (+ viewmodels).
- [ ] Feed: header w/ Submit Idea (bulb wiggle on hover) + New Post buttons; **SlidingTabs** for org/global scope (keep exact existing scope/feature logic); search+category chip card (squarer chips, lock icon where the app shows it); post cards (avatar, category pill, Hidden/Locked badges, like w/ **heartPop**, comment count, event date/time/place chips when post is an event); right column: events widget (with date/time/place) + AI Champions card — exactly the widgets the app has today.
- [ ] Post detail: post card + comments thread (avatars, like hearts, report links, admin hide/lock controls as today), comment composer. Post edit: form restyle only.
- [ ] Gates green; commit `feat(ui): community feed and post detail restyle`.

### Task 7: Idea library / submit / detail + Resource library
**Files:** `src/pages/community/IdeaLibrary.tsx`, `IdeaSubmit.tsx`, `IdeaDetail.tsx`, `ResourceLibrary.tsx` + their components; tests as needed. Prototype: 579–631, 632–664, 665–705, 706–756.
- [ ] Idea library: SlidingTabs for its tabs (incl. My drafts as today), idea cards w/ status pills (squarer), empty states.
- [ ] Submit: form card restyle (labels, inputs, focus rings), submit stays a toast-worthy action.
- [ ] Detail: idea card, status timeline/labels, comments as today; org-admin status save uses SaveButton morph.
- [ ] Resources: search (existing debounce — issue #41), pin/unpin, add/delete dialogs restyled; resource cards w/ type icons.
- [ ] Gates green; commit `feat(ui): ideas and resources restyle`.

### Task 8: Org/Global Analytics
**Files:** `src/pages/org-admin/OrgAnalytics.tsx` (+ shared analytics components; the same screen serves Global Analytics for platform admin if the app shares it — match existing structure), tests as needed. Prototype: 757–942 + its (large) viewmodel.
- [ ] SlidingTabs for Overview / Members / Course Progress / Team Performance (keep URL-synced tab state exactly as today).
- [ ] Overview: **visual-first** — ProgressRings for completion/quiz score, miniBars under engagement metrics, StatCards w/ hover extras.
- [ ] Members: table restyle (avatars w/ initials, role selects w/ inset chevron, in-flight guards stay — issue #74), invite + bulk-invite + enroll-member dialogs restyled; **Copy invite link → green "Copied!" pop morph** (no toast); revoke = inline feedback.
- [ ] Course progress & team performance tabs: bars/tables per prototype.
- [ ] Gates green; commit `feat(ui): analytics - visual-first overview, restyled member management`.

### Task 9: Org Ideas kanban + Org moderation + Org settings
**Files:** `src/pages/org-admin/OrgIdeasManagement.tsx`, `OrgCommunityModeration.tsx`, `OrgSettings.tsx` (+ components), tests as needed. Prototype: 943–987, 988–1036, 1037–1061.
- [ ] Kanban: column tint highlight on drag-over, card lift/tilt while dragging, **"Open →" hover hint** (click vs drag affordance). Drops change status as today; **do NOT add within-column reorder** (needs backend ordering — functionality addition; deliberately out of scope, noted in PR).
- [ ] Moderation: queue cards (reporter/reason/status pills squarer), resolve/dismiss/hide/lock controls as today (decisions keep toasts).
- [ ] Org settings: feature-override switches card, SaveButton morph on save.
- [ ] Gates green; commit `feat(ui): kanban affordances, moderation queue, org settings restyle`.

### Task 10: Organizations manager + Organization detail
**Files:** `src/pages/platform-admin/OrganizationsManager.tsx`, `OrganizationDetail.tsx` (+ components/dialogs), tests as needed. Prototype: 1062–1096, 1097–1155.
- [ ] Orgs list: cards/table w/ seat usage miniBars, create-org dialog restyle (DUPLICATE_SLUG error display stays — ADR-0013).
- [ ] Org detail: header card, seat limit editor (SEAT_LIMIT_REACHED display stays), course-access list w/ thumb chips, members section as today; "Try again" error state stays (issue #53).
- [ ] Gates green; commit `feat(ui): organizations manager and detail restyle`.

### Task 11: Course manager + Course editor
**Files:** `src/pages/platform-admin/CoursesManager.tsx`, `CourseEditor.tsx` (+ dialogs: module/lesson/quiz editor), tests as needed. Prototype: 1156–1234, 1235–1310.
- [ ] Manager: course rows w/ thumb chips, level badges, status pills, org-access counts; create-course dialog restyle.
- [ ] Editor: **publish toggle** (switch, not button) wired to the existing publish mutation; module/lesson list w/ grip handles + ordering as today (server-owned sort_order — issue #46); lesson dialogs (video/document/quiz) and quiz editor restyled; Save changes uses SaveButton morph.
- [ ] Gates green; commit `feat(ui): course manager and editor restyle, publish toggle`.

### Task 12: Platform settings + Platform moderation + Account settings
**Files:** `src/pages/platform-admin/PlatformSettings.tsx`, `PlatformCommunityModeration.tsx`, `src/pages/Settings.tsx`, tests as needed. Prototype: 1311–1426, Moderation 988–1036 (shared), Account 1427–~1500.
- [ ] Platform settings: SlidingTabs Branding / User Access / Email / Features; each panel a card; SaveButton morph per panel (per-field validation + merge semantics stay — issue #90).
- [ ] Platform moderation: same restyle as org moderation w/ org column.
- [ ] Account settings: profile card (avatar initials via `getInitials`), language picker stays functional (en/da — the app's i18n is real even though the prototype is EN-only), profile save = SaveButton morph (**update the #20 toast test to pin the morph at equal strength**).
- [ ] Gates green; commit `feat(ui): platform settings, moderation, account settings restyle`.

### Task 13: Toast audit + dialogs/empty-state sweep
**Files:** app-wide `src/` sweep (grep `toast(`), all `AlertDialog`/`Dialog` usages, `NotFound.tsx`, `ForgotPassword.tsx`, `ResetPassword.tsx`, `Signup.tsx`, `Index.tsx` if rendered. Tests as needed.
- [ ] Apply the Toast policy table (brief) to every `toast(` call site not already handled in Tasks 4–12; errors ALWAYS keep toasts; keep sonner config (5s/8s, dismissible — issue #24).
- [ ] Restyle remaining dialogs/alerts (r16 cards, navy primaries, squarer pills) and the misc auth/NotFound pages (light-touch; logic untouched).
- [ ] Verify a11y: every Dialog keeps Title/Description (issue #32 sweep must not regress).
- [ ] Gates green; commit `feat(ui): toast audit - in-button feedback for routine actions`.

### Task 14: Final sweep — i18n parity, dead styles, full gates
**Files:** repo-wide check; `src/i18n/locales/en.json` + `da.json`.
- [ ] en/da key parity check (script or test); no hardcoded English added by Tasks 1–13 (grep new JSX for string literals).
- [ ] Remove now-dead CSS/utilities/components orphaned by the restyle (verify with grep before deleting).
- [ ] Full gates at root AND `functions/` (`npm run build`, `npm test` — backend untouched but prove it).
- [ ] Commit `chore(ui): i18n parity and dead-style cleanup`.

### Controller-only (not subagent tasks)
- [x] Branch `ui-polish` off `mvp` (done).
- [ ] Final whole-branch code review (skill: final reviewer dispatch).
- [ ] Push, open PR → base `main` (note: stacked on #99; diff slims when #99 merges). CI green (`gh pr checks`).
- [ ] SWA preview verification: HTTP 200 + login renders. Playwright MCP local run for interactive verification.
- [ ] PR description: design provenance (Claude Design handoff), deliberate deviations (kanban reorder deferred — backend ordering needed; prototype EN-only vs app i18n kept), preview-origin manual step note (same three places as #99).
