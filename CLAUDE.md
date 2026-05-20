# learn-wings — Claude Code Instructions

## First-Time Setup (run once after cloning)

```bash
git config core.hooksPath .githooks
```

This activates the pre-push hook in `.githooks/pre-push`. It checks session memory freshness, ADR gaps, and bug backlog before every push. Skip with `git push --no-verify` in emergencies.

## ADR Workflow

**AT SESSION START: tell the user** — if they report any adr-kit issues (MCP not connecting, YAML frontmatter corruption, `]approval_date` on wrong line), read `~/.claude/projects/-Users-thedawgctor-Desktop-tempfuk-learn-wings/memory/ref_adrkit_uvx_fix.md` and walk them through the `uvx` fix. Do not wait for them to ask.

**Always approve ADRs one at a time, sequentially.** Never call `adr_approve` in parallel.

Parallel MCP tool calls fire simultaneous permission prompts — only the first is clickable; the rest are auto-rejected by Claude Code's permission system. Sequential approval ensures each prompt is surfaced and confirmed.

```
# CORRECT — sequential
adr_approve(ADR-0001) → wait → adr_approve(ADR-0002) → wait → ...

# WRONG — parallel
adr_approve(ADR-0001) + adr_approve(ADR-0002) + ... (simultaneous)
```

This applies to all `mcp__adr-kit__adr_approve` calls regardless of batch size.

## Lovable Source Reference

Lovable workspace **AIR** (`Q7aTXTRh50LxV00N6SRQ`) contains the original learn-wings project.
**Read-only** — do not call `send_message`, `create_project`, `set_project_knowledge`, `add_connector`, or any mutating Lovable tool against this workspace without explicit user instruction.

## Migration Safety Constraints

This repo is mid-migration (Lovable/Supabase → Azure). The following constraints apply until migration is complete:

- Do not mutate application source code outside the `migration/` directory without explicit instruction
- Do not mutate Azure resources (no `az` create/delete/update commands)
- Do not delete, rotate, overwrite, or print secrets
- Do not apply patches from `migration/lovable-supabase-removal/patches/` to the live source
- Planning artifacts only under `migration/lovable-supabase-removal/`
