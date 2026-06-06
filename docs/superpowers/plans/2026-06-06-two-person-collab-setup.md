# Two-Person Claude Code Collaboration Setup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved collaboration system (spec: `docs/superpowers/specs/2026-06-06-two-person-claude-code-collaboration-design.md`) — committed Claude config, guardrails, GitHub ledger, and docs — on one setup branch.

**Architecture:** All shared state rides in git (`CLAUDE.md`, `.claude/`, specs, ledger docs) or GitHub (issues, labels, ruleset). One setup work branch carries every file change; GitHub-side mutations happen via `gh` CLI; two owner-only actions (enable issues, create ruleset) are delegated to Martin with verbatim commands.

**Tech Stack:** git, gh CLI, Node ≥18 (hook script), Claude Code project config (settings/skills/rules/hooks), GitHub issue forms + rulesets.

**Execution context:** Run from `I:\Personal\learn-wings` on Emil's machine, active gh account `emkataumre` (push, NOT admin). Remote: `MartinHenriksenAIR/learn-wings`. Current branch: `feature/lovable-migration` with uncommitted files: `migration/WORKLOG.md` (modified), `migration/STATUS.html` (untracked), `docs/superpowers/specs/*` (untracked ×2), `docs/superpowers/plans/2026-06-06-slice-6-ideas.md` (untracked — **belongs to the Slice 6 effort; do NOT add it in this plan's commits**).

---

### Task 1: Create the setup issue + branch

> **2026-06-06 revision:** originally planned as a bootstrap exception (no issue number — issues were disabled). The owner enabled issues before execution, and the Slice 6 session had meanwhile landed commits `1139f25..3107970` directly on the trunk (pushed) plus uncommitted Playwright-sweep ledger edits. Baselines below reflect that reality.

**Files:** none (git + GitHub only)

- [ ] **Step 1: Verify state and correct account**

Run: `gh auth status` — Expected: `emkataumre ... Active account: true`. If not: `gh auth switch --user emkataumre`.

Run: `git status --short` — Expected exactly:
```
 M migration/STATUS.html
 M migration/WORKLOG.md
?? docs/superpowers/plans/2026-06-06-slice-6-ideas.md
?? docs/superpowers/plans/2026-06-06-two-person-collab-setup.md
?? docs/superpowers/specs/
```
Anything else → stop and surface to the user. Trunk must be in sync with origin (`git status -sb` shows no ahead/behind).

- [ ] **Step 2: Create the setup issue (issues are enabled), then the branch from current HEAD**

```bash
gh issue create --title "Two-person Claude Code collaboration system (setup)" --body "Implements docs/superpowers/specs/2026-06-06-two-person-claude-code-collaboration-design.md. Files touched: CLAUDE.md, AGENTS.md, .claude/**, .github/ISSUE_TEMPLATE/**, docs/superpowers/**, docs/tooling/**, migration/STATUS.html, migration/WORKLOG.md."
```

Note the returned issue number `<n>`, then (uncommitted files must come WITH us — branch from HEAD, do not re-fetch):

```bash
git switch -c emil/<n>-collab-setup
```

Run: `git branch --show-current` — Expected: `emil/<n>-collab-setup`. All later tasks substitute the real `<n>`.

---

### Task 2: Commit the pending Playwright-sweep ledger edits (pre-existing work, as-is)

These were left uncommitted by the closed Slice-6/sweep session (sweep findings + WORKLOG entries). Commit them unmodified FIRST so the slimdown in Task 9 is a separate, reviewable change.

**Files:**
- Commit: `migration/STATUS.html` (modified, as-is)
- Commit: `migration/WORKLOG.md` (modified, as-is)

- [ ] **Step 1: Stage and commit**

```bash
git add migration/STATUS.html migration/WORKLOG.md
git commit -m "docs(migration): pre-elevation Playwright sweep ledger edits (2026-06-06 session)"
```

Run: `git status --short -- migration/` — Expected: empty output.

---

### Task 3: Commit the specs (cutover + collaboration)

Owner-approved reversal of the disk-only decision (spec §5).

**Files:**
- Commit: `docs/superpowers/specs/2026-06-03-supabase-azure-cutover-design.md` (as-is)
- Commit: `docs/superpowers/specs/2026-06-06-two-person-claude-code-collaboration-design.md` (as-is)
- Commit: `docs/superpowers/plans/2026-06-06-two-person-collab-setup.md` (this plan)

- [ ] **Step 1: Stage exactly these files (NOT the slice-6 plan)**

```bash
git add docs/superpowers/specs/2026-06-03-supabase-azure-cutover-design.md docs/superpowers/specs/2026-06-06-two-person-claude-code-collaboration-design.md docs/superpowers/plans/2026-06-06-two-person-collab-setup.md
git commit -m "docs(specs): track cutover spec + two-person collaboration spec/plan"
```

Run: `git status --short` — Expected: only `?? docs/superpowers/plans/2026-06-06-slice-6-ideas.md` remains.

---

### Task 4: adr-kit troubleshooting doc

Replaces CLAUDE.md's stale macOS memory-file pointer. Content reconstructed from `migration/WORKLOG.md` (2026-05-19 entry); Martin enriches from his machine's `ref_adrkit_uvx_fix.md` during onboarding.

**Files:**
- Create: `docs/tooling/adr-kit.md`

- [ ] **Step 1: Write the doc**

```markdown
# adr-kit — Known Issues & Fixes

The repo uses the adr-kit MCP server (solution8-com/AIRStack-ADRKit v0.2.7) configured in `.mcp.json`.

## Symptoms → fixes

**MCP server not connecting / tools missing**
Run adr-kit via `uvx` against the patched fork (upstream PR #1 fixed: wrong MCP config filename `.claude-mcp-config.json` → `.mcp.json`, wrong JSON key `"servers"` → `"mcpServers"`, stale hardcoded tool list, schema path resolution, missing package-data config). If the configured command in `.mcp.json` fails, reinstall via `uvx` and restart the Claude Code session.

**`adr_approve` fails on schema validation**
v0.2.7 shipped a schema bug — the schema file had to be manually installed from GitHub. The `uvx` install of the patched fork includes it.

**YAML frontmatter corruption: `]approval_date` concatenated on one line**
Historic adr-kit write bug — it breaks YAML parsing for ALL adr-kit tools against that file. Fix: open the ADR, put `approval_date` on its own line. All 9 baseline ADRs were repaired this way on 2026-05-19; new occurrences mean the buggy version is back in use.

**Operational rule (also in CLAUDE.md):** approve ADRs one at a time, sequentially — parallel `adr_approve` calls fire simultaneous permission prompts and all but the first are auto-rejected.

> Martin: this file replaces the `ref_adrkit_uvx_fix.md` memory note from the original macOS setup. Please PR in any specifics missing here (exact `uvx` command line, fork URL).
```

- [ ] **Step 2: Commit**

```bash
git add docs/tooling/adr-kit.md
git commit -m "docs(tooling): adr-kit troubleshooting (replaces machine-local memory pointer)"
```

---

### Task 5: Trunk-guard hook script + manual verification

Cross-platform Node PreToolUse hook (spec §6.2). Plain Node, no deps, relative invocation (hooks run with cwd = project root on both OSes).

**Files:**
- Create: `.claude/hooks/guard-trunk.mjs`

- [ ] **Step 1: Write the hook script**

```javascript
#!/usr/bin/env node
// PreToolUse hook (matcher: Bash). Blocks `git commit` / `git push` while the
// checkout is on a protected branch — trunk receives changes via PR only.
// Exit 0 = allow, exit 2 = block (stderr is shown to the agent).
import { execSync } from "node:child_process";

const PROTECTED = ["feature/lovable-migration", "main"];

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);

let input = {};
try {
  input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
} catch {
  process.exit(0); // unparseable input — never block on our own failure
}

const command = input?.tool_input?.command ?? "";
if (!/\bgit\b[^\n|;&]*\b(commit|push)\b/.test(command)) process.exit(0);

let branch = "";
try {
  branch = execSync("git rev-parse --abbrev-ref HEAD", {
    cwd: input.cwd || process.cwd(),
    stdio: ["ignore", "pipe", "ignore"],
  })
    .toString()
    .trim();
} catch {
  process.exit(0); // not a git dir / git unavailable — don't block
}

if (PROTECTED.includes(branch)) {
  console.error(
    `BLOCKED by .claude/hooks/guard-trunk.mjs: '${branch}' receives changes via pull request only. ` +
      `Create a work branch first: git switch -c <firstname>/<issue#>-<slug>  (collaboration rules: CLAUDE.md).`
  );
  process.exit(2);
}
process.exit(0);
```

- [ ] **Step 2: Verify — protected branch blocks (we are on `emil/collab-setup`, so simulate via a temp checkout of the trunk path using the hook's cwd input)**

PowerShell:
```powershell
'{"tool_input":{"command":"git commit -m test"},"cwd":"I:\\Personal\\learn-wings"}' | node .claude/hooks/guard-trunk.mjs; echo "exit=$LASTEXITCODE"
```
Expected: `exit=0` (current branch is `emil/collab-setup` — allowed).

```powershell
git stash --include-untracked; git switch feature/lovable-migration
'{"tool_input":{"command":"git commit -m test"},"cwd":"I:\\Personal\\learn-wings"}' | node .claude/hooks/guard-trunk.mjs; echo "exit=$LASTEXITCODE"
git switch emil/collab-setup; git stash pop
```
Expected: stderr `BLOCKED by .claude/hooks/guard-trunk.mjs: 'feature/lovable-migration' ...` and `exit=2`.
(If the working tree is clean at this point the stash commands no-op with a warning — fine.)

- [ ] **Step 3: Verify — non-git commands pass**

```powershell
'{"tool_input":{"command":"npm test"},"cwd":"I:\\Personal\\learn-wings"}' | node .claude/hooks/guard-trunk.mjs; echo "exit=$LASTEXITCODE"
```
Expected: `exit=0`, no output.

- [ ] **Step 4: Commit**

```bash
git add .claude/hooks/guard-trunk.mjs
git commit -m "feat(claude): cross-platform trunk-guard PreToolUse hook"
```

---

### Task 6: Rewrite `.claude/settings.json` (shared baseline + hook registration)

Replaces the stale jq/`/cavemem` hooks (reference a skill that no longer exists; `jq` pipe is not portable to Windows). Registers the guard hook. Adds a conservative shared allowlist (refine later with `/fewer-permission-prompts`).

**Files:**
- Modify: `.claude/settings.json` (full replacement)

- [ ] **Step 1: Write the new settings.json**

```json
{
  "permissions": {
    "allow": [
      "mcp__adr-kit__adr_approve",
      "Bash(npm test:*)",
      "Bash(npm run build:*)",
      "Bash(npm run test:*)",
      "Bash(npx tsc:*)",
      "Bash(npx vitest run:*)",
      "Bash(gh issue list:*)",
      "Bash(gh issue view:*)",
      "Bash(gh pr list:*)",
      "Bash(gh pr view:*)",
      "Bash(gh pr diff:*)",
      "Bash(gh pr checks:*)"
    ]
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node .claude/hooks/guard-trunk.mjs",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 2: Validate JSON**

```powershell
node -e "JSON.parse(require('fs').readFileSync('.claude/settings.json','utf8')); console.log('valid')"
```
Expected: `valid`

- [ ] **Step 3: Commit**

```bash
git add .claude/settings.json
git commit -m "feat(claude): shared permission baseline + trunk-guard hook; drop stale cavemem hooks"
```

---

### Task 7: Path-scoped convention rules

**Files:**
- Create: `.claude/rules/functions.md`
- Create: `.claude/rules/frontend.md`

- [ ] **Step 1: Write `.claude/rules/functions.md`**

```markdown
---
paths:
  - "functions/**"
---

# Azure Functions conventions (hard-won — see WORKLOG Slice 0)

- **Every new function MUST be imported in the `functions/index.ts` barrel** (`main: dist/index.js`). An unimported function silently never registers.
- **No module-load-time side effects that can throw** (e.g. `new Resend(env)` at top level) — they crash the worker entry and deregister ALL functions. Initialize lazily inside handlers.
- **Function/route names may NOT start with `admin`, `runtime`, or `host`** (reserved prefixes). Use suffix style: `user-actions-admin`, `course-admin`.
- **Identity/authz:** use `functions/shared/profile.ts` — `getProfile(entra_oid+entra_tid)`, `isActiveMember`, `isOrgAdmin`. Never trust client-supplied user ids; platform admins bypass org-membership checks by suite convention.
- **Pinned versions:** `@azure/functions` exactly `4.5.0` (4.14 fails the worker handshake); runtime is Node `~20` (`WEBSITE_NODE_DEFAULT_VERSION` — Node 22 crashes gRPC). Don't bump without re-verifying registration.
- **Tests:** mock contract tests per endpoint (`*/index.test.ts`): happy path + 401/403 authz + key errors. Mock `shared/auth`, `shared/db`, `shared/profile`; NEVER touch a real DB. Run: `cd functions && npm test`.
- 500 responses currently propagate `err.message` (tracked hardening issue — candidate ADR for generic 500 + logged context). Match the suite pattern until that ADR lands.
```

- [ ] **Step 2: Write `.claude/rules/frontend.md`**

```markdown
---
paths:
  - "src/**"
---

# Frontend conventions (migration-era)

- **All backend calls in cut-over areas go through `callApi`/`callApiRaw` (`src/lib/api-client.ts`)** — never `supabase.*` in migrated files; a slice's DoD includes a zero-`supabase.*` grep gate on its files.
- **Loading guards:** use the Dashboard's profile-gated three-way pattern (profile = user-context-resolved marker; explicit empty-state fork) — NOT the unguarded `!user || !currentOrg → setLoading(false)` variant.
- **Spinner state:** any handler that sets a saving/loading flag clears it in `finally` — stranded spinners were a recurring migration bug class.
- **i18n:** every new user-facing string gets keys in BOTH `en` and `da`.
- **Stack (per ADRs 0001–0004):** React 18 + Vite SPA, TypeScript strict, shadcn/ui + Radix + Tailwind, TanStack Query v5. No new state libs.
- Verify: `npm run build`, `npm test`, `npx tsc --noEmit -p tsconfig.app.json` (exit 0).
```

- [ ] **Step 3: Commit**

```bash
git add .claude/rules/functions.md .claude/rules/frontend.md
git commit -m "feat(claude): path-scoped convention rules for functions/ and src/"
```

---

### Task 8: The three project skills

**Files:**
- Create: `.claude/skills/pickup/SKILL.md`
- Create: `.claude/skills/handoff/SKILL.md`
- Create: `.claude/skills/slice-workflow/SKILL.md`

- [ ] **Step 1: Write `.claude/skills/pickup/SKILL.md`**

```markdown
---
name: pickup
description: Use at session start when beginning work on learn-wings — reads the ledger, checks claims for file-scope overlap, claims an issue, creates the work branch and draft PR.
---

# Pickup — start-of-session claiming

1. **Read state:** `migration/STATUS.html` (checkpoint, quirks), then:
   - `gh issue list --state open` — the backlog
   - `gh pr list --state open` — draft PRs = active claims (branch names show who/what)
2. **Choose an issue** that is unassigned AND has no associated branch/draft PR. Honor `Depends on:` references and the `blocked` label.
3. **Overlap check (MANDATORY):** compare the issue's "Files touched" against every open draft PR's issue. Overlapping file scope → do NOT claim; pick something else or coordinate with the other developer first. Shared contracts (`functions/shared/*`, `src/lib/api-client.ts`, DB schema, `CLAUDE.md`, `.claude/*`) change in small dedicated PRs that merge before dependent work.
4. **Claim:**
   - `gh issue edit <n> --add-assignee @me`
   - `git fetch origin && git switch -c <firstname>/<n>-<slug> origin/feature/lovable-migration`
   - Commit something minimal if needed, then open the claim PR immediately:
     `gh pr create --draft --base feature/lovable-migration --title "<type>: <slug> (#<n>)" --body "Claims #<n>. Files: <scope from issue>."`
5. **Stale claims:** an assigned issue with no branch push for 7 days is fair game after a ping to the other developer.
6. For slice work, now invoke the `slice-workflow` skill.
```

- [ ] **Step 2: Write `.claude/skills/handoff/SKILL.md`**

```markdown
---
name: handoff
description: Use at session end on learn-wings — pushes state, updates the issue and draft PR so the other developer (and any future session) can pick up cleanly; runs the merge/deploy ritual when work is done.
---

# Handoff — end-of-session

**Every session end (work continues later):**
1. Commit (work branches commit freely) and `git push -u origin HEAD`.
2. Comment on the draft PR: done / in-progress / next steps / any gotchas discovered.
3. Update the issue if scope changed (especially "Files touched" — the other developer's overlap check depends on it).

**When the work is complete (merge ritual):**
1. Verify locally: `cd functions && npm test` (if functions changed), `npm run build`, `npm test`, `npx tsc --noEmit -p tsconfig.app.json`.
2. Append the dated entry to `migration/WORKLOG.md` (append-only; keep both entries on conflict) and update `migration/STATUS.html`'s checkpoint section. Commit.
3. Mark the PR ready: `gh pr ready`. Run `/code-review` on it.
4. Review gate: cross-review by the other developer when available; when solo, self-merge is allowed AFTER the `/code-review` pass is clean.
5. Merge, then `git switch feature/lovable-migration && git pull`, delete the branch.
6. **Deploy (only if functions changed, only from fresh trunk):** see the deploy section of `slice-workflow`. Announce on the merged PR: `deploying trunk @<short-sha>` … then `deployed, smoke ok`.
7. Close the issue: `gh issue close <n> --comment "merged in #<pr>"`.
```

- [ ] **Step 3: Write `.claude/skills/slice-workflow/SKILL.md`**

```markdown
---
name: slice-workflow
description: Use when executing a migration slice (course authoring, org admin, ideas, resources, decommission) on learn-wings — the slice playbook with the 5-gate Definition of Done, conventions, and deploy/smoke procedure.
---

# Slice workflow — Lovable/Supabase → Azure cutover

**Source of truth:** `docs/superpowers/specs/2026-06-03-supabase-azure-cutover-design.md` (slice definitions §6, cross-cutting items §7). `migration/STATUS.html` supersedes it on operational details (deploy mechanics, hostnames, quirks).

## Shape of a slice
Per spec §3: build the slice's Azure endpoint(s) + mock contract tests → cut its frontend file(s) over to `callApi` → verify e2e in the preview env. Decompose so each task self-verifies: one endpoint = one task (`cd functions && npm test` green); one frontend file = one swap task (zero `supabase.*` by grep + build + tests green); one closing task = e2e checklist.

## Authorization parity
Derive each endpoint's authz from the original RLS policies in `supabase/migrations/` — build a per-endpoint authz table with policy provenance in the slice plan (Slice 5's plan is the model). Platform admins bypass org-membership checks suite-wide; org-admin overrides never apply to global-scope content.

## Definition of Done — 5 gates
1. **Contract tests pass** — mock-DB vitest per endpoint: happy + 401/403 + key errors.
2. **Deployed & reachable** — endpoint registered; smoke 401 unauth / 200 authed.
3. **Frontend cutover proof** — target files: zero `supabase.*` (grep); `npm run build` + `npm test` green.
4. **End-to-end acceptance** — scripted checklist passes in the PR-6 preview against the seeded DB (real Entra login). Gate 4 is user-verified.
5. **Parity** — behaviour matches pre-migration Supabase behaviour.

## Deploy & smoke (current reality — check STATUS.html first)
- Work branches NEVER deploy. Deploys run only from fresh trunk after merge (collaboration rule).
- CI deploy is blocked externally (GitHub ToS block on `Azure/functions-action` — check `gh api repos/Azure/functions-action`). Until lifted, deploy manually: `cd functions && npm install && npm run build && npm test && func azure functionapp publish func-ai-education-migration`.
- Post-deploy: wait ~3 min file sync; if the host parks in `Error`, `az functionapp restart` (operational quirk, expected).
- Smoke against the REGIONALIZED hostname `func-ai-education-migration-c0fgeqdnfvd6h0cf.swedencentral-01.azurewebsites.net` (SWA `/api/*` falls through to 404/405 until the post-merge re-link; the classic hostname does not resolve).
- Announce on the merged PR: `deploying trunk @<short-sha>` → `deployed, smoke ok`.

## Bookkeeping
Merged slice work appends a dated `migration/WORKLOG.md` entry (endpoints, files cut over, fixes, decisions — match existing entries' shape) and updates `migration/STATUS.html` (checkpoint; move fixed Known Issues out). Conventions for code live in `.claude/rules/functions.md` and `.claude/rules/frontend.md` — they load automatically when touching those paths.
```

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/pickup/SKILL.md .claude/skills/handoff/SKILL.md .claude/skills/slice-workflow/SKILL.md
git commit -m "feat(claude): pickup, handoff, and slice-workflow project skills"
```

---

### Task 9: Restructure CLAUDE.md + sync AGENTS.md + slim STATUS.html

**Files:**
- Modify: `CLAUDE.md` (full replacement)
- Modify: `AGENTS.md` (full replacement)
- Modify: `migration/STATUS.html` (Known Issues section replaced; rest kept)

- [ ] **Step 1: Write the new `CLAUDE.md`**

```markdown
# learn-wings — Claude Code Instructions

## Session start
1. Read `migration/STATUS.html` — the live ledger (checkpoint, operational quirks, pointers).
2. Check claims: `gh issue list --state open` (backlog) + `gh pr list --state open` (draft PRs = active claims).
3. Starting work → invoke the `pickup` skill. Ending a session → `handoff`. Executing a slice → `slice-workflow`.

## Collaboration rules (two developers + their agents)
- **Trunk = `feature/lovable-migration`.** It receives changes ONLY via pull requests (server-enforced ruleset + local guard hook). PR #6 to `main` stays open until full cutover.
- **Work branches:** `<firstname>/<issue#>-<slug>` off fresh trunk (e.g. `emil/14-slice6-ideas`). Open a draft PR immediately — the draft PR is the claim.
- **Before claiming:** check the other developer's claimed issues / draft PRs for file-scope overlap ("Files touched" on the issue). Never work overlapping scopes in parallel. Shared contracts (`functions/shared/*`, `src/lib/api-client.ts`, DB schema, `CLAUDE.md`, `.claude/*`) change in small dedicated PRs, merged before dependent work.
- **Review:** cross-review when both developers are active; `/code-review` + self-merge allowed when solo. Rebase work branches on trunk when it moves.
- **Deploys: ONLY from fresh trunk after a merge** — never from work branches (one shared function app/DB/preview). Procedure in `slice-workflow`. Announce on the merged PR.
- **Bookkeeping:** merged PRs append a dated `migration/WORKLOG.md` entry (append-only) and update `migration/STATUS.html`'s checkpoint.

## ADR Workflow
**Approve ADRs one at a time, sequentially** — never call `adr_approve` in parallel (parallel MCP permission prompts auto-reject all but the first). Applies to all `mcp__adr-kit__adr_approve` calls. adr-kit issues (MCP not connecting, YAML `]approval_date` corruption)? See `docs/tooling/adr-kit.md`.

## Lovable Source Reference
Lovable workspace **AIR** (`Q7aTXTRh50LxV00N6SRQ`) holds the original project. **Read-only** — no mutating Lovable tools without explicit user instruction.

## Migration Safety Constraints (until migration completes)
- Application source changes follow the collaboration workflow above (work branch + PR) — no direct-to-trunk edits.
- Do not mutate Azure resources (no `az` create/delete/update) — deploys via the documented procedure only.
- Do not delete, rotate, overwrite, or print secrets.
- Do not apply patches from `migration/lovable-supabase-removal/patches/` to live source; planning artifacts only under `migration/lovable-supabase-removal/`.
```

- [ ] **Step 2: Write the new `AGENTS.md`** (same content, agent-addressed header)

```markdown
# learn-wings — Agent Instructions

Mirror of `CLAUDE.md` for non-Claude agents. The rules below are identical in substance — `CLAUDE.md` is the maintained original; update both together.

## Session start
Read `migration/STATUS.html` first. Check claims via `gh issue list --state open` and `gh pr list --state open` (draft PRs = active claims).

## Collaboration rules (two developers + their agents)
- Trunk = `feature/lovable-migration`; changes land ONLY via pull requests. Work branches: `<firstname>/<issue#>-<slug>`; a draft PR opened at start is the claim.
- Check claimed issues/draft PRs for file-scope overlap before starting; never parallelize overlapping scopes. Shared contracts (`functions/shared/*`, `src/lib/api-client.ts`, DB schema, `CLAUDE.md`, `.claude/*`) change in small dedicated PRs first.
- Review: cross-review when both developers active; agent review + self-merge when solo.
- Deploys ONLY from fresh trunk after merge; announce on the merged PR.
- Merged PRs append to `migration/WORKLOG.md` (append-only) and update `migration/STATUS.html`.

## ADR Workflow
Approve ADRs sequentially — never parallel `adr_approve` (simultaneous permission prompts auto-reject). Troubleshooting: `docs/tooling/adr-kit.md`.

## Lovable Source Reference
Workspace **AIR** (`Q7aTXTRh50LxV00N6SRQ`) is read-only — no mutating Lovable tools without explicit user instruction.

## Migration Safety Constraints
- Source changes via work branch + PR only; no direct-to-trunk edits.
- No Azure resource mutations; no secret deletion/rotation/printing.
- No applying `migration/lovable-supabase-removal/patches/`; planning artifacts only under `migration/lovable-supabase-removal/`.
```

- [ ] **Step 3: Slim `migration/STATUS.html`** (HTML in-place edits — keep markup flat, preserve the existing styles)

Everything issue-shaped moves to the GitHub board (Task 12 carries each item's details verbatim in an issue body). Concretely, inside `<section id="known-issues">`:

1. **Insert** directly after the `<h2>` line:
```html
  <p class="note"><strong>Actionable work now lives on the GitHub issue board</strong>
  (<code>gh issue list</code>) — slices, bugs, hardening, CI debt each have an issue carrying
  file scope and acceptance criteria. Claims = assignee + draft PR (see <code>CLAUDE.md</code>
  collaboration rules). This section keeps only what is NOT issue-shaped.</p>
```
2. **Delete** these whole `<h3>` + `<ul>` blocks (now issues): `Human logged`, `Broken — expected, slice-scoped` (incl. its `<p class="note">`), `Broken — small, unscoped`, `CI debt`, `Hardening / debt`, `Post-elevation queue …`, `Cosmetic / test polish …`.
3. **Add** to the `Accepted trade-offs` list (the grade-quiz item survives as a trade-off, not a bug):
```html
    <li><span class="badge tradeoff">TRADE-OFF</span><code>grade-quiz</code> silently records no <code>quiz_attempts</code> row for platform admins without a membership (pre-existing quirk, kept as-is).</li>
```
4. **Keep unchanged:** `Accepted trade-offs`, `Operational quirks`, `Blocked until merge-to-main`, `Pre-cutover user actions`, the whole `Current State` section, footer.
5. In `<section id="picking-up">`: change item 2's `(untracked, disk-only)` to `(tracked)`, and append two `<li>` items:
```html
    <li>Check claims: <code>gh issue list --state open</code> + <code>gh pr list --state open</code> (draft PRs = active claims) — collaboration rules in <code>CLAUDE.md</code></li>
    <li>Starting work → invoke the <code>pickup</code> skill; ending a session → <code>handoff</code>; slice execution → <code>slice-workflow</code></li>
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md AGENTS.md migration/STATUS.html
git commit -m "docs: collaboration rules in CLAUDE.md/AGENTS.md; STATUS.html known-issues move to GitHub issues"
```

---

### Task 10: Issue template + labels

**Files:**
- Create: `.github/ISSUE_TEMPLATE/task.yml`

- [ ] **Step 1: Write the issue form**

```yaml
name: Task
description: A unit of work — slice, bug, hardening, CI, or polish
title: "<short imperative title>"
body:
  - type: textarea
    id: summary
    attributes:
      label: Summary
      description: What needs to happen and why. For slices, link the cutover spec section.
    validations:
      required: true
  - type: textarea
    id: files
    attributes:
      label: Files touched
      description: Files/dirs this task is expected to modify. Used for the parallel-safety overlap check before claiming — keep it current.
      placeholder: |
        functions/ideas*/
        functions/index.ts
        src/lib/ideas-api.ts
    validations:
      required: true
  - type: textarea
    id: acceptance
    attributes:
      label: Acceptance criteria
      description: For slices, reference the 5-gate DoD (slice-workflow skill / cutover spec §4).
  - type: input
    id: depends
    attributes:
      label: Depends on
      placeholder: "#12, #14"
```

- [ ] **Step 2: Commit**

```bash
git add .github/ISSUE_TEMPLATE/task.yml
git commit -m "feat(github): task issue form with file-scope field"
```

- [ ] **Step 3: Create labels (push rights suffice; works even while issues are disabled)**

```bash
gh label create slice --color 1d76db --description "Vertical migration slice" --repo MartinHenriksenAIR/learn-wings
gh label create hardening --color b60205 --description "Security/robustness debt" --repo MartinHenriksenAIR/learn-wings
gh label create ci --color fbca04 --description "CI/CD pipeline work" --repo MartinHenriksenAIR/learn-wings
gh label create polish --color c5def5 --description "Cosmetic / test polish, non-blocking" --repo MartinHenriksenAIR/learn-wings
gh label create blocked --color 5319e7 --description "Waiting on external action or dependency" --repo MartinHenriksenAIR/learn-wings
```

Run: `gh label list --repo MartinHenriksenAIR/learn-wings | grep -E "slice|hardening|ci|polish|blocked"` — Expected: all 5 listed (`bug` already exists).

---

### Task 11: OWNER ACTION (Martin) — enable issues + create the trunk ruleset

emkataumre has push but NOT admin. These two steps need the repo owner (or an admin grant to emkataumre, after which this session can run them). Send Martin this block verbatim:

- [x] **Step 1: Martin enables issues** — ✅ DONE 2026-06-06 (owner enabled before execution). For the record: repo Settings → General → Features → "Issues", or `gh api repos/MartinHenriksenAIR/learn-wings -X PATCH -f has_issues=true`.

- [ ] **Step 2: Martin creates the trunk ruleset** (AFTER the setup PR is open — Task 13 — so the branch isn't blocked mid-flight; spec §9):

```bash
gh api repos/MartinHenriksenAIR/learn-wings/rulesets -X POST --input - <<'EOF'
{
  "name": "trunk-pr-only",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/heads/feature/lovable-migration"], "exclude": [] } },
  "rules": [
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false,
        "allowed_merge_methods": ["merge", "squash", "rebase"]
      }
    },
    { "type": "non_fast_forward" }
  ]
}
EOF
```

- [ ] **Step 3: Verify** (either account):

```bash
gh api repos/MartinHenriksenAIR/learn-wings --jq .has_issues
gh api repos/MartinHenriksenAIR/learn-wings/rulesets --jq '.[] | {name, enforcement}'
```
Expected: `true`, and both `main` and `trunk-pr-only` active.

---

### Task 12: Seed the issue backlog (GATED on Task 11 Step 1)

Bodies follow the template's sections. `-F body=@-` heredocs keep them readable. All commands use `--repo MartinHenriksenAIR/learn-wings` (add it to each; omitted below for brevity — run from the repo dir where `gh` infers it).

> **2026-06-06 revision:** Slice 6 completed before execution (drop its issue); the unenroll-dialog and Courses.tsx bugs were fixed/cleared by the Slice 5/6 sessions (sweep-verified — drop those issues); the 2026-06-06 Playwright sweep + human testing filed new findings (added below, bodies lifted from the pre-slim STATUS.html).

- [ ] **Step 1: Slice issues (6)**

```bash
gh issue create --label slice --title "Slice 2: Course authoring cutover" --body "$(printf '### Summary\nCut course authoring to Azure endpoints (~9): courses-admin CRUD, course-access, course-structure, module/lesson CRUD (lesson DELETE absorbs blob cleanup), quiz-admin GET/PUT (atomic replace of the 7-statement client transaction). Spec §6 Slice 2. Route names must not start with admin- (reserved prefix).\n\n### Files touched\nfunctions/* (new endpoints + index.ts barrel)\nsrc/pages/*CoursesManager*, *CourseEditor*, *QuizEditorDialog*\n\n### Acceptance criteria\n5-gate DoD (slice-workflow skill).\n\n### Depends on\n-')"
gh issue create --label slice --title "Slice 3a: Organizations cutover" --body "$(printf '### Summary\nOrg CRUD endpoints (~4) + OrganizationsManager/OrganizationDetail/OrgSelector cutover; replace getPublicUrl(org-logos) with plain URL construction (VITE_STORAGE_BASE_URL pattern). Spec §6 Slice 3a.\n\n### Files touched\nfunctions/organizations* + index.ts\nsrc/pages/*OrganizationsManager*, *OrganizationDetail*, components OrgSelector\n\n### Acceptance criteria\n5-gate DoD.\n\n### Depends on\n-')"
gh issue create --label slice --title "Slice 3b: Memberships & invitations cutover" --body "$(printf '### Summary\nMembership write endpoints + invitations (GET/POST/bulk/PATCH wrapping the _safe RPCs) + enrollment POST; reconcile invitation-link callers to the {orgId} contract; dedupe OrgUsers.tsx/OrgMembersTab.tsx (near-identical, 12 calls each). Spec §6 Slice 3b.\n\n### Files touched\nfunctions/org-memberships*, invitations*, enrollments* + index.ts\nsrc/pages/*OrgUsers*, components *OrgMembersTab*, *BulkInviteDialog*, *EnrollUserDialog*\n\n### Acceptance criteria\n5-gate DoD. Note: grep-clean gate for OrgUsers/OrgMembersTab only completes after 3c.\n\n### Depends on\nSlice 3a issue')"
gh issue create --label slice --title "Slice 3c: AI-champions writes + user-progress" --body "$(printf '### Summary\nPOST/DELETE /api/ai-champions (reads live in Slice 5s endpoint) + GET /api/user-progress aggregating UserProgressDialog 5-query fan-out. Spec §6 Slice 3c.\n\n### Files touched\nfunctions/ai-champions*, user-progress* + index.ts\nsrc/pages/*OrgUsers*, components *OrgMembersTab*, *UserProgressDialog*\n\n### Acceptance criteria\n5-gate DoD; completes the OrgUsers/OrgMembersTab grep gate.\n\n### Depends on\nSlice 3b issue')"
gh issue create --label slice --title "Slice 7: Resources cutover" --body "$(printf '### Summary\nResources endpoints (~5: list/create/update/delete/pin; user_id derived from token, not client-passed) + src/lib/resources-api.ts over callApi (pages lib-only). Spec §6 Slice 7.\nSweep evidence (2026-06-06): resource reads currently hit the OLD Lovable Supabase on the anon key and show STALE pre-migration data; writes fail 401 SILENTLY (dialog stays open, console-only error).\nALSO fix ResourceLibrary.tsx:255 ownership check: resource.user_id === user?.id compares the Entra OID against the profiles UUID — never matches post-migration; use profile?.id (same bug class as the Slice 6 drafts bug). Cutover checklist for every remaining slice: audit the slices pages for user?.id ownership comparisons.\n\n### Files touched\nfunctions/resources* + index.ts\nsrc/lib/resources-api.ts\nsrc/pages/ResourceLibrary.tsx\n\n### Acceptance criteria\n5-gate DoD; reads come from Azure PG (not stale Supabase); writes succeed with visible feedback; ownership checks use profile.id.\n\n### Depends on\n-')"
gh issue create --label slice --title "Slice 8: Decommission Supabase (LAST)" --body "$(printf '### Summary\nRemove @supabase/supabase-js + lockfile entry; delete src/integrations/supabase/{client,types}.ts; remove VITE_SUPABASE_* config; comment out supabase/functions/ Deno dir, run full regression, then remove. Spec §6 Slice 8.\n\n### Files touched\npackage.json, package-lock.json\nsrc/integrations/supabase/*\nsupabase/functions/*\n.github workflow VITE_* env\n\n### Acceptance criteria\nGrep zero supabase.* in src/; build+tests green; full e2e regression passes.\n\n### Depends on\nALL other slice issues')"
```

- [ ] **Step 2: Bug issues (11)**

```bash
gh issue create --label bug --title "azure-view-url returns 403 for VIDEO blobs (PDF blobs 200, same caller/lesson)" --body "$(printf '### Summary\nRepro captured 2026-06-06 by the Playwright sweep: the seeded course players auto-opened Welcome Video lesson POSTs azure-view-url with {blobPath: videos/welcome-1234abcd.mp4, lessonId: 61111111-...} -> 403 Access denied, while the PDF lessons documents/handbook-5678efgh.pdf -> 200 + valid SAS. The per-path/per-lesson authorization in azure-view-url fails specifically for the video path. Candidate rider for Slice 2 (touches course assets) — coordinate file scope with the Slice 2 claimant.\n\n### Files touched\nfunctions/azure-view-url/ (+ its test)\n\n### Acceptance criteria\nVideo blobs return 200 + SAS for authorized callers; contract test pins both asset types.')"
gh issue create --label bug,blocked --title "Storage-account CORS blocks fetch()-based PDF viewing from app origins" --body "$(printf '### Summary\nSweep 2026-06-06 (NF-1, medium): azure-view-url issues a valid SAS, but the browser fetch to staieducationmigration.blob.core.windows.net dies with No Access-Control-Allow-Origin header from the preview origin. Phase-1 Q5s SAS pattern doesnt need CORS assumption was wrong for fetch()-based viewers (plain video src embeds dont need CORS; fetch() does). Fix: add storage CORS rules for the app origins — USER ACTION (az mutation, agents must not mutate Azure). Verify the production origin is covered pre-cutover.\n\n### Files touched\nNone (Azure storage config) — verify-only after the user applies it.\n\n### Acceptance criteria\nPDF viewer loads blobs from the preview origin; production origin verified pre-cutover.')"
gh issue create --label bug --title "Refresh and deep-links always land on the dashboard (breaks Copy link)" --body "$(printf '### Summary\nHuman-logged + sweep-extended (2026-06-06): refresh anywhere returns to the dashboard instead of the page of origin; direct URL navigation (e.g. /app/courses or a post URL) also lands on the dashboard — so Copy link on posts/comments cannot work until fixed. Likely the post-MSAL-redirect routing always navigating home instead of preserving the intended location.\n\n### Files touched\nsrc/ (router/auth bootstrap — likely main.tsx / route guards)\n\n### Acceptance criteria\nRefresh stays on the current page; deep-links resolve to their target after login; Copy link works.')"
gh issue create --label bug --title "course-player-data has no per-course access gate" --body "$(printf '### Summary\nAny authenticated user with a profile can pull any published courses player payload — inconsistent with quiz-by-lesson, which gates on org access. Align.\n\n### Files touched\nfunctions/course-player-data/ (+ its test)\n\n### Acceptance criteria\n403 for users without org access to the course; contract tests updated; quiz-by-lesson parity.')"
gh issue create --label bug --title "Completion semantics: dashboard shows Completed 0 despite finished course" --body "$(printf '### Summary\nSweep 2026-06-06: dashboard shows Completed 0 despite 4/4 lessons + a passed quiz, and the course card still says Continue after Finish Course. Intentional (certificate pending?) or an enrollment-complete wiring gap — investigate and fix or document.\n\n### Files touched\nTBD by investigation: functions/enrollment-complete/ and/or src dashboard/courses pages\n\n### Acceptance criteria\nCompletion state is consistent across dashboard, course card, and player — or the intended semantics are documented and the UI matches them.')"
gh issue create --label bug --title "No course-review entry point in the learner flow (CourseReviewDialog unreachable?)" --body "$(printf '### Summary\nSweep 2026-06-06: Finish Course goes straight to the courses list with no rating prompt, and no review entry point exists anywhere in the learner flow — yet CourseReviewDialog was cut over in Slice 1. Dead UI path or unreached state; decide whether to surface or remove.\n\n### Files touched\nsrc/ (course player / courses pages, CourseReviewDialog wiring)\n\n### Acceptance criteria\nEither a reachable review flow exists (and is e2e-verified) or the dead path is removed; decision in WORKLOG.')"
gh issue create --label bug --title "profile-save success toast never appears (save works)" --body "$(printf '### Summary\nSweep 2026-06-06 (NF-2, low): profile-save success toast never appears (0/3 attempts) — the save persists correctly; language-change toasts appear reliably. Slice 4 polish.\n\n### Files touched\nsrc/pages/Settings.tsx\n\n### Acceptance criteria\nSuccessful profile save shows feedback.')"
gh issue create --label bug --title "Duplicate-report 409 swallowed by the UI (dialog stays open, no feedback)" --body "$(printf '### Summary\nSweep 2026-06-06 (NF-3, low): the server returns the correct 409 You have already reported this content body, but the Report dialog stays open with zero feedback. Slice 5 polish.\n\n### Files touched\nsrc/ (report dialog component / community-api error handling)\n\n### Acceptance criteria\n409 surfaces as user-visible feedback and the dialog resolves.')"
gh issue create --label bug,blocked --title "send-invitation-email 500s — RESEND_API_KEY/STATIC_ASSETS_BASE_URL unset" --body "$(printf '### Summary\nEndpoint 500s when invoked; needs the resend-api-key secret + two app settings (pre-cutover user action; do not print/rotate secrets — owner sets them).\n\n### Files touched\nNone (Azure app settings) — verify-only.\n\n### Acceptance criteria\nInvitation email sends in preview e2e.')"
gh issue create --label polish --title "Idea authors CAN delete their own submitted ideas — verify intent, reconcile docs" --body "$(printf '### Summary\nSweep 2026-06-06 (E8): idea authors can delete their own SUBMITTED ideas, but Slice 6s authz documentation said status transitions and deletes are admin-owned. Author-OR-admin is plausible — verify intended behavior against the original RLS policies and reconcile docs (or endpoint) either way.\n\n### Files touched\nfunctions/idea-delete/ docs/tests, or doc-only\n\n### Acceptance criteria\nBehavior and documentation agree; decision logged in WORKLOG.')"
gh issue create --label polish --title "Toasts: allow manual dismissal; auto-discard is too slow" --body "$(printf '### Summary\nHuman-logged 2026-06-06: toasts cannot be closed manually and linger too long. Add a close affordance and/or shorten the auto-dismiss.\n\n### Files touched\nsrc/ (toast/toaster component config)\n\n### Acceptance criteria\nToasts dismissible by click; sensible auto-dismiss duration.')"
```

- [ ] **Step 3: Hardening + CI + polish issues (8)**

```bash
gh issue create --label hardening --title "Generic 500 bodies (CWE-209): stop propagating err.message" --body "$(printf '### Summary\n500 responses propagate err.message suite-wide. Candidate ADR: generic 500 body + server-side context logging. Touches every functions handler — claim solo, no parallel slice work (file-scope overlap with everything in functions/).\n\n### Files touched\nfunctions/** (suite-wide), new ADR\n\n### Acceptance criteria\nADR accepted; no err.message in any 4xx/5xx body; tests updated.')"
gh issue create --label hardening --title "db.ts: replace ssl rejectUnauthorized:false with verify-full + Azure CA bundle" --body "$(printf '### Summary\nfunctions/shared/db.ts disables TLS verification. Move to verify-full with the Azure CA bundle.\n\n### Files touched\nfunctions/shared/db.ts\n\n### Acceptance criteria\nTLS verification on; all endpoints still connect (deploy + smoke).')"
gh issue create --label hardening --title "Amend ADR-0006: runtime is Node ~20, not 22" --body "$(printf '### Summary\nADR-0006 says Node.js 22 but live runtime is pinned ~20 (Node 22 worker gRPC crash, WORKLOG Slice 0). Amend via adr-kit supersede/amend flow — sequential approval rule applies.\n\n### Files touched\ndocs/adr/\n\n### Acceptance criteria\nADR matches deployed reality.')"
gh issue create --label hardening,blocked --title "Rotate Postgres admin password before prod cutover" --body "$(printf '### Summary\nExposed once in a terminal session; DB is a disposable sandbox until cutover, so rotation is pre-cutover gate, not urgent. Owner action — agents must not rotate/print secrets.\n\n### Files touched\nNone (Azure) \n\n### Acceptance criteria\nPassword rotated + DATABASE_URL app setting updated before prod cutover.')"
gh issue create --label ci --title "CI pipeline with test gates (frontend + e2e)" --body "$(printf '### Summary\nBuild a fuller CI/CD pipeline with test gates — would force tests for areas lacking them (frontend pages, e2e). Functions workflow already runs npm test --if-present; SWA workflow has no test step. (Emils idea, STATUS.html CI debt.)\n\n### Files touched\n.github/workflows/*\n\n### Acceptance criteria\nPRs run frontend tests + typecheck; merge blocked on red.')"
gh issue create --label ci,blocked --title "CI functions deploy blocked: GitHub ToS block on Azure/functions-action" --body "$(printf '### Summary\nDeploy job dies at action download since 2026-06-05 (external). Track: gh api repos/Azure/functions-action until the block lifts, then gh run rerun --failed and retire the manual func publish workaround.\n\n### Files touched\nNone until unblocked; possibly .github/workflows/main_func-ai-education-migration.yml\n\n### Acceptance criteria\nCI deploy green end-to-end.')"
gh issue create --label polish --title "Post-elevation queue: moderation cleanup + deferred admin-page test debt" --body "$(printf '### Summary\nRight after Martinh becomes platform admin (elevation: migration/azure/README.md): (1) dismiss the PW-SWEEP report record left on the seeded post (reason Other, description PW-SWEEP automated regression test report — please ignore/dismiss) from the moderation queue — doubles as the first real moderation-page test; (2) clear the deferred admin-page test debt: Slice 4 PlatformSettings/OrgSettings, Slice 5 moderation pages, Slice 6 org-admin kanban; (3) delete the pre-existing junk idea drafts (231321321321, ha23123321321) spotted by the sweep, if unwanted.\n\n### Files touched\nNone (manual preview testing) — findings may spawn issues.\n\n### Acceptance criteria\nAll three done; results logged in WORKLOG (Gate-4 closure for the deferred pages).')"
gh issue create --label polish --title "Cosmetic / test polish nits backlog (non-blocking)" --body "$(printf '### Summary\nApproved-non-blocking nits, collected: courses/profiles test-suite nits; !access?.ok style in quiz-by-lesson; report-update tests assert param membership not order; vi.hoisted superset mocks in comment suites; profile-update 200-{profile:null} theoretical race; usePlatformSettings silent outer catch. Slice 6 notes: idea-update happy-path asserts param membership not index order; idea-comments own-draft-non-member case unpinned (returns [] today); fetchIdeaComments legacy any[] return type; Courses.test.tsx keep-spinner case only pins initial render. Sweep NF-4/5/6: Radix a11y console errors (sidebar sheet + dialog missing DialogTitle/Description); post deletion uses native confirm() vs styled AlertDialogs elsewhere; Danish-mode i18n gaps (Elev at Test Org mixed strings, English-formatted dates) and avatar-initials inconsistency (MA vs MV).\n\n### Files touched\nVaries (tests, small style fixes)\n\n### Acceptance criteria\nEach nit fixed or explicitly wontfixed; batch-friendly.')"
```

- [ ] **Step 4: Verify**

Run: `gh issue list --limit 40` — Expected: 26 open issues (1 setup + 6 slice + 11 bug/polish-bug + 4 hardening + 2 ci + 2 polish) with correct labels.

---

### Task 13: Push, open the draft PR (with Martin's onboarding checklist)

- [ ] **Step 1: Push the branch**

```bash
git push -u origin emil/<n>-collab-setup
```

- [ ] **Step 2: Open the draft PR**

```bash
gh pr create --draft --base feature/lovable-migration --title "feat: two-person Claude Code collaboration system (#<n>)" --body "$(printf 'Closes #<n>. Implements docs/superpowers/specs/2026-06-06-two-person-claude-code-collaboration-design.md.\n\n## What this sets up\n- Committed Claude config: CLAUDE.md/AGENTS.md collaboration rules, .claude/rules (functions+frontend), skills (pickup/handoff/slice-workflow), shared settings.json + trunk-guard hook\n- Specs now tracked (cutover + collab design)\n- STATUS.html slimmed; actionable items moved to the issue board (26 issues seeded)\n- Issue template + labels\n\n## Martin — onboarding checklist (spec §7)\n1. Create the trunk-pr-only ruleset NOW that this PR is open (verbatim command: plan Task 11 Step 2 in docs/superpowers/plans/2026-06-06-two-person-collab-setup.md on this branch)\n2. Pull this branch; open Claude Code in the repo; accept the workspace trust prompt\n3. Approve the project .mcp.json (adr-kit) prompt + the project hook prompt when first triggered\n4. Get .env values from Emil via a secure channel (never git)\n5. gh auth status — confirm your push-rights account is active\n6. Enrich docs/tooling/adr-kit.md from your machines ref_adrkit_uvx_fix.md memory note (PR welcome)\n7. Review this PR — your review is the first cross-review of the new system\n')"
```

- [ ] **Step 3: Verify the guard hook in anger (manual, in the live session)**

In a Claude Code session AFTER this branch's settings are active, switch to the trunk and ask Claude to commit something trivial — Expected: the Bash call is blocked with the `guard-trunk.mjs` message. (The hook only loads from committed project settings once the session trusts it — first run prompts for approval; accept.)

---

### Task 14: Martin's review + merge + first deploy under the new rules

- [ ] **Step 1: Martin completes onboarding checklist items 1–6 (PR body)**
- [ ] **Step 2: Martin runs `/code-review` on the PR, reviews, approves**
- [ ] **Step 3: Merge the PR; both developers pull trunk; delete `emil/<n>-collab-setup`**
- [ ] **Step 4: No deploy needed (no `functions/` changes in this PR) — note that in a PR comment to model the announce convention**
- [ ] **Step 5: Append the WORKLOG entry for this setup (dated 2026-06-06: collaboration system implemented — one paragraph, matching existing entry style) and update STATUS.html's checkpoint line — ride a tiny follow-up commit on the next work branch, or include before merge if the PR is still open**

---

## Self-review (done at write time)

- **Spec coverage:** §3 topology → CLAUDE.md rules + pickup/handoff skills + guard hook + ruleset (Tasks 5,8,9,11). §4 ledger → Tasks 10,12 + STATUS slim (Task 9). §5 config → Tasks 6,7,8 + specs (Task 3) + adr-kit doc (Task 4). §6 guardrails → Tasks 5,6,11. §7 onboarding → Task 13 PR body. §9 order → Task sequence (ruleset after PR open ✓). §10 stale-claim rule → pickup skill step 5 ✓.
- **Deviations from spec (deliberate):** permission baseline hand-curated instead of `/fewer-permission-prompts`-derived (deterministic plan > transcript-dependent output; refine later). Existing cavemem hooks removed (stale skill reference, non-portable jq) — flagged to user during plan review.
- **Known constraints honored:** no Azure mutations; no secrets printed; `.githooks/pre-push` left dormant; slice-6 plan file excluded from all `git add` commands (explicit paths only, no `git add .` anywhere).
- **Placeholder scan:** clean — every file has full content; every command exact.
- **Consistency:** branch name `emil/collab-setup` consistent across Tasks 1,13,14; label set matches spec §4 and Task 12 usage; protected-branch list (`feature/lovable-migration`, `main`) consistent between hook and CLAUDE.md.
