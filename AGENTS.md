# learn-wings — Agent Instructions

Single source of truth for all coding agents. `CLAUDE.md` imports this file — edit HERE, never there.

## Session start
1. Run the `orient` skill (or `pickup`, which runs it first) for the current plain-English picture — where things stand + every open issue decoded. It reads the durable core `docs/orientation/CONTEXT.md`; `migration/STATUS.html` remains the deploy/checkpoint ledger.
2. Check claims: `gh issue list --state open` (backlog) + `gh pr list --state open` (draft PRs = active claims).
3. Starting work → invoke the `pickup` skill. Ending a session → `handoff`. Executing a slice → `slice-workflow`.

## Preferred development workflow
Default to **subagent-driven development** (`superpowers:subagent-driven-development` skill) for any task with more than a small surface — multi-file refactors, code-review fix sweeps, implementation plans with several discrete pieces, anything where the work decomposes into independent tasks with clear handoffs.

The pattern: extract tasks → dispatch one implementer subagent per task with full task text and scene-setting context → spec-compliance review → code-quality review → mark complete → next task. Sequential within a workstream (parallel implementers on overlapping files conflict). The controller (main session) preserves its own context for orchestration; each subagent gets a fresh, focused window.

This is also the right default for tasks that feel small but have multiple steps — the two-stage review catches drift cheaper than fixing post-merge. For genuinely tiny single-edit changes, do them inline; the skill itself signals when it doesn't apply.

## Collaboration rules (two developers + their agents)
- **Trunk = the `trunk` branch named in `.claude/collab.json`** (single source of truth — the guard hook and the pickup/handoff skills read it; cutover day edits that one file, see issue #33). The trunk receives changes ONLY via pull requests — guaranteed by the server-side `trunk-pr-only` ruleset; the local guard hook is best-effort fast feedback on top (its known gaps are documented in the hook header and all land on the server-side wall). PR #6 to `main` stays open until full cutover.
- **Work branches:** `<firstname>/<issue#>-<slug>` off fresh trunk (e.g. `emil/7-collab-setup`). Open a draft PR immediately — the draft PR is the claim.
- **Before claiming:** check the other developer's claimed issues / draft PRs for file-scope overlap ("Files touched" on the issue). Hub-file APPENDS (barrel imports, routes, i18n keys) don't block parallel work — rebase and keep both. Editing the SAME logic or changing shared-contract semantics (`functions/shared/*`, `src/lib/api-client.ts`, DB schema, `AGENTS.md`/`CLAUDE.md`, `.claude/*`) does — serialize, or land the contract change first as its own small PR. Full grading in the `pickup` skill.
- **Review:** cross-review when both developers are active; `/code-review` + self-merge allowed when solo. Rebase work branches on trunk when it moves.
- **Deploys: ONLY from fresh trunk after a merge** — never from work branches (one shared function app/DB/preview). Procedure in `slice-workflow`. Announce on the merged PR.
- **Bookkeeping:** merged PRs append a dated `migration/WORKLOG.md` entry (append-only) and update `migration/STATUS.html`'s checkpoint.

## Orientation layer
- **Stay oriented with `orient`** (run it anytime; `pickup` runs it at session start). It renders a plain-English digest (`docs/orientation/digest.html`, gitignored) from the durable core (`docs/orientation/CONTEXT.md`) + live issues/PRs — so you never decode the raw issue board by hand.
- **Human-summary header** on every issue, PR, and slice doc: lead with *In plain English* (one jargon-free sentence) + *Why it matters / who it affects*, ABOVE the technical detail. Templates enforce it (`.github/ISSUE_TEMPLATE/task.yml`, `.github/pull_request_template.md`). The digest lifts these headers — good headers = a sharper digest for free.
- **`core-sync`:** when your work obviously moves the core (close a tracked issue, make a structural decision, add a subsystem), update `docs/orientation/CONTEXT.md` in the same change. The full reconcile (auto-fix mechanical drift + propose judgment changes) runs at `handoff`; never silently rewrite judgment fields. See `.claude/skills/orient/core-sync.md`.

## Decisions
Active architecture decisions live in `docs/orientation/CONTEXT.md` (the `decisions` log) — read it before structural changes. The 12 original ADRs in `docs/adr/` are **archived history** (no longer maintained; the adr-kit tooling was removed 2026-06-06); new and amended decisions go in the core, not as new ADR files.

## Lovable Source Reference
Lovable workspace **AIR** (`Q7aTXTRh50LxV00N6SRQ`) holds the original project. **Read-only** — no mutating Lovable tools without explicit user instruction.

## Migration Safety Constraints (until migration completes)
- Application source changes follow the collaboration workflow above (work branch + PR) — no direct-to-trunk edits.
- Do not mutate Azure resources (no `az` create/delete/update) — deploys via the documented procedure only.
- Do not delete, rotate, overwrite, or print secrets.
- Do not apply patches from `migration/lovable-supabase-removal/patches/` to live source; planning artifacts only under `migration/lovable-supabase-removal/`.
