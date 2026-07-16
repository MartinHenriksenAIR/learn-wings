---
name: pickup
description: Use at session start on learn-wings — reads the ledger, picks work from the board, creates the branch and draft PR.
---

# Pickup — start-of-session

1. **Read state:** `migration/STATUS.html` (checkpoint, quirks), then:
   - `gh issue list --state open` — the backlog
   - `gh pr list --state open` — what's already in flight
2. **Pick an issue** that isn't already in flight (no branch/draft PR working on it). Honor `Depends on:` references and the `blocked` label — AND a filled "Blocked by" field in the issue body (form-created issues may lack labels; the body is authoritative).
3. **Branch + draft PR:** (`<trunk>` = the `trunk` value in `.claude/collab.json` — the single source of truth for branch topology; read it, don't assume)
   - `git fetch origin && git switch -c <descriptive-slug> origin/<trunk>`
   - `gh pr create --draft --base <trunk> --title "<type>: <slug> (#<n>)" --body "Works on #<n>."`
4. **Parallel branches are fine** — use separate git worktrees (`git worktree add ../lw-<slug> <branch>` or `claude --worktree`; each needs its own `npm install` + `.env` copy).
