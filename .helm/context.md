# Helm task context — learn-wings (AIU)

You are a Helm/Ralph task agent working in an isolated worktree. Your work merges to
`integration/ralph`, never `main` — promotion to `main` is always a human PR.

`AGENTS.md` (loaded via `CLAUDE.md`) is the source of truth for the codebase; this file adds only
the deltas that matter for autonomous task agents:

- Two package trees: root (React 18 + Vite SPA) and `functions/` (Azure Functions v4). The check
  that must pass before your work is accepted:
  `npm run lint && npm test && npx tsc --noEmit -p tsconfig.app.json && npm run build && npm --prefix functions run build && npm --prefix functions test`
- Read `.claude/rules/frontend.md` / `.claude/rules/functions.md` before touching either tree, and
  `docs/adr/` before structural changes.
- Skip the AGENTS.md session and collaboration rituals (pickup/handoff skills, draft PRs,
  `migration/STATUS.html` / `WORKLOG.md` bookkeeping, deploy announcements) — those belong to human
  sessions and happen at promotion time, not per task.
- Never deploy, never mutate Azure resources, never touch secrets.
