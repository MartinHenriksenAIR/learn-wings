# End-to-end smoke suite with Playwright (#124)

**Date:** 2026-07-27 · **Issue:** #124 (rescoped from "FULL End to End Testing")

## Goal

A Playwright suite that drives the **deployed app in a real browser, through a real Entra login, against the real backend and database** — including write journeys — and that a human runs in one go with `npm run e2e`.

Closing #124 means: the suite exists, all journeys pass against the deployed app, and the run leaves no debris behind.

## Non-goals

Stated explicitly so a green run is not over-read:

- **Not a CI gate.** No cron, no PR trigger, no required check. Real login + real writes against the one shared database is not something to put on the merge path. Run it deliberately, before or after a deploy.
- **Not an authorization test.** See "Known gap" below — with one platform-admin account, the suite tests UI gating, not API refusal.
- **Not a replacement for the vitest suite.** The vitest suite (824 tests across 110 files as of the trunk merge) stays hermetic and fast; `npm test` is unchanged by this work. This is a separate, slower, deliberate instrument.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| What it drives | Real login, full stack, writes included | The only shape that exercises the Functions and SQL a user actually hits. Stubbed-API tests would not have caught the #306/#307/#309 invite-email defects. |
| Where writes land | A fenced test org in the prod DB | There is no staging tier — the SWA preview environments build against the *production* function app, so a preview env is just another frontend on prod data. Every org in the app is currently a test org, so the fence is about repeatable runs today and about customer safety after the #115 cutover. |
| Identity | The owner's existing platform-admin account, using the role-view switcher | No new Entra accounts to provision. Accepted cost in "Known gap". |
| Fence lifecycle | Suite creates and deletes its own org | `organization-create` and `organization-delete` are both `requirePlatformAdmin`, so the suite bootstraps its fence through the real API. No manual prod DML, no seed script. |
| Invitation email | Sent to the account owner's own address | Exercises the real Resend path end to end. Cost: one e2e invitation lands in that inbox per run — **and see the self-adoption note below, which this choice forces.** |
| Trigger | `npm run e2e`, on demand | What was asked for: a suite you run in one go. |

## Architecture

```
e2e/
  run-id.ts          # RUN_ID + e2eName(); names every artefact
  global-setup.ts    # mints E2E_RUN_ID, once per invocation
  auth.setup.ts      # the setup project: is the hand-captured session present and valid?
  README.md          # how to run it, and what a green run does and does not prove
  fixtures/
    auth.ts          # signInThroughSso, capture diagnostics, sidebar locator
    session.ts       # re-seeds viewMode + language before app boot
    fenced-org.ts    # creates/selects/asserts/tears down the e2e org
    course.ts        # course create/delete helpers + the courseCleanup fixture
  specs/
    00-harness.spec.ts             # unauthenticated: config + login page render
    01-auth.spec.ts                # saved session, deep link
    02-fence.spec.ts               # the fence fixture's own self-test
    03-role-views.spec.ts
    04-course-lifecycle.spec.ts
    05-learner-course.spec.ts
    06-org-members.spec.ts
    07-quiz-lesson.spec.ts
    08-compliance-pdf.spec.ts
playwright.config.ts # root; targets E2E_BASE_URL
.env.e2e             # gitignored: the target URL and the invite address — no credentials
```

The seven journeys of the table below are `03`–`08` plus the deep-link half of `01`. `00` and `02` are not journeys: they are self-tests that prove the harness and the write guard work before anything relies on them.

`npm run e2e` → `playwright test`. A `setup` project runs `auth.setup.ts` first; every spec project depends on it and reuses the saved state.

### Auth: what works and what silently does not

MSAL caches tokens in **`sessionStorage`** (`src/lib/msal-config.ts:13`), and Playwright's `storageState` persists **cookies and `localStorage` only**. The standard "log in once, reuse the state" recipe therefore *silently fails* on this app: the saved state looks valid and the browser is logged out.

What carries the session is the **Entra SSO cookies** captured in that same state. What they do *not* do is log the app in by themselves — that was the first draft's assumption and **it was wrong, verified empirically** (2026-07-27):

- Loading the app with only the captured state renders the **login page**. MSAL starts with an empty cache, so it has no account, and the app has no silent-SSO path: `loginRedirect` is called only from the sign-in button's `onClick` (`src/hooks/useAuth.tsx:151`), and `acquireTokenSilent` needs an account that isn't there.
- **Clicking "Sign in with Microsoft" does complete without a credential prompt.** Entra recognises the captured cookies and returns through `/common/reprocess` — no email, no password, no MFA. That is the mechanism this suite runs on.

So the flow is:

1. **A human logs in once, by hand**, via `npm run e2e:capture` — the script that sources `.env.e2e` and runs `playwright open --save-storage=e2e/.auth/platform-admin.json "$E2E_BASE_URL/login"` (the bare command does not work: nothing exports that variable to a shell). Closing the window writes the state. No password is ever stored: `.env.e2e` holds only `E2E_BASE_URL` and `E2E_INVITE_TO`, both non-secret.
2. Every spec loads that state and **clicks through SSO** — centralised in the session fixture, not repeated per spec. It costs a few seconds per spec and requires no secrets.
3. Specs assert they are authenticated before proceeding, so an expired capture fails loudly with an instruction to re-run the login command, rather than masquerading as an empty page.

The tradeoff accepted: the capture expires, so the suite is not unattended — a human re-runs the one-line login command periodically. In exchange, no credential lives on disk or in CI.

`viewMode` is **also** in `sessionStorage` (`src/hooks/useAuth.tsx:53`), so it cannot be seeded through `storageState` either. It is set two ways, deliberately:

- **`03-role-views.spec.ts` drives the real switcher UI** through the bottom-left profile menu. That is the actual mechanism a user uses and the thing that can break, so at least one spec must exercise it rather than bypass it.
- **Every other spec seeds `viewMode` via `page.addInitScript`** before app boot, for speed and to keep each spec independent of the switcher's markup.

### Inviting your own address self-adopts — the invite journey had to change shape

Discovered while building the journey, verified in source: `functions/user-context/index.ts:16-30` **auto-adopts every pending org invitation matching the caller's email, on every call** — not just at first provision (#176, so an invite created after self-signup is still honoured).

`E2E_INVITE_TO` is the signed-in account's own address, so **any navigation converts the invitation into a membership.** Observed in a trace: the fence's `pending_invite_count` went 1→0 and `member_count` 0→1 across a single navigation.

So the specced flow — invite, navigate, see it pending, revoke — is impossible with a self-addressed invite. The journey instead asserts the pending state on the writing page (still a server read: the mutation's own `invitations` refetch), and after revoking, asserts on a fresh boot that the members list is **still empty**. That second assertion is what distinguishes a genuinely revoked invitation from one that was silently adopted — without it, adoption and revocation look identical.

**A stronger option exists, and it is a config decision rather than a code one:** invite a subaddress such as `owner+e2e@…`. The adoption filter matches on `lower(trim(email))` exactly, so a subaddress does not self-adopt, the mail still arrives in the same inbox, and the full pending→revoke lifecycle becomes testable across navigations. Worth taking if the owner's mail provider supports `+` subaddressing.

### Language is pinned to English

The same `addInitScript` seeds `localStorage.preferred_language = 'en'`. This is load-bearing, not cosmetic: the app renders Danish by default, so every text-based locator would break against a Danish UI, and the accessible names the specs assert on are the English ones. Pinning it also makes the suite's own output readable to any reviewer.

It costs one thing worth naming — the authenticated specs then exercise the English surface, so a Danish-only copy regression would not be caught there. `00-harness` compensates, and it is the spec that does: it is unauthenticated, seeds the preference itself once as `en` and once as `da`, asserts the sign-in button's label in each and that `<html lang>` tracks the *rendered* language (the #311 guard). The locale-drift unit tests already cover key parity between `en` and `da`.

### Fencing: determinism now, safety at cutover

When a platform admin enters org-admin view, `OrgSelector` **auto-selects `orgs[0]`** (`src/components/OrgSelector.tsx:28,42`). A write journey that merely switches view and starts clicking mutates whichever org happens to sort first.

**Every organization currently in the app is a test org** (owner, 2026-07-27), so today that is untidy rather than dangerous. Two reasons the fence still earns its place:

1. **Determinism.** The suite must assert on artefacts it created itself. Writing into an arbitrary pre-existing org makes runs depend on data the suite does not control — the flakiness class that #305 just cost a PR to fix.
2. **Cutover.** Real customer orgs arrive with the prod domain binding (#115, open). The suite will outlive that moment, and a guard added now costs a few lines, whereas discovering its absence afterwards costs customer data.

The `fencedOrg` fixture therefore:

1. Creates an org named `e2e-<run id>-org` via the platform-admin UI at setup — the run id being an ISO timestamp with `:` and `.` replaced by `-`, minted once per invocation in `e2e/global-setup.ts` and turned into artefact names by `e2eName` (`e2e/run-id.ts`).
2. **Explicitly selects it** through `OrgSelector` — never relies on the default.
3. **Asserts the selected org is the e2e org, and fails the spec immediately if not.** This guard runs before any write, in every write-capable spec. A spec that cannot confirm its fence does not proceed.
4. Deletes the org in teardown.

Every artefact the suite creates is named `e2e-<run id>-<kind>`, and teardown is owned by a fixture rather than a `finally` block — a test timeout can outrun `finally`, which is how a stray org survived a run during #319. The delete ended up in a fixture of its own, `fenceDelete`, separate from the `fencedOrg` fixture that creates: Playwright charges one fixture's setup and teardown to the same time slot, so a single create-then-delete fixture would skip its own cleanup whenever the create spent the budget — stranding the row it had just made.

**What the fence does and does not cover.** It bounds **org-scoped** writes: anything the app derives from `currentOrg`. It does **not** bound courses — `functions/course-create` takes no organization id at all, so a course the suite creates is platform-global until deleted (verified while building the course journey). For those, the protection is create-then-delete plus the `e2e-` prefix, not confinement. Two consequences worth stating plainly rather than discovering later:

- A course the suite creates is briefly visible to every organization, so a run leaves a short-lived platform-wide artefact.
- If a course journey fails without cleaning up, the debris is platform-wide rather than tucked inside a disposable org.

## Journeys

| Spec | Covers | Key assertions |
|---|---|---|
| `01-auth` | The captured session | Replaying the hand-captured state and clicking through SSO reaches the platform-admin surface; a deep link navigated to **after** signing in is honoured. It does not test pre-login deep-link preservation, and the `<html lang>` check lives in `00-harness` (see "Language is pinned to English"). |
| `03-role-views` | The switcher and UI gating | Driving the real profile-menu switcher into org-admin and learner views changes the visible nav and the "viewing as" chip, and returning to platform view restores both. The route half is the **reverse** of what this table originally claimed: a *learner-only* route is refused in **platform** view and reached in learner view, because `learnerOnly` is the one guard `viewMode` moves. "Learner view cannot reach platform routes" is false — `requirePlatformAdmin` reads the raw flag (**#335**), so those routes still render there while the nav hides them. |
| `04-course-lifecycle` | Platform-admin CRUD (write) | Create a course, edit its title, confirm it appears in the list, delete it, confirm it is gone — a full create→delete cycle, swept by its own `courseCleanup` fixture whatever the body leaves. The journey runs fenced, but the course itself is **not** confined to the fence: `course-create` takes no organization id (see "What the fence does and does not cover"), which is exactly why the sweep is a fixture's job. |
| `05-learner-course` | Learner journey (one-time write, then persistence read) | In learner view, open a course, complete a lesson if it is still outstanding, and confirm the progress survives a full reload. The lesson-progress write runs for real only on the first run against a fresh account; later runs find the lesson already complete and re-read the persisted row (see "Learner journey prerequisite"). Also asserts which organization it is operating in — the auto-selected `orgs[0]` — so leftover `e2e-` debris fails with its real cause named. Writes only the account's own progress rows. |
| `06-org-members` | Invitation lifecycle (write, sends mail) | In org-admin view **on the fenced org**, invite the account owner's own address, assert the invitation appears as pending, then revoke it. Exercises the real Resend path — the one that shipped the "null" org-name bug. |
| `07-quiz-lesson` | The quiz surface (#299) | A quiz lesson settles into one of its two acceptable states and the spec branches on which: a **healthy quiz** renders its questions, answer options and a submit button that stays disabled until every question is answered, and gets **no** nav footer, because its submit → next-lesson flow is its own way forward; the **"not ready" card** does get a nav-only footer, with Previous enabled. A failed quiz load is the third state, and it is thrown rather than accepted. So the spec asserts a way forward exists in each state, not that Previous/Next are always present — measured, a healthy quiz has 0 of each. |
| `08-compliance-pdf` | The AI Act report (#71) | In org-admin view on the fenced org, the compliance report downloads and its **bytes** are checked: the `%PDF-` signature, a `startxref <offset> %%EOF` trailer, and an `xref` table actually at that offset. That last one is #273's defect *class* — a trailer pointing into the middle of the file. Danish characters are deliberately **not** asserted: the report is rendered in the caller's UI language, which the session fixture pins to `en`, and a raw-byte search for `æøå` would be vacuous anyway, since pdfkit Flate-compresses its content streams (those byte values were found in the English file too). |

**Learner certificates are deliberately excluded** from `08-compliance-pdf`. They require a *completed course*, not just a completed lesson, and `generate-certificate` has a known latent corruption bug tracked separately — asserting on it would make the suite red for a reason unrelated to the change under test. The compliance PDF covers the "does PDF generation work at all" question without that entanglement.

### Learner journey prerequisite — resolved

This was the one place the design could have stalled: a platform-admin account has no org memberships or enrollments, so its learner dashboard could have been empty with no course to open.

**Resolved by the owner (2026-07-27): in learner view this account can open and work through the "AI Fundamentals" course.** So `05-learner-course` drives that course, and `07-quiz-lesson` reaches its quiz by navigating into it the same way. No fenced-org course-seeding, no membership grant, and no skipped test.

Both journeys locate the course **by name, never positionally** ("the first course in the list" would pass against whatever the list happened to contain — a green that asserts nothing). If the named course is absent, the failure message says exactly that.

One consequence to accept: the lesson progress this writes belongs to the account's own enrollment in a **pre-existing** course, so it is not cleaned up by the fenced-org teardown.

Repeat runs do stay green, but not by repeating the write — the shipped spec had to be built around that (verified 2026-07-28). `/api/lesson-progress` upserts on `(org_id, user_id, lesson_id)`, so the *state* after every run is identical; the *journey* is not repeatable, because a completed lesson's footer replaces the Mark-as-complete button with a Completed badge (`CoursePlayer.tsx:809-832`) and the app offers no way to un-complete a lesson. So the first run performs the write and every later run asserts on the row that run left behind. `05-learner-course` branches on which of the two states it finds; resetting the progress to make every run write would mean deleting a real person's progress, which this suite does not do.

## Error handling and failure modes

- **Login fails** → `auth.setup.ts` fails the whole run with a clear message. No spec runs against an unauthenticated browser.
- **Fence cannot be confirmed** → the spec fails before writing. This is a hard stop, not a warning.
- **A write journey fails mid-way** → cleanup still runs, because it is owned by fixtures (`fenceDelete`, `courseCleanup`) and **not** by a `finally` in the test body. A `finally` was the first design and it was wrong: when the per-test cap trips, every await left in the body rejects at once, so a body `finally` cannot navigate or click its way through a cleanup — which is how a stray org survived a run during #319. Each cleanup fixture also declares its own `timeout`, so Playwright charges it a fresh time slot and a slow setup cannot cancel the teardown that removes what the setup created. Anything cleanup still cannot remove is prefixed with the run id, so it is identifiable by hand with a single `e2e-` search.
- **Prod data shifts** → journeys assert on artefacts they created themselves, never on pre-existing customer data, so ordinary data churn cannot make them flaky.
- **Trace on failure** → Playwright traces and screenshots retained for failed specs only.

## Prerequisites from the owner

**No credentials.** One gitignored `.env.e2e` holding two non-secret values:

```
E2E_BASE_URL=https://black-forest-0d7f96c03.7.azurestaticapps.net
E2E_INVITE_TO=<address where journey 06 mails — the owner's own>
```

Plus a **captured browser session**, refreshed by hand whenever it expires:

```bash
npm run e2e:capture
```

Sign in as normal — MFA included, since a human is doing it — then close the window, which writes the session. The file is gitignored.

No database seeding, no new Entra accounts, no Azure changes, and **no password stored anywhere**. The only requirement on the account is that it be a platform admin; MFA and conditional access are irrelevant because no automation ever touches the login form.

The accepted cost: the capture expires, so the suite is deliberately not unattended. An expired capture fails in the `setup` project with the re-capture command in the message.

## Known gap: this does not prove isolation

`effectiveIsOrgAdmin` is granted to a platform admin by `viewMode` alone — no membership row, and the underlying token keeps full platform rights (`src/hooks/useAuth.tsx:99-101`). So `03-role-views` proves the **UI** hides and redirects correctly; it does **not** prove the API refuses a genuine org admin reaching into another org, which is the actual security requirement in the project's CLAUDE.md. Within the UI it is narrower still: the nav groups and the `learnerOnly` route guard read the view-aware flags, while `requirePlatformAdmin` reads the raw one — so platform-admin routes stay reachable in learner view even though the nav hides them (**#335**), and that spec's header says so.

Specs are worded to claim only what they test. Closing the gap later means adding one real org-admin account bound to the fenced org and asserting from its token — additive, and it does not change any structure in this design.

## Verification

The suite is done when, against the deployed app:

1. `npm run e2e` exits 0 with every journey passing.
2. A deliberate re-run passes again, proving cleanup worked and the run is repeatable.
3. The fence guard is proven, not assumed — and it ended up proven by a permanent spec rather than a one-off experiment: `02-fence.spec.ts` navigates bare *on purpose*, shows the app defaulted away from the fence, and asserts that `assertFenced` fails closed on that state before `gotoFenced` restores it.
4. The org list after a run contains no `e2e-` organizations.
