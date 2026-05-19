# learn-wings — Agent Instructions

## ADR Workflow

**Always approve ADRs one at a time, sequentially.** Never call `adr_approve` in parallel.

Parallel MCP tool calls fire simultaneous permission prompts — only the first is clickable; the rest are auto-rejected. Sequential approval ensures each prompt is surfaced and confirmed.

```
# CORRECT — sequential
adr_approve(ADR-0001) → wait for result → adr_approve(ADR-0002) → wait → ...

# WRONG — parallel
adr_approve(ADR-0001) + adr_approve(ADR-0002) + ... (simultaneous calls)
```

This applies to all `mcp__adr-kit__adr_approve` calls regardless of batch size.

## Lovable Source Reference

Lovable workspace **AIR** (`Q7aTXTRh50LxV00N6SRQ`) contains the original learn-wings project.
**Read-only** — no mutating Lovable tools (`send_message`, `create_project`, `set_project_knowledge`, `add_connector`) against this workspace without explicit user instruction.

## Migration Safety Constraints

This repo is mid-migration (Lovable/Supabase → Azure). Until migration is complete:

- Do not mutate application source code outside the `migration/` directory without explicit instruction
- Do not mutate Azure resources
- Do not delete, rotate, overwrite, or print secrets
- Do not apply patches from `migration/lovable-supabase-removal/patches/` to live source
- Planning artifacts only under `migration/lovable-supabase-removal/`
