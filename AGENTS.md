# learn-wings — Agent Instructions

Single source of truth for all coding agents. `CLAUDE.md` imports this file — edit HERE, never there.

## Session start
1. Read `migration/STATUS.html` — the live ledger (checkpoint, operational quirks, pointers).
2. Check claims: `gh issue list --state open` (backlog) + `gh pr list --state open` (draft PRs = active claims).
3. Starting work → invoke the `pickup` skill. Ending a session → `handoff`. Executing a slice → `slice-workflow`.

## Collaboration rules (two developers + their agents)
- **Trunk = the `trunk` branch named in `.claude/collab.json`** (single source of truth — the guard hook and the pickup/handoff skills read it; cutover day edits that one file, see issue #33). The trunk receives changes ONLY via pull requests — guaranteed by the server-side `trunk-pr-only` ruleset; the local guard hook is best-effort fast feedback on top (its known gaps are documented in the hook header and all land on the server-side wall). PR #6 to `main` stays open until full cutover.
- **Work branches:** `<firstname>/<issue#>-<slug>` off fresh trunk (e.g. `emil/7-collab-setup`). Open a draft PR immediately — the draft PR is the claim.
- **Before claiming:** check the other developer's claimed issues / draft PRs for file-scope overlap ("Files touched" on the issue). Hub-file APPENDS (barrel imports, routes, i18n keys) don't block parallel work — rebase and keep both. Editing the SAME logic or changing shared-contract semantics (`functions/shared/*`, `src/lib/api-client.ts`, DB schema, `AGENTS.md`/`CLAUDE.md`, `.claude/*`) does — serialize, or land the contract change first as its own small PR. Full grading in the `pickup` skill.
- **Review:** cross-review when both developers are active; `/code-review` + self-merge allowed when solo. Rebase work branches on trunk when it moves.
- **Deploys: ONLY from fresh trunk after a merge** — never from work branches (one shared function app/DB/preview). Procedure in `slice-workflow`. Announce on the merged PR.
- **Bookkeeping:** merged PRs append a dated `migration/WORKLOG.md` entry (append-only) and update `migration/STATUS.html`'s checkpoint.

## ADRs
`docs/adr/` holds the 12 architecture decision records — they define what is and isn't allowed; read them before structural changes. Plain markdown, edited by hand (the adr-kit tooling was removed 2026-06-06).

## Lovable Source Reference
Lovable workspace **AIR** (`Q7aTXTRh50LxV00N6SRQ`) holds the original project. **Read-only** — no mutating Lovable tools without explicit user instruction.

## Migration Safety Constraints (until migration completes)
- Application source changes follow the collaboration workflow above (work branch + PR) — no direct-to-trunk edits.
- Do not mutate Azure resources (no `az` create/delete/update) — deploys via the documented procedure only.
- Do not delete, rotate, overwrite, or print secrets.
- Do not apply patches from `migration/lovable-supabase-removal/patches/` to live source; planning artifacts only under `migration/lovable-supabase-removal/`.
