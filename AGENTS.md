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
