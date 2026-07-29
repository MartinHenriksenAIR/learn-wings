# End-to-end suite (Playwright)

Nine spec files that drive the **deployed** app in a real Chromium, signed in as a real
Entra account, writing to the real database. Sixteen tests: fifteen across the specs plus
the `setup` project's single precondition check.

This is not a unit-test tree. Everything here talks to the app over the network, so the
suite is slower, needs a human-captured session, and — for one journey — sends a real
email. Read the rest of this file before running it.

## Running it

```bash
npm run e2e          # the whole suite
npm run e2e:ui       # Playwright's UI mode
npx playwright test e2e/specs/03-role-views.spec.ts   # one file
```

Reports land in `playwright-report/` and `test-results/`, both gitignored. Traces and
screenshots are kept only for failures (`trace: 'retain-on-failure'`).

The suite runs **serially** — `workers: 1`, `fullyParallel: false`. That is a data-safety
setting, not a throughput one: every fenced test derives its organization from the same
per-run id, so a second worker's teardown would delete the organization another test is
still writing into.

## Deliberately not a CI gate

`npm run e2e` is on demand only. It is not in `npm test`, not in
`.github/workflows/ci.yml`, and it must not be added to either.

Two reasons, both structural. It needs a session a human captured by hand, which no CI
runner has and which cannot be automated without storing a password. And it performs real
writes against the one shared database the deployed app uses — the specs' own comments call
a stranded fence "a live row in the production database". Neither belongs on the merge path,
where every PR would run it.

`vitest` cannot pick these files up even by accident: `vitest.config.ts` includes only
`src/**/*.{test,spec}.{ts,tsx}`.

CI does *type-check* this tree — see "Type-checking" below — which is a different thing from
running it: no browser, no session, no writes.

## The captured session

There is **no password anywhere in this repo**, and none in the environment. Authenticated
specs replay Entra cookies that a human captured once:

```bash
npm run e2e:capture
```

Sign in by hand in the window that opens, then close it. `e2e/.auth/platform-admin.json` is
gitignored — **never commit it**.

That script is `playwright open --save-storage=… "$E2E_BASE_URL/login"` with `.env.e2e`
sourced first, and the sourcing is the whole reason it is a script. `E2E_BASE_URL` lives in
that file, which only `playwright.config.ts` reads — through dotenv, inside the config — and
nothing exports it to a shell, so the same command typed by hand opens `/login` on nothing.
The script echoes the URL it resolved before the browser starts, and a missing `.env.e2e`
fails the sourcing so nothing opens at all. It sources with `set -a`, so it wants a POSIX
shell (bash or zsh).

Captures expire. When one has, the `setup` project fails first and fast, before any spec
runs, and prints the command above in its message. The two halves of that check are
separate on purpose:

- `describeCapturedSessionProblem` establishes that the file is readable, parses as JSON and
  holds at least one cookie. `playwright.config.ts` runs the same check to decide whether to
  hand the file to `storageState`, so Playwright's own ENOENT or JSON error cannot land first
  and bury the instruction.
- Expiry itself only shows up on a real sign-in, so `signInThroughSso` watches for
  Microsoft's own credential fields alongside the app's sidebar. If the credential fields win
  the race it says the capture is dead. Those fields are **only ever located, never
  filled** — the suite has nothing to fill them with.

If a run tells you Microsoft asked for credentials, re-capture. Do not work around it.

Two details about what a capture can and cannot carry. `storageState` holds cookies and
localStorage, but MSAL keeps its token cache in **sessionStorage**, which it does not — so
the app boots with no account and `signInThroughSso` still has to click "Sign in with
Microsoft". With the SSO cookies present that click round-trips through Entra with no
prompt. And because `viewMode` and the language preference also live in web storage that is
read once at boot, the session fixture re-seeds them with `addInitScript`: every
authenticated spec runs with `preferred_language=en`, which is why every locator in the
authenticated helpers is an English accessible name.

## Configuration

`.env.e2e` (gitignored; copy `.env.e2e.example`) holds exactly two variables and no
credentials:

| Variable | What it is |
| --- | --- |
| `E2E_BASE_URL` | The deployed app to drive. `playwright.config.ts` throws without it. |
| `E2E_INVITE_TO` | The address journey 06 mails. See below. |

`E2E_RUN_ID` is not yours to set — `e2e/global-setup.ts` mints one per invocation and every
artefact is named `e2e-<run id>-<kind>`, so anything a failed teardown strands is traceable
to the run that made it and findable with a single `e2e-` search.

## Journey 06 sends one real email per run

`06-org-members.spec.ts` invites a member for real. The mutation awaits
`/api/send-invitation-email`, which is a live Resend call, so **one full run puts one real
message in `E2E_INVITE_TO`'s inbox**. Nothing in the suite can take that back.

That shapes the journey. It overrides the config's `retries: 1` to `retries: 0`, because a
retry would start from a fresh fence, take the invite branch again and send a *second*
irreversible email. And the write is guarded by an assertion that the address is not already
listed, so the run refuses to invite twice. `E2E_INVITE_TO` is the account owner's own
address, by their decision.

Only this file reads `E2E_INVITE_TO`, and it is the suite's only mail path — running any
other spec, or the suite minus this file, sends nothing.

## The fence: how write journeys stay contained

Org-scoped writes happen inside an organization the suite creates for the run and deletes
afterwards. The `fencedOrg` fixture creates it; a **separate** `fenceDelete` fixture removes
it in teardown, because Playwright charges one fixture's setup and teardown to the same time
slot and a slow create would otherwise cancel its own cleanup, stranding the row.

Inside a fenced spec, **navigate with `gotoFenced`, never with bare `page.goto`.** This is
the single most important rule in the tree. `currentOrg` is plain component state that
nothing persists, so every navigation boots the app with nothing selected and `OrgSelector`
auto-selects `orgs[0]` — and `/api/organizations` orders by `created_at DESC`, so that is
whichever organization was created most recently, never one that asked to be chosen. A
journey that arrives with `page.goto` and then writes, writes wherever that default landed.
Once real customer organizations exist, that is a write into one of them. `gotoFenced`
navigates, re-selects the fence and re-asserts it, so a navigation that cannot restore the
fence stops the journey instead of continuing unfenced.

The one deliberate exception is `02-fence.spec.ts`, which navigates bare *on purpose* to
prove the fence really is lost and that `assertFenced` fails closed on it.

Fenced specs must pick a non-platform view (`test.use({ viewMode: 'org_admin' })`);
`OrgSelector` renders nothing in platform view, so the fence could not be selected there,
and the fixture refuses that view outright rather than creating an organization it cannot
fence. Platform-admin pages still render in org-admin view, which is what lets one view both
create the fence and write inside it.

Not every spec is fenced, and the split is intentional:

| Spec | Fenced | What it does |
| --- | --- | --- |
| `00-harness` | — | Unauthenticated. Login page renders in `en` and `da` per the seeded preference. |
| `01-auth` | — | Read-only. The capture reaches the platform-admin surface; a deep link survives sign-in. |
| `02-fence` | yes | Proves the fence machinery itself — including that a bare navigation loses it. |
| `03-role-views` | — | Read-only. The view switcher swaps navs; a learner route is refused in platform view. |
| `04-course-lifecycle` | yes | Creates, edits, finds and deletes a course; its own `courseCleanup` fixture sweeps it. |
| `05-learner-course` | **no** | Writes. Completes a lesson and proves it survives a reload. |
| `06-org-members` | yes | Invites, sees pending, revokes. **Sends the email.** |
| `07-quiz-lesson` | — | Read-only. A quiz lesson is never a dead end. |
| `08-compliance-pdf` | yes | Downloads the AI Act compliance report and checks the bytes are a real PDF. |

`05-learner-course` is the documented exception: its one write is `/api/lesson-progress`,
which upserts a row keyed `(org_id, user_id, lesson_id)` for the signed-in account with the
user id taken from the token. The artefact is that account's own progress — not an
organization-scoped object a run can own and drop — so there is nothing to fence and nothing
to tear down, and `page.goto` is correct there. Courses get their own cleanup fixture rather
than relying on the fence, because no organization contains a course; invitations and
memberships need none, since both cascade on the organization's delete.

## What a green run proves — and what it does not

**It proves UI gating, not API refusal.** The account is a platform admin, and `viewMode` is
a client-side value in sessionStorage. Switching the view changes what the app renders and
nothing else — the bearer token is the same one either way.

Which flag gets read does not split cleanly by layer, and the asymmetry is worth stating
exactly. The **backend** always reads the *raw* one: `requireOrgAdmin` returns early on
`profile.is_platform_admin` before it ever probes for a membership row
(`functions/shared/endpoint.ts:91-95`), so the view a spec seeds cannot reduce what the API
will accept. The **frontend reads both**. `AppSidebar` builds its nav groups from the
*effective*, view-aware flags (`AppSidebar.tsx:193-203`), and `ProtectedRoute`'s `learnerOnly`
guard reads `effectiveIsPlatformAdmin` (`ProtectedRoute.tsx:76`) — which is why platform view
really does bounce a learner route, and it is the one guard `viewMode` moves. But the guard
next to it, `requirePlatformAdmin`, reads the raw `isPlatformAdmin`
(`ProtectedRoute.tsx:80`), so in learner or org-admin view the nav hides the platform links
while the routes behind them still render. That is **#335** — found by this work, verified
live against the deployed app, and documented in `03-role-views.spec.ts`'s header so no
reader takes this suite as covering it.

Concretely: when `03-role-views` shows a learner-only route refused in platform view, that is
the router declining to render, not the API declining to answer. No spec here demonstrates
that the backend refuses a request, and none can while this is the account it signs in as.
In particular, **the suite says nothing about organization-admin isolation** — the platform's
critical security requirement. That needs a genuinely org-scoped account, or tests written
against the API rather than the UI.

## Type-checking

The specs are checked by `tsconfig.node.json`:

```bash
npx tsc --noEmit -p tsconfig.node.json
```

It is a verification gate of its own: `AGENTS.md` lists it and CI runs it on every PR
(`.github/workflows/ci.yml`). Safe there, unlike the suite itself, because it is a pure
type-check — no browser, no network, no database and no captured session.

It is also not redundant with the other gates. Playwright's runner
transpiles without checking types, and `tsconfig.app.json` includes only `src` — so before
`e2e` and `playwright.config.ts` were added to this config's `include`, nothing type-checked
this tree at all. Its `lib` is Node-only (no DOM), which is deliberate: most of what lives
here is Node-side code. Browser-side DOM access belongs in a locator rather than a
`page.evaluate` callback (see the note in `00-harness.spec.ts`).

## Known gaps

Open issues against this suite. They are real; do not assume they are handled:

- **#318** — `fixtures/auth.ts:10-12` and `fixtures/session.ts:4-5` justify where `ViewMode`
  lives by a runtime import cycle that does not exist (`session.ts` takes it as an
  `import type`, which is erased). The arrangement is right; the stated reason is not.
- **#321** — nothing structurally prevents a spec from bypassing the fence with `page.goto`.
  The rule above is kept by hand, not enforced.
- **#329** — `05-learner-course`'s write only happens on the run that finds the lesson
  outstanding (the app offers no way to un-complete a lesson), and it never asserts which
  organization the progress row landed in.
- **#332** — `06-org-members`'s post-revoke assertions are satisfied by an empty list, so
  they would also pass if the underlying queries failed.
- **#334** — one `waitForResponse` inherits a short timeout rather than a budget sized for
  the read it waits on.

## Layout

```
e2e/
  auth.setup.ts        the setup project: is the capture present and still valid?
  global-setup.ts      mints E2E_RUN_ID, once per invocation
  run-id.ts            RUN_ID + e2eName() — how artefacts get their e2e- prefix
  fixtures/
    auth.ts            signInThroughSso, capture diagnostics, sidebar locator
    session.ts         seeds viewMode + language before boot; the `viewMode` option
    fenced-org.ts      fencedOrg / fenceDelete fixtures, gotoFenced, assertFenced
    course.ts          extends fenced-org with course helpers + courseCleanup
  specs/               the nine journeys
  .auth/               the captured session — gitignored, never commit
```

Specs import `test` and `expect` from the fixture module they need — `./fixtures/session`,
`./fixtures/fenced-org`, or `./fixtures/course`, each of which re-exports the `test` it
extends. Importing them from `@playwright/test` instead silently drops the session seeding.

`00-harness.spec.ts` is the one spec that imports both from `@playwright/test`, and that is
correct rather than an oversight: it is unauthenticated, it never signs in, and it seeds
`preferred_language` itself — once as `en` and once as `da`, which is the thing it tests. So
there is no session to re-seed and no view to choose, and taking the fixture's `test` would
only add a second `en` seed of that same key underneath its own. The rule above is about the
authenticated specs, which is all of the others.
