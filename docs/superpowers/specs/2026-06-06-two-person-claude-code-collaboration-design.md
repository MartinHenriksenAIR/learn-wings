# Two-Person Claude Code Collaboration System — Design

**Date:** 2026-06-06
**Status:** Approved (pending final spec review)
**Authors:** emil + Claude (brainstorming session "cowork brainstorm")
**Applies to:** learn-wings, mid-migration (Lovable/Supabase → Azure), two developers (Windows + macOS), both daily Claude Code users with full repo/GitHub/Azure access.

## 1. Goal & context

Two developers, each driving Claude Code sessions from their own machine, need to move the migration forward **in parallel, ad-hoc** (any combination of slices, bugs, hardening work) without overwriting each other's work. Session memory does not transfer between machines, so **all coordination state must live in git or GitHub** and merge cleanly.

Research basis (2026-06): Anthropic best-practices docs, worktree/agent-teams docs, and practitioner accounts converge on: file-exclusive task partitioning, branch-per-task as the claim, fresh-context cross-review, committed `.claude/` config as the team-sync mechanism, and deterministic hooks over prose rules. This design applies those patterns to this repo's existing slice/ledger/ADR system.

## 2. Locked decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Work split | Ad-hoc — system must be safe under any combination |
| 2 | Branch model | Short-lived work branches off `feature/lovable-migration` (the trunk); PR #6 to `main` stays open until cutover |
| 3 | Deploy model | Deploy from trunk only, post-merge; work branches never deploy |
| 4 | Spec sharing | `docs/superpowers/specs/` becomes tracked, including the previously disk-only cutover spec |
| 5 | Task ledger | GitHub Issues (assignee = soft claim, branch/draft PR = hard claim) |
| 6 | Review gate | Cross-review by convention: the other human reviews PRs into trunk, assisted by fresh-context `/code-review`; the server enforces PR-only (not approval), so solo stretches can self-merge after an agent review |
| 7 | Infrastructure depth | Approach B: shared checked-in config + deterministic guardrails; no new external tooling |

## 3. Branch & deploy topology

### Branches

- **Trunk:** `feature/lovable-migration`. Integration branch. Receives changes ONLY via reviewed PRs (enforced — §6). PR #6 to `main` stays open; preview env remains the live test surface.
- **Work branches:** `<name>/<issue#>-<slug>` where `<name>` is the developer's lowercase first name — e.g. `emil/14-slice6-ideas`, `martin/9-unenroll-dialog`. Always created from fresh trunk (`git fetch && git switch -c emil/14-slice6-ideas origin/feature/lovable-migration`).
- **Lifecycle:** branch at task start → draft PR immediately (the visible hard claim) → rebase on trunk whenever trunk moves → mark ready → review (cross-review when both active; `/code-review` + self-merge when solo) → merge → delete branch.
- **Merge order:** first-ready-first-merged. After any merge, the other in-flight branch rebases before its own review completes.
- **Merge style:** regular merge or squash per PR author's judgment; rebase work branches rather than back-merging trunk into them, to keep history readable for both humans and agents.

### Deploys (shared Azure backend)

There is ONE function app, ONE database, ONE SWA preview, and deploys are manual (`func azure functionapp publish func-ai-education-migration` — CI deploy externally blocked by the GitHub ToS block on `Azure/functions-action`).

- Work branches run **local verification only**: `npm test` (mock contract suites), `npm run build`, `npx tsc --noEmit`. They never deploy.
- Deploys run **only from fresh trunk, only after a merge**. The deployed artifact therefore always equals trunk and contains both developers' merged work.
- Procedure (unchanged from current practice, now a shared rule): pull trunk → `functions/`: `npm install && npm run build && npm test` → `func azure functionapp publish func-ai-education-migration` → wait ~3 min file sync → `az functionapp restart` if the host parks in `Error` → smoke against the regionalized hostname.
- **Announce:** one comment on the just-merged PR: `deploying trunk @<short-sha>`. The other developer treats the preview/DB as unstable until a follow-up `deployed, smoke ok` comment.
- E2e gates (Definition of Done Gate 4) happen post-merge on the PR-6 preview, as today.

### Parallel-safety rule (file exclusivity)

Before starting a task, check the other person's claimed issues/draft PRs for **file-scope overlap** (issue template carries a "Files touched" field — §4). Overlapping scopes are not worked in parallel; the later claimant either picks something else or sequences behind the first. Changes to shared contracts (`functions/shared/*`, `src/lib/api.ts`, DB schema, `CLAUDE.md`, `.claude/*`) are treated as interface work: small, dedicated PRs, merged before dependent work fans out.

## 4. Ledger: GitHub Issues + slimmer STATUS.html

### Issues

- Every actionable item becomes an issue: remaining slices (2, 3a, 3b, 3c, 6, 7, 8), each STATUS.html known bug, hardening/CI-debt items (~15–20 issues seeded at setup).
- **Labels:** `slice`, `bug`, `hardening`, `ci`, `polish`, `blocked`.
- **Claiming:** assignee = soft claim (intent); work branch + draft PR = hard claim (in flight). Unassigned + no branch = free. Sessions check both at pickup.
- **Issue template** (`.github/ISSUE_TEMPLATE/task.yml`) fields: summary · type label · **files/dirs expected to be touched** · acceptance criteria / DoD gate reference · depends-on (issue #s).
- Slice issues reference the (now committed) cutover spec section for their slice definition rather than duplicating it.

### STATUS.html (slims down) & WORKLOG.md (unchanged)

- `migration/STATUS.html` keeps: current checkpoint, operational quirks, accepted trade-offs, BLOCKED-until-merge list, and a pointer to the issue board. Known-bug *details* migrate into their issues (STATUS.html keeps one-line pointers until the issue closes).
- `migration/WORKLOG.md` stays append-only history. Each merged work branch appends its dated entry as part of its PR. Merge conflicts (two PRs appending concurrently) resolve by keeping both entries in date order — append-only files merge nearly always cleanly.

## 5. Shared Claude config (checked in)

Everything below is committed, so both machines' sessions behave identically and config changes are PR-reviewed like code.

### CLAUDE.md (restructured, target <200 lines)

- **Keeps:** ADR sequential-approval rule, Lovable AIR read-only rule, migration safety constraints (updated: the "do not mutate application source outside migration/" constraint is superseded by the normal work-branch flow now that slices land via reviewed PRs — constraint text revised to "follow the collaboration workflow" + the remaining Azure/secrets/patches constraints).
- **Adds:** collaboration rules — branch naming, claim rule, deploy-from-trunk rule, file-exclusivity check, cross-review gate, WORKLOG append rule. Each one line; details live in the skills.
- **Drops:** the stale macOS memory path for the adr-kit fix. The adr-kit `uvx` fix content is recovered from the original machine (colleague's Mac) into `docs/tooling/adr-kit.md`; CLAUDE.md points there. If unrecoverable, the pointer is dropped and the fix re-documented when next needed.
- `AGENTS.md` kept in sync (same collaboration rules).

### `.claude/rules/` (path-scoped conventions)

- `functions.md` (`paths: functions/**`): barrel-import requirement (`functions/index.ts`), no load-time side effects that can throw, `getProfile`-based identity/authz pattern, no `admin`-prefixed function names, mock contract test conventions (mock `shared/auth`/`shared/db`/`shared/profile`, never touch a real DB), pinned `@azure/functions@4.5.0` / Node `~20` runtime reality.
- `frontend.md` (`paths: src/**`): `callApi` for all backend calls (no `supabase.*` in cut-over areas), profile-gated loading-guard pattern (Dashboard-style), i18n keys added in both `en` and `da`, shadcn/ui + TanStack Query conventions per ADRs 0003/0004.

### `.claude/skills/` (three project skills)

- **`slice-workflow`** — the slice execution playbook extracted from the cutover spec: the 5-gate Definition of Done, authz-parity-from-RLS procedure, endpoint conventions, frontend cutover steps, deploy + smoke procedure. Invoked when a session starts slice work.
- **`pickup`** — start-of-session: read open issues + in-flight draft PRs → check file-scope overlap against the other person's claims → claim (assign issue) → branch off fresh trunk → open draft PR. Refuses to claim on overlap.
- **`handoff`** — end-of-session: update the issue (state, what's done/remaining) → push the branch → summarize on the draft PR → if merging: append WORKLOG entry, update STATUS.html checkpoint, run the deploy procedure.

### `.claude/settings.json` (shared baseline)

- Shared permission allowlist: the read-only git/npm/test/typecheck commands both developers always approve (seeded via `/fewer-permission-prompts` analysis at implementation time, then PR-reviewed). Personal extras stay in `.claude/settings.local.json` (auto-gitignored).
- The PreToolUse guardrail hook registration (§6).
- Note: each developer approves the project hook + any project MCP servers once on first use (Claude Code trust prompts — expected, not an error).

### Specs tracked

`docs/superpowers/specs/` enters git: the 2026-06-03 cutover spec (slice definitions, conventions §7, DoD gates) and this document. Owner-approved reversal of the earlier disk-only decision (rationale: the colleague's sessions need the slice playbook; disk-only state cannot support two machines).

## 6. Guardrails (deterministic, cross-platform)

1. **GitHub ruleset on `feature/lovable-migration`** (server-side, OS-independent): require a pull request before merging (0 required approvals), block force pushes. No direct pushes — both developers and both agents go through PRs. Cross-review is a convention on top (the other human reviews when available), not a server gate, so solo work never blocks. (A ruleset already exists for `main`; this adds one for the trunk.)
2. **Claude Code `PreToolUse` hook** (registered in committed `.claude/settings.json`; script at `.claude/hooks/guard-trunk.mjs`, plain Node — runs identically on Windows and macOS): when a Bash tool call matches `git commit` / `git push` and the current branch is `feature/lovable-migration` or `main`, exit 2 with the message "Trunk receives changes via PR only — create a work branch: `<name>/<issue#>-<slug>`". Fast local feedback before the server-side wall; PR merges via `gh pr merge` are unaffected.
3. **Existing `.githooks/pre-push` stays dormant** per the 2026-06-05 decision — not resurrected, not extended.

Review assist: every PR gets a fresh-context `/code-review` pass before merge — run by the reviewing human when both are active, by the author before self-merging when solo.

## 7. Onboarding checklist (colleague, macOS)

Everything propagates via `git pull`. One-time steps, in order:

1. Pull trunk; confirm `CLAUDE.md`, `.claude/`, committed specs are present.
2. Open Claude Code in the repo → accept the workspace trust prompt.
3. Approve the project `.mcp.json` server prompt (adr-kit) and the project hook prompt when first triggered.
4. Receive `.env` values via a secure channel (never via git; values exist on Emil's machine and in the SWA workflow config).
5. `gh auth status` — confirm the account with repo push rights is active.
6. Recover `ref_adrkit_uvx_fix.md` from the original macOS setup into `docs/tooling/adr-kit.md` (PR it) — he is the only one with access to that file.
7. First real task = cross-review the setup PR itself (validates the whole loop end-to-end).

## 8. Out of scope (revisit later)

- **Beads / Task Master / agent-teams / worktree-manager tooling** — Issues + branches cover two humans; revisit only if agent count per person grows.
- **`@claude` GitHub Actions** (issue → autonomous PR) — natural later bolt-on to the Issues ledger; needs API billing decision.
- **CI test gates on trunk** — existing backlog idea (STATUS.html / future issue); especially valuable once CI deploys unblock.
- **Second Azure environment** — only if post-merge e2e contention actually bites.
- **Git worktrees** — per-person local concern (e.g. running a review session beside a build session); not part of the two-human protocol. Optional, documented by Anthropic, no setup required from this design.

## 9. Implementation outline

All setup work itself follows the new rules: it rides ONE work branch (`emil/<issue#>-collab-setup`) with a draft PR, cross-reviewed by the colleague as his onboarding exercise (§7.7). The branch also carries the currently-uncommitted worklog-split files (`migration/STATUS.html`, modified `migration/WORKLOG.md`) — they predate this design but were never committed. Order:

1. Seed labels + ~15–20 issues from STATUS.html and remaining slices (GitHub-side).
2. On the setup branch: commit specs (cutover + this doc) and the pending worklog-split files.
3. Write the repo artifacts: `.github/ISSUE_TEMPLATE/task.yml`, `.claude/rules/`, the three skills, `.claude/hooks/guard-trunk.mjs`, `.claude/settings.json`.
4. Restructure CLAUDE.md + AGENTS.md; slim STATUS.html (bug details → issues).
5. Open the draft PR.
6. Create the trunk ruleset (GitHub-side) — last, after the PR is open, so the setup branch isn't blocked mid-flight.
7. Colleague reviews per §7; merge.

## 10. Risks & mitigations

- **Self-merge can land an unreviewed change on trunk** (approval is not server-enforced): accepted for solo velocity; mitigated by the `/code-review` agent pass before any self-merge and the other person reviewing asynchronously after.
- **WORKLOG/STATUS merge conflicts:** WORKLOG is append-only (trivial resolution); STATUS.html slims down precisely to reduce concurrent-edit surface; remaining conflicts are small text merges.
- **Deploy races despite the rule:** the announce-comment convention plus deploy-from-fresh-trunk means a race window only exists if both merge and deploy simultaneously without reading the PR thread — accepted as low-likelihood for two people; revisit with a lock file if it ever happens.
- **CLAUDE.md drift:** all CLAUDE.md/`.claude/` changes ride in PRs (they're committed files), so drift is caught in cross-review.
- **Stale claims** (assigned issue, no activity): convention — a claim with no branch push for 7 days is fair game after a ping.
