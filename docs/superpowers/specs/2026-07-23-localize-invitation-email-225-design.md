# Localize the invitation email to the recipient's language — design (#225)

- **Issue:** #225 — Localize invitation email to the recipient's language (ADR-0016)
- **Date:** 2026-07-23
- **Status:** approved — ready for implementation plan
- **ADR:** ADR-0016 (content localization strategy), category 3 — system-generated documents

## Problem

`functions/send-invitation-email/index.ts` hardcodes `<html lang="da">`, a Danish subject, a Danish `roleLabel`, and Danish body boilerplate, so every invitee receives Danish regardless of who they are. ADR-0016 classifies transactional emails as **category 3** — one localized template whose fixed strings render in the reader's language via the same i18n mechanism as the UI, with language-neutral variable data. The invitation email does not follow this yet.

## Resolved decisions

ADR-0016 delegated one open sub-decision to #225: which language to use for an invitee who has no `profiles` row yet. Decisions taken while picking this up:

1. **Language source = the inviter picks in the dialog**, with **an existing user's own `preferred_language` taking precedence** when the invited email already has a profile. (ADR-0016 listed "use the inviter's language" as an acceptable option for the no-profile case; this resolves it without contradicting the ADR, so no ADR edit is required — the resolution is recorded here and in the PR.)
2. **Bulk invite uses one batch-level language selector** applied to all rows (not a per-row CSV column).
3. **Selector default = the inviting admin's current UI language** (`i18n.resolvedLanguage`, mapped to `da`/`en`, fallback `da`).
4. **No persistence of the chosen language.** The email is sent once, immediately after invitation creation, from the frontend; there is no "resend invitation" feature. So the language does not need to be stored on the `invitations` table → **no DB migration and no prod-migration ritual.** #225 is a pure code change.

## Approach

**Server-side resolution + a local string map.** The frontend passes the inviter's picked language as a hint; the endpoint owns the final language resolution and all rendered strings.

Rationale: only the server can look up the invitee's stored `preferred_language`, so "existing user's language wins" is only expressible server-side; email copy stays out of the client; and this matches ADR-0016 ("server-generated documents render in the reader's language, resolved server-side") and the merged category-3 precedent in `functions/shared/seat-request-notify.ts` (#193).

Rejected alternatives:
- **Frontend passes fully-localized strings** — the client can't see the invitee's `preferred_language`, and it scatters email copy into React.
- **A shared `functions/shared/email-i18n.ts` for all category-3 surfaces** — deferred as YAGNI. The #71 AI Act PDF (category 3) renders via pdfkit, is in flight (PR #230), and shares no code path with an HTML email. Extract a shared helper only if a second email surface actually needs it.

## Language resolution (in `send-invitation-email`)

Produce `lang: 'da' | 'en'` by precedence:

1. **Invitee's stored preference** — `SELECT preferred_language FROM profiles WHERE lower(email) = lower($1) AND preferred_language IS NOT NULL ORDER BY created_at LIMIT 1`. `profiles.email` is nullable and not uniquely indexed, so `LIMIT 1` with a deterministic order. If a row is found → use its value.
2. Else **inviter's dialog pick** — `inviterLanguage` from the request body, validated to `'da' | 'en'`.
3. Else **platform default `'da'`** — defensive; the selector always sends a value, so this is only reached by a malformed/legacy request.

Resolution is best-effort: if the profile lookup throws, fall through to the inviter's pick rather than failing the send (preserves today's fire-and-forget semantics). The response never reveals whether the email matched a profile, so there is no account-enumeration signal to the caller.

## Localized template

Introduce `functions/send-invitation-email/strings.ts` exporting a keyed map:

```
EMAIL_STRINGS: Record<'da' | 'en', {
  subjectOrg,            // "Du er blevet inviteret til {org} …" / "You have been invited to {org} …"
  subjectPlatformAdmin,
  roleLabels: { learner, org_admin, platform_admin },
  welcomeOrg,            // uses org + roleLabel
  welcomePlatformAdmin,
  ctaButton,
  expiryNote,
  footer,
  // …any remaining boilerplate lines in the current template
}>
```

`generateEmailHtml`, the subject, and `roleLabel` all read from `EMAIL_STRINGS[lang]`; the template renders `<html lang="${lang}">`. Variable data (org name, inviter, invite link, logo URL) stays language-neutral. A keyed map is used rather than #193's inline `isEnglish()` ternaries because this template carries more boilerplate; the Danish strings are the current wording verbatim, with English added.

## Request contract (backward-compatible)

- Endpoint `InvitationEmailRequest`: add optional `inviterLanguage?: 'da' | 'en'`.
- Client `SendInvitationEmailParams` (`src/lib/sendInvitationEmail.ts`): add `inviterLanguage?: 'da' | 'en'`, forwarded in the POST body.

Optional field ⇒ existing callers and tests keep compiling and passing. Invalid/absent values are ignored (fall through to resolution step 2/3), not rejected with 400.

## Frontend selectors (4 surfaces)

A `da`/`en` language `Select`, defaulting to `i18n.resolvedLanguage` (mapped to `'da'|'en'`, fallback `'da'`), added to each invite entry point, each threading `inviterLanguage` into `sendInvitationEmail(...)`:

1. `src/components/platform-admin/org-detail/InviteUserDialog.tsx` — add `language` to `InvitePayload` + a selector; consumed by `src/pages/platform-admin/OrganizationDetail.tsx`.
2. `src/pages/platform-admin/OrganizationsManager.tsx` — inline invite dialog (platform admin).
3. `src/components/org-admin/OrgMembersTab.tsx` — inline invite form (org admin); new `inviteLanguage` state.
4. `src/components/org-admin/BulkInviteDialog.tsx` — one batch-level selector applied to every row.

New i18n keys (selector label + `Dansk`/`English` option labels) in `src/i18n/locales/en.json` and `src/i18n/locales/da.json`.

## Error handling / invariants (unchanged)

`allowedLinkDomains()` / `ALLOWED_LINK_DOMAINS`, the Resend send, and the platform-admin-OR-org-admin authorization are unchanged. The only behavioral change is the language of the rendered strings and `<html lang>`.

## Testing

- **Endpoint unit tests** (mock `pg` per `.claude/rules/functions.md`):
  - Resolution precedence: existing-user `da` and `en` each override the inviter's pick; no-profile uses the pick; a profile with `NULL` preference uses the pick; missing/invalid `inviterLanguage` → default `da`.
  - Rendered output: subject, `<html lang>`, and body boilerplate match the resolved language for both `da` and `en`, for org and platform-admin invites.
  - `ALLOWED_LINK_DOMAINS` validation and authz behavior unchanged (existing tests stay green).
- **Frontend tests:** each selector renders, defaults to the current UI language, and threads `inviterLanguage` through to `sendInvitationEmail`; update the existing `InviteUserDialog` / `OrganizationDetail` tests for the new payload field.

## Out of scope / non-goals

- Persisting invitation language on the `invitations` table; any "resend invitation" flow (none exists).
- A shared functions-side i18n module across category-3 surfaces (#71 PDF stays independent).
- Any change to `invitation-create` / `invitation-bulk-create` / `invitation-accept` beyond passing the language hint from the frontend to `send-invitation-email`.
- Languages beyond `da`/`en` (the only supported locales).

## Acceptance criteria (from #225) → coverage

- Invitation email renders in the resolved language (subject + body), not always Danish → language resolution + `EMAIL_STRINGS`.
- `<html lang="...">` reflects the resolved language → template uses `${lang}`.
- Unknown-recipient fallback implemented and documented → resolution step 2 (inviter's pick) then step 3 (default `da`); documented here and in the PR.
- Existing `ALLOWED_LINK_DOMAINS` / Resend behavior unchanged → explicitly untouched; covered by retained tests.

## Files touched

- `functions/send-invitation-email/index.ts` — resolution + read from string map + `<html lang>`.
- `functions/send-invitation-email/strings.ts` — new keyed `da`/`en` string map.
- `functions/send-invitation-email/index.test.ts` — resolution + render tests.
- `src/lib/sendInvitationEmail.ts` — `inviterLanguage` param, forwarded in body.
- `src/components/platform-admin/org-detail/InviteUserDialog.tsx` (+ `OrganizationDetail.tsx`) — selector + payload field.
- `src/pages/platform-admin/OrganizationsManager.tsx` — selector.
- `src/components/org-admin/OrgMembersTab.tsx` — selector + state.
- `src/components/org-admin/BulkInviteDialog.tsx` — batch-level selector.
- `src/i18n/locales/en.json` + `src/i18n/locales/da.json` — selector label + option labels.
- Frontend tests as above.

## No interference with in-flight work

Verified disjoint from the two open draft PRs: #228/#227 (exercises — `functions/exercises/*`, exercise UI) and #230/#71 (AI Act PDF — `functions/generate-compliance-report/*` + one line in `OrgAnalytics.tsx`). #225 touches `functions/send-invitation-email/*`, the invite surfaces, and locale JSON — no shared files, no shared-contract change.
