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
