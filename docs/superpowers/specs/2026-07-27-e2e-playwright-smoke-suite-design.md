# End-to-end smoke suite with Playwright (#124)

**Date:** 2026-07-27 · **Issue:** #124 (rescoped from "FULL End to End Testing")

## Goal

A Playwright suite that drives the **deployed app in a real browser, through a real Entra login, against the real backend and database** — including write journeys — and that a human runs in one go with `npm run e2e`.

Closing #124 means: the suite exists, all journeys pass against the deployed app, and the run leaves no debris behind.

## Non-goals

Stated explicitly so a green run is not over-read:

- **Not a CI gate.** No cron, no PR trigger, no required check. Real login + real writes against the one shared database is not something to put on the merge path. Run it deliberately, before or after a deploy.
- **Not an authorization test.** See "Known gap" below — with one platform-admin account, the suite tests UI gating, not API refusal.
- **Not a replacement for the vitest suite.** The 811 unit tests stay hermetic and fast; `npm test` is unchanged. This is a separate, slower, deliberate instrument.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| What it drives | Real login, full stack, writes included | The only shape that exercises the Functions and SQL a user actually hits. Stubbed-API tests would not have caught the #306/#307/#309 invite-email defects. |
| Where writes land | A fenced test org in the prod DB | There is no staging tier — the SWA preview environments build against the *production* function app, so a preview env is just another frontend on prod data. Every org in the app is currently a test org, so the fence is about repeatable runs today and about customer safety after the #115 cutover. |
| Identity | The owner's existing platform-admin account, using the role-view switcher | No new Entra accounts to provision. Accepted cost in "Known gap". |
| Fence lifecycle | Suite creates and deletes its own org | `organization-create` and `organization-delete` are both `requirePlatformAdmin`, so the suite bootstraps its fence through the real API. No manual prod DML, no seed script. |
| Invitation email | Sent to the account owner's own address | Exercises the real Resend path end to end. Cost: one e2e invitation lands in that inbox per run. |
| Trigger | `npm run e2e`, on demand | What was asked for: a suite you run in one go. |

## Architecture

```
e2e/
  run-id.ts          # one id per run; names every artefact
  auth.setup.ts      # one real Entra login per run, saves storageState
  fixtures/
    session.ts       # re-seeds viewMode + language before app boot
    fenced-org.ts    # creates/selects/asserts/tears down the e2e org
    course.ts        # course create/delete helpers
  specs/
    00-harness.spec.ts             # unauthenticated: config + login page render
    01-auth.spec.ts                # saved session, deep link
    02-fence.spec.ts               # the fence fixture's own self-test
    03-role-views.spec.ts
    04-course-lifecycle.spec.ts
    05-learner-course.spec.ts
    06-org-members.spec.ts
    07-quiz-compliance-pdf.spec.ts
playwright.config.ts # root; targets E2E_BASE_URL
.env.e2e             # gitignored: credentials + target
```

The six journeys of the table below are `03`–`07` plus the deep-link half of `01`. `00` and `02` are not journeys: they are self-tests that prove the harness and the write guard work before anything relies on them.

`npm run e2e` → `playwright test`. A `setup` project runs `auth.setup.ts` first; every spec project depends on it and reuses the saved state.

### Auth: what works and what silently does not

MSAL caches tokens in **`sessionStorage`** (`src/lib/msal-config.ts:13`), and Playwright's `storageState` persists **cookies and `localStorage` only**. The standard "log in once, reuse the state" recipe therefore *silently fails* on this app: the saved state looks valid and the browser is logged out.

What carries the session is the **Entra SSO cookies** captured in that same state. What they do *not* do is log the app in by themselves — that was the first draft's assumption and **it was wrong, verified empirically** (2026-07-27):

- Loading the app with only the captured state renders the **login page**. MSAL starts with an empty cache, so it has no account, and the app has no silent-SSO path: `loginRedirect` is called only from the sign-in button's `onClick` (`src/hooks/useAuth.tsx:151`), and `acquireTokenSilent` needs an account that isn't there.
- **Clicking "Sign in with Microsoft" does complete without a credential prompt.** Entra recognises the captured cookies and returns through `/common/reprocess` — no email, no password, no MFA. That is the mechanism this suite runs on.

So the flow is:

1. **A human logs in once, by hand**, via `npx playwright open --save-storage=e2e/.auth/platform-admin.json <baseURL>/login`. Closing the window writes the state. No password is ever stored: `.env.e2e` holds only `E2E_BASE_URL` and `E2E_INVITE_TO`, both non-secret.
2. Every spec loads that state and **clicks through SSO** — centralised in the session fixture, not repeated per spec. It costs a few seconds per spec and requires no secrets.
3. Specs assert they are authenticated before proceeding, so an expired capture fails loudly with an instruction to re-run the login command, rather than masquerading as an empty page.

The tradeoff accepted: the capture expires, so the suite is not unattended — a human re-runs the one-line login command periodically. In exchange, no credential lives on disk or in CI.

`viewMode` is **also** in `sessionStorage` (`src/hooks/useAuth.tsx:53`), so it cannot be seeded through `storageState` either. It is set two ways, deliberately:

- **`03-role-views.spec.ts` drives the real switcher UI** through the bottom-left profile menu. That is the actual mechanism a user uses and the thing that can break, so at least one spec must exercise it rather than bypass it.
- **Every other spec seeds `viewMode` via `page.addInitScript`** before app boot, for speed and to keep each spec independent of the switcher's markup.

### Language is pinned to English

The same `addInitScript` seeds `localStorage.preferred_language = 'en'`. This is load-bearing, not cosmetic: the app renders Danish by default, so every text-based locator would break against a Danish UI, and the accessible names the specs assert on are the English ones. Pinning it also makes the suite's own output readable to any reviewer.

It costs one thing worth naming — the specs then exercise the English surface, so a Danish-only copy regression would not be caught here. `01-auth` compensates by asserting `<html lang>` tracks the *rendered* language (the #311 guard), and the locale-drift unit tests already cover key parity between `en` and `da`.

### Fencing: determinism now, safety at cutover

When a platform admin enters org-admin view, `OrgSelector` **auto-selects `orgs[0]`** (`src/components/OrgSelector.tsx:28,42`). A write journey that merely switches view and starts clicking mutates whichever org happens to sort first.

**Every organization currently in the app is a test org** (owner, 2026-07-27), so today that is untidy rather than dangerous. Two reasons the fence still earns its place:

1. **Determinism.** The suite must assert on artefacts it created itself. Writing into an arbitrary pre-existing org makes runs depend on data the suite does not control — the flakiness class that #305 just cost a PR to fix.
2. **Cutover.** Real customer orgs arrive with the prod domain binding (#115, open). The suite will outlive that moment, and a guard added now costs a few lines, whereas discovering its absence afterwards costs customer data.

The `fencedOrg` fixture therefore:

1. Creates an org named `e2e-<ISO timestamp>` via the platform-admin UI at setup.
2. **Explicitly selects it** through `OrgSelector` — never relies on the default.
3. **Asserts the selected org is the e2e org, and fails the spec immediately if not.** This guard runs before any write, in every write-capable spec. A spec that cannot confirm its fence does not proceed.
4. Deletes the org in teardown.

Every artefact the suite creates is named with an `e2e-<timestamp>-` prefix, and cleanup runs in a `finally` so a mid-run failure leaves *identifiable* debris rather than anonymous debris.

## Journeys

| Spec | Covers | Key assertions |
|---|---|---|
| `01-auth` | Login and language | Real Entra login lands on the platform-admin home; `<html lang>` matches the rendered language on first load (guards #311 in a real browser, which unit tests cannot); a deep link before login is preserved and returned to afterwards. |
| `02-role-views` | The switcher and UI gating | Driving the real profile-menu switcher into org-admin and learner views changes the visible nav and the "viewing as" chip; learner view cannot reach platform routes; returning to platform view restores full nav. |
| `03-learner-course` | Learner journey (write) | In learner view, open a course, complete a lesson, and confirm progress survives a full reload. Writes only the account's own progress rows. |
| `04-course-lifecycle` | Platform-admin CRUD (write) | Create a course in the fenced org, edit its title, confirm it appears in the list, delete it, confirm it is gone. Full create→delete cycle, self-cleaning. |
| `05-org-members` | Invitation lifecycle (write, sends mail) | In org-admin view **on the fenced org**, invite the account owner's own address, assert the invitation appears as pending, then revoke it. Exercises the real Resend path — the one that shipped the "null" org-name bug. |
| `06-quiz-compliance-pdf` | Recently-broken surfaces | A quiz lesson renders either a working quiz or the "not ready" empty state, and **always** offers Previous/Next (the durable #299 fix); the AI Act compliance PDF downloads and is a structurally valid PDF with correct Danish characters (#71, #273). |

**Learner certificates are deliberately excluded** from `06`. They require a *completed course*, not just a completed lesson, and `generate-certificate` has a known latent corruption bug tracked separately — asserting on it would make the suite red for a reason unrelated to the change under test. The compliance PDF covers the "does PDF generation work at all" question without that entanglement.

### Learner journey prerequisite — resolved

This was the one place the design could have stalled: a platform-admin account has no org memberships or enrollments, so its learner dashboard could have been empty with no course to open.

**Resolved by the owner (2026-07-27): in learner view this account can open and work through the "AI Fundamentals" course.** So `05-learner-course` drives that course, and `07-quiz-compliance-pdf` reaches its quiz by navigating into it the same way. No fenced-org course-seeding, no membership grant, and no skipped test.

Both journeys locate the course **by name, never positionally** ("the first course in the list" would pass against whatever the list happened to contain — a green that asserts nothing). If the named course is absent, the failure message says exactly that.

One consequence to accept: the lesson progress this writes belongs to the account's own enrollment in a **pre-existing** course, so it is not cleaned up by the fenced-org teardown. Re-completing an already-complete lesson is idempotent, so repeat runs stay green.

## Error handling and failure modes

- **Login fails** → `auth.setup.ts` fails the whole run with a clear message. No spec runs against an unauthenticated browser.
- **Fence cannot be confirmed** → the spec fails before writing. This is a hard stop, not a warning.
- **A write journey fails mid-way** → `finally` cleanup still runs; anything it cannot remove is prefixed and timestamped, so it is identifiable by hand.
- **Prod data shifts** → journeys assert on artefacts they created themselves, never on pre-existing customer data, so ordinary data churn cannot make them flaky.
- **Trace on failure** → Playwright traces and screenshots retained for failed specs only.

## Prerequisites from the owner

One gitignored `.env.e2e` at the repo root:

```
E2E_BASE_URL=https://black-forest-0d7f96c03.7.azurestaticapps.net
E2E_USER=<platform-admin email>
E2E_PASSWORD=<password>
E2E_INVITE_TO=<same address; where journey 05 mails>
```

Nothing else. No database seeding, no new Entra accounts, no Azure changes.

Two constraints on that account: it must authenticate with a **password** the browser can type (no MFA prompt, no conditional-access gate on this login), and it must be a **platform admin**. If MFA cannot be waived, the fallback is a once-per-session manual login whose `storageState` is reused until it expires — noted here so the constraint is not discovered mid-implementation.

## Known gap: this does not prove isolation

`effectiveIsOrgAdmin` is granted to a platform admin by `viewMode` alone — no membership row, and the underlying token keeps full platform rights (`src/hooks/useAuth.tsx:99-101`). So `02-role-views` proves the **UI** hides and redirects correctly; it does **not** prove the API refuses a genuine org admin reaching into another org, which is the actual security requirement in the project's CLAUDE.md.

Specs are worded to claim only what they test. Closing the gap later means adding one real org-admin account bound to the fenced org and asserting from its token — additive, and it does not change any structure in this design.

## Verification

The suite is done when, against the deployed app:

1. `npm run e2e` exits 0 with every journey passing.
2. A deliberate re-run passes again, proving cleanup worked and the run is repeatable.
3. The fence guard is proven, not assumed: temporarily point it at a non-e2e org and confirm the write specs refuse to run.
4. The org list after a run contains no `e2e-` organizations.
