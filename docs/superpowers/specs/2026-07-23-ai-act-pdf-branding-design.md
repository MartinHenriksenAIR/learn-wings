# AI Act Compliance PDF — Branding + Localization (#71)

**Date:** 2026-07-23
**Issue:** #71 (AI Act Compliance PDF: update branding / layout / styling)
**Status:** design approved, pending spec review

## Problem

The org-admin "Download Report" button (`OrgAnalytics.tsx` → `/api/generate-compliance-report`) produces a working but unbranded PDF. The current generator (`functions/generate-compliance-report/index.ts`) hand-writes raw PDF-1.4 byte syntax as a template string:

- Off-brand header colour (`0.1 0.3 0.5` ≈ a muted teal, not the brand navy).
- No logo, Helvetica only.
- **Fragile:** hardcoded `/Length` and xref byte offsets that already drift from the real content; fixed absolute coordinates that overflow/overlap past ~5 departments (courses are hard-capped at 5).
- All fixed strings are English (`en-US`), regardless of the reader.

## Decisions (from brainstorming, 2026-07-23)

1. **Brand source → Platform (AI Uddannelse).** Navy `#10298f` (the `--primary` token) + the in-app logo (`src/assets/logo-light.png`). One consistent look for every org. (Not the org's own logo, not the AI Rådgivning consultancy brand.)
2. **Technology → `pdfkit`.** Pure-JS (no native binaries → clean Azure Functions zipdeploy, survives runtime bumps), real flow layout + pagination, embeds a PNG logo and fonts. Chosen over HTML→PDF/Puppeteer (Chromium is an operational trap in a serverless Function) and `@react-pdf/renderer` (drags React into an otherwise React-free `functions/` tree). Replaces the fragile hand-rolled byte code entirely.
3. **Localization → category-3 per ADR-0016.** The PDF is a *system-generated document*: one localized template whose fixed strings render in the reader's language, variable data (org, names, numbers, dates) language-neutral. Per ADR-0016, the compliance PDF specifically follows **the requesting user's UI language at request time** (`i18n.resolvedLanguage`, sent by the client) — **not** the stored `preferred_language` (that rule is for server-sent emails where no user is present). Supported languages `da` / `en`; server validates and falls back to `en`.

## Architecture

Single endpoint rewrite plus one client line. No new shared contract, no schema change.

### Backend — `functions/generate-compliance-report/index.ts`
- Read `language` from the POST body alongside `orgId`; validate `∈ {'da','en'}`, default `'en'`.
- Keep the existing auth + access-check (platform admin OR active org_admin via `entra_oid`) and the department/course aggregation SQL **unchanged**.
- Replace `generatePDF()` with a pdfkit implementation.
- **Strings stay local** to the endpoint: a small `const LABELS = { da: {...}, en: {...} }` module in the function folder (`strings.ts`). This is deliberately *not* a `functions/shared/*` i18n contract — #71 is the first category-3 document; when #225 (invitation email) builds the reusable server-doc i18n mechanism, that helper is extracted and #71 adopts it. Avoids premature abstraction and avoids editing shared files in flight.
- **Logo** embedded as a base64 constant (`logo.ts`, ~5KB) rather than a runtime file read — no path resolution, no `WEBSITE_RUN_FROM_PACKAGE` read-only-mount concern, guaranteed to ship in the bundle. `doc.image(Buffer.from(base64,'base64'), …)`.
- **Fonts:** pdfkit's built-in Helvetica / Helvetica-Bold, which render `æøå` via WinAnsi encoding (verified during build). A brand TTF is a possible later polish, out of scope here.
- **Dates** localized with `toLocaleDateString(language === 'da' ? 'da-DK' : 'en-US', …)`.
- Response stays a binary `application/pdf` attachment (same `Content-Disposition` pattern), body from the pdfkit Buffer.

### Frontend — `src/pages/org-admin/OrgAnalytics.tsx` (line ~155)
- One-line change: add `language: i18n.resolvedLanguage` to the existing `callApiRaw('/api/generate-compliance-report', { orgId })` body. `useTranslation` is already imported in this component.

## Layout (branded)

- **Header band:** navy `#10298f` full-width bar; logo (left) + report title (white) — title localized.
- **Meta block:** organization name, generated date (localized), total staff.
- **Overall compliance card:** light-navy `#eef1fb` background, navy heading, the org-wide compliance rate.
- **Department table:** real header row + column layout (Department · Staff · Courses completed · Compliance rate), row dividers, and **pagination** via pdfkit flow / `addPage()` so any number of departments renders without overlap.
- **Course completion table:** header row (Course · Completion), no longer hard-capped at 5.
- **Footer:** page number ("Page X of Y" / "Side X af Y") + a branding line and generated timestamp.
- Compliance rates may use success-green `#1e9e6a` as a tasteful accent. Palette sourced from `src/index.css` tokens.

## Data flow

`OrgAnalytics` POST `{ orgId, language }` → authenticate → access-check → aggregate departments/courses (unchanged SQL) → build `ReportData` → `generatePDF(data, language)` → Buffer → 200 `application/pdf`. Auth failures 401 (`AuthError`), non-admin 403, unexpected 500 via `internalError` (generic body, ADR-0014) — all unchanged.

## Testing

Mock-contract test (`functions/generate-compliance-report/index.test.ts`), per functions convention (mock `shared/auth`, `shared/db`; never a real DB):
- Happy path → 200, `Content-Type: application/pdf`, body begins `%PDF`, non-trivial length.
- 401 unauthenticated; 403 authenticated non-admin.
- Localization: `language: 'da'` vs `'en'` produce different bytes (labels differ); an unsupported/absent language falls back to `en`.
- Manual: generate a real PDF locally for both languages and eyeball branding/layout before undrafting.

## Verification gates

- `functions/`: `npm run build`, `npm test`.
- Root gates (`lint`, `tsc`, `test`, `build`) — the frontend change is one line in `OrgAnalytics.tsx`; run the root gates to keep them green.

## Interference / coordination (checked against in-flight work)

- **Files touched:** `functions/generate-compliance-report/*` (+ new `strings.ts`, `logo.ts`, test) and **one line** in `src/pages/org-admin/OrgAnalytics.tsx`. Neither is in #226's file set (`src/i18n/index.ts`, `functions/user-context`, `useAuth`, `Signup`, `Settings`) nor #227's (`CourseEditor`, `CoursePlayer`, `types.ts`, locale JSON, schema, `validate.ts`, lesson endpoints). No merge conflict, no shared-contract edit.
- **Independent of #226:** #71 keys off the live `i18n.resolvedLanguage`, which is already correct today; it does not read the `preferred_language` #226 initializes. #226 only changes what `resolvedLanguage` resolves to for a non-da/en browser (`da` → `en`), which #71 simply honors. No ordering requirement.
- **Independent of #225:** both are category-3 documents, but #71 keeps its strings local; the shared server-doc i18n helper is #225's to build and #71 will adopt it later. #71 is a concrete first example to generalize from.
- **`OrgAnalytics.tsx`** is on #121's future radar (analytics/org-overview split), but #121 is blocked on RBAC #122 and not in flight — no current conflict.

## Out of scope / future

- Brand TTF typography (built-in Helvetica is sufficient for `æøå`).
- Extracting the local strings into a `functions/shared/*` server-doc i18n helper (deferred to #225 / ADR-0016 follow-up).
- Charts/graphs in the report.
- Per-org white-label logo.
