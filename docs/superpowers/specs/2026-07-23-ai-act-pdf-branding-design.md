# AI Act Compliance PDF — Rebrand + Content Redesign (#71)

**Date:** 2026-07-23
**Issue:** #71 (AI Act Compliance PDF: update branding / layout / styling)
**Status:** design LOCKED (2026-07-23) — one open implementation decision noted in §Data
**Preview (locked look + content):** `scratchpad/pdf-mockup/report-formal.html`

## Problem

The org-admin "Download Report" button (`OrgAnalytics.tsx` → `/api/generate-compliance-report`) produces a working but weak PDF. Two problems, addressed together:

1. **Presentation** — `functions/generate-compliance-report/index.ts` hand-writes raw PDF-1.4 byte syntax: off-brand header colour, no logo, fragile hardcoded xref offsets, fixed coordinates that overflow past ~5 rows, English-only.
2. **Content** — it's a formatted dump of training stats you can't *conclude* from. It should be evidence for **AI Act Article 4 (AI literacy), Regulation (EU) 2024/1689**: does the org ensure a sufficient level of staff AI literacy, to what degree, and where are the gaps.

## Decisions (brainstorming + review, 2026-07-23)

1. **Brand source → Platform (AI Uddannelse).** Navy `#10298f` + in-app logo (`src/assets/logo-light.png`).
2. **Technology → `pdfkit`.** Pure-JS (serverless-safe on Azure Functions), real flow layout + pagination, embeds the logo and covers `æøå` via built-in fonts. Replaces the raw-PDF byte code entirely.
3. **Localization → ADR-0016 category-3.** One localized template; fixed strings in the reader's language, variable data language-neutral. The PDF follows **the requesting user's UI language at request time** (`i18n.resolvedLanguage`, sent by the client), not the stored `preferred_language`. `da` / `en`; server validates, falls back to `en`.
4. **Visual register → formal / authoritative** (not a product dashboard). **Serif throughout** (built-in **Times** in pdfkit; Georgia in the HTML preview). **Near-monochrome**: ink + navy only, with a restrained **oxblood `#8a2a2a`** used *solely* to mark a deficiency. **Ruled**, not carded — hairline-ruled tables, no zebra fills, no rounded pills/cards, sharp corners, small-caps serif labels. A letterhead double-rule, a centred title block, numbered clauses, a declaration and a signature block.
5. **Content → concise, conclusion-first, Article-4 framing.** Ruthlessly lean — the verdict is legible in the first third of one page; no vanity metrics. Scoped honestly as *training* evidence, **not** a full AI-Act conformity assessment.
6. **Page size → A4** (Danish/EU orgs; current code uses US Letter).

## Report structure (locked)

Single formal document, paginated. In order:

1. **Letterhead** — logo (left) + right block: "Compliance Report" · reference no. · "Confidential"; double navy rule.
2. **Title block** (centred) — "AI Literacy & Training Report" + regulation citation subtitle.
3. **Metadata row** (ruled) — Organisation · Reporting period · Prepared by (name + role) · Date of issue.
4. **Declaration** — one justified paragraph stating what the report documents and the Article-4 frame.
5. **§1 Summary** — key-figures strip (Staff in scope · Baseline-trained · **Coverage %** · Outstanding · Refresher due) + a one-line status sentence with the status word (e.g. "Action required") in oxblood small-caps.
6. **§2 Coverage by department** — ruled table: Department · Staff · Trained · Coverage · Assessed level · Status (On track / Below target / Priority; deficiencies in oxblood). Stated ≥80% target note.
7. **§3 Required curriculum** — compact ruled table: each required course · completion %.
8. **§4 Assessed literacy** — compact ruled table: level (Advanced / Intermediate / Basic / Not assessed) · staff · share. Source: onboarding assessment (#117).
9. **Certification + signature block** — certification sentence + Prepared-by / Reviewed-by / Date signature lines.
10. **Footer** (ruled) — Confidential · reference · page X of Y.

**Removed by owner decision (2026-07-23):** the "Recommended actions & basis of preparation" section. The report states findings and evidence; it does not prescribe actions. (Consequence: the scope/basis disclaimer that lived there is gone — if a scope caveat is later wanted, add a one-line footer, not a section.)

## Architecture

Endpoint rewrite + one client line. No new shared contract.

### Backend — `functions/generate-compliance-report/index.ts`
- Read `language` from the POST body alongside `orgId`; validate `∈ {'da','en'}`, default `'en'`.
- Keep the existing auth + access-check (platform admin OR active org_admin via `entra_oid`); additionally resolve the **caller's name + role** for the "Prepared by" line.
- Replace `generatePDF()` with a pdfkit implementation rendering the structure above.
- **Strings local** to the endpoint (`strings.ts`, `{da,en}`) — not a shared contract; #225 later extracts the reusable server-doc i18n helper and this adopts it.
- **Logo** embedded as a base64 constant (`logo.ts`) — no runtime file read, mount-safe.
- **Fonts:** pdfkit built-in Times-Roman / Times-Bold / Times-Italic (WinAnsi covers `æøå`; verified in the prototype). No TTF bundled.
- **Dates** localized (`da-DK` / `en-US`).
- Binary `application/pdf` response unchanged.

### Frontend — `src/pages/org-admin/OrgAnalytics.tsx` (~line 155)
- Add `language: i18n.resolvedLanguage` to the existing `callApiRaw('/api/generate-compliance-report', { orgId })` body. `useTranslation` already imported.

## Data

The richer content needs more than today's dept/course aggregation. All of the following exist in the DB and are additive queries:
- **Coverage / trained / outstanding** — `enrollments.status = 'completed'` per user against the baseline curriculum; joined to `profiles.department` for the per-dept table.
- **Assessed literacy** — `profiles.assessment_level` + `assessment_skipped_at` (#117): counts per level incl. "Not assessed".
- **Refresher due** — completion timestamps on `enrollments` older than 12 months.
- **Prepared by** — the requesting user's `profiles.full_name` + org role.

**⚠ One open implementation decision — the "baseline curriculum" (required courses) source.** There is no "required course" concept today. Options:
- **(a) Proxy = all org-enabled courses** (`org_course_access.access='enabled'`). No schema change, but "baseline-trained = completed *every* enabled course" is a stringent/odd bar.
- **(b) Add a lightweight `is_baseline`/`required` flag** on `org_course_access` (org admin marks which enabled courses count toward baseline literacy) + a small toggle in the org course-access UI; fall back to (a) when none flagged. **Recommended** — makes the headline metric meaningful. This expands #71's footprint to a schema migration + a small admin-UI toggle.

Resolve in the implementation plan. If (b), announce the shared-schema touch per the collaboration model.

## Testing

Mock-contract test (`functions/generate-compliance-report/index.test.ts`; mock `shared/auth`, `shared/db` — never a real DB):
- 200 + `application/pdf` + body begins `%PDF`, non-trivial length.
- 401 unauthenticated; 403 authenticated non-admin.
- Localization: `da` vs `en` produce different bytes; unsupported/absent language → `en`.
- Manual: generate real PDFs (both languages, incl. a long department list to prove pagination) and eyeball before undrafting.

## Verification gates

`functions/`: `npm run build`, `npm test`. Root gates (`lint`, `tsc`, `test`, `build`) for the one-line `OrgAnalytics.tsx` change. (New worktree needs BOTH root + `functions/` `npm install` before gates run.)

## Interference / coordination

- **Files touched:** `functions/generate-compliance-report/*` (+ `strings.ts`, `logo.ts`, test) and one line in `src/pages/org-admin/OrgAnalytics.tsx` — **plus**, if Data option (b) is chosen, `migration/azure/01-schema.sql` + the org course-access admin UI. None overlap #226 (`i18n/index.ts`, `user-context`, `useAuth`, `Signup`, `Settings`) or #227 (`CourseEditor`, `CoursePlayer`, `types.ts`, locale JSON, schema `lesson_type`, `validate.ts`, lesson endpoints). A schema touch under (b) would be a new (non-conflicting) migration file — coordinate the shared-schema heads-up.
- **Independent of #226:** keys off the live `resolvedLanguage`, correct today; #226 only changes what non-da/en browsers resolve to. No ordering requirement.
- **Independent of #225:** both category-3, but strings stay local; #225 owns the shared helper.

## Out of scope / future

- Recommended-actions / basis-of-preparation section (removed by decision).
- Brand TTF typography (built-in Times suffices for `æøå`).
- Extracting local strings into a `functions/shared/*` server-doc i18n helper (→ #225).
- Charts/graphics, per-org white-label logo.
