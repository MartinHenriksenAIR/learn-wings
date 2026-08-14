# End-to-end suite (Playwright)

Drives the **deployed** app in a real Chromium, signed in as a real Entra account, writing
to the real database. Not a unit-test tree — everything here talks to the app over the
network, and one journey sends a real email.

```bash
npm run e2e          # the whole suite
npm run e2e:ui       # Playwright's UI mode
npx playwright test e2e/specs/03-role-views.spec.ts   # one file
```

Runs serially (`workers: 1`) for data safety, not throughput: every fenced test derives its
organization from the same per-run id, so a second worker's teardown would delete an
organization another test is still writing into. Reports land in `playwright-report/` and
`test-results/`, both gitignored.

## Deliberately not a CI gate

`npm run e2e` is on demand only. It is not in `npm test`, not in `.github/workflows/ci.yml`,
and **it must not be added to either**. It needs a session a human captured by hand, which no
CI runner has and which cannot be automated without storing a password; and it performs real
writes against the one shared database the deployed app uses. Neither belongs on the merge path.

CI does type-check this tree via `tsconfig.node.json` — a pure type-check, no browser, no
network, no session. That gate is not redundant: Playwright's runner transpiles without
checking types, and `tsconfig.app.json` includes only `src`.

## The captured session

There is no password in this repo or in the environment. Authenticated specs replay Entra
cookies a human captured once:

```bash
npm run e2e:capture
```

Sign in by hand in the window that opens, then close it. `e2e/.auth/platform-admin.json` is
gitignored — **never commit it**. The script exists because it sources `.env.e2e` first
(`set -a`, so it wants a POSIX shell); `E2E_BASE_URL` lives only in that file and nothing
exports it to a shell, so the same `playwright open` typed by hand opens nothing.

Captures expire. The `setup` project fails first and fast when one has, and prints the
command above. If a run tells you Microsoft asked for credentials, re-capture — do not work
around it. Note that `storageState` carries cookies and localStorage but **not**
sessionStorage, where MSAL keeps its token cache, so the app still boots signed-out and
`signInThroughSso` clicks through Entra (silently, with the cookies present). `viewMode` and
language live in web storage too, so the session fixture re-seeds them with `addInitScript` —
every authenticated spec runs in `en`, which is why the helpers use English accessible names.

## Configuration

`.env.e2e` (gitignored; copy `.env.e2e.example`) holds two variables and no credentials:
`E2E_BASE_URL`, the deployed app to drive, and `E2E_INVITE_TO`, the address journey 06 mails.
`E2E_RUN_ID` is not yours to set — `global-setup.ts` mints one per invocation and names every
artefact `e2e-<run id>-<kind>`, so anything a failed teardown strands is findable with one
`e2e-` search.

## Journey 06 sends one real email per run

`06-org-members.spec.ts` invites a member for real through a live Resend call, so one full
run puts one real message in `E2E_INVITE_TO`'s inbox and nothing can take it back. That is
why the journey overrides `retries` to `0` — a retry would start from a fresh fence and send
a *second* irreversible email — and why the write is guarded by an assertion that the address
is not already listed. It is the suite's only mail path.

## The fence

Org-scoped writes happen inside an organization the suite creates for the run and deletes
afterwards. `fencedOrg` creates it; a **separate** `fenceDelete` fixture removes it, because
Playwright charges one fixture's setup and teardown to the same slot and a slow create would
otherwise cancel its own cleanup.

**Inside a fenced spec, navigate with `gotoFenced`, never bare `page.goto`.** This is the
single most important rule in the tree, and it is kept by hand — nothing enforces it.
`currentOrg` is component state nothing persists, so every navigation boots with nothing
selected and `OrgSelector` auto-selects `orgs[0]` — whichever organization was created most
recently. A journey that arrives with `page.goto` and then writes, writes wherever that
default landed. Once real customer organizations exist, that is a write into one of them.
`gotoFenced` re-selects and re-asserts the fence, so a navigation that cannot restore it
stops the journey instead of continuing unfenced.

`02-fence.spec.ts` navigates bare on purpose, to prove the fence really is lost and that
`assertFenced` fails closed. `05-learner-course` is unfenced by design: its one write is a
`lesson_progress` upsert for the signed-in account itself, not an org-scoped object a run
can own and drop. Fenced specs must pick a non-platform view (`test.use({ viewMode: 'org_admin' })`);
`OrgSelector` renders nothing in platform view, so the fixture refuses that view outright.

## What a green run proves — and what it does not

**It proves UI gating, not API refusal.** The account is a platform admin and `viewMode` is a
client-side value; switching it changes what the app renders and nothing else — the bearer
token is identical either way. The backend always reads the raw flag (`requireOrgAdmin`
returns early on `profile.is_platform_admin`), so a seeded view cannot reduce what the API
accepts. No spec here demonstrates that the backend refuses a request, and none can while
this is the account it signs in as. In particular, **the suite says nothing about
organization-admin isolation** — the platform's critical security requirement. That needs a
genuinely org-scoped account, or tests written against the API rather than the UI.

## Layout

```
e2e/
  auth.setup.ts        the setup project: is the capture present and still valid?
  global-setup.ts      mints E2E_RUN_ID, once per invocation
  run-id.ts            RUN_ID + e2eName() — how artefacts get their e2e- prefix
  fixtures/            auth · session · fenced-org · course
  specs/               the journeys
  .auth/               the captured session — gitignored, never commit
```

Specs import `test` and `expect` from the fixture module they need, each of which re-exports
the `test` it extends. Importing from `@playwright/test` instead silently drops the session
seeding — `00-harness.spec.ts` is the one correct exception, being unauthenticated and
seeding its own language.
