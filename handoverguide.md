# Handover Guide: Spec-Driven Migration Workflow
## learn-wings — Lovable/Supabase to Azure Migration

**For:** Product owners and junior staff taking over product stewardship
**Covers:** The working discipline, decision trail, and review process used in the May 2026 migration session
**Branch:** `feature/lovable-migration`
**Session dates:** 2026-05-17 to 2026-05-19

---

## How to Use This Document

This is not a guide to the code. It is a guide to the process that produced the code. If you understand this process, you can safely steer an AI-assisted engineering team through a complex technical migration — even if you cannot read the code yourself.

Everything in this guide is grounded in evidence from the actual session. Where evidence is incomplete, that is stated explicitly.

---

## Table of Contents

1. [What happened in this session — the short version](#1-what-happened-in-this-session)
2. [Spec-driven development — what it is and how it was used](#2-spec-driven-development)
3. [The implementation seam — how old and new systems coexist safely](#3-the-implementation-seam)
4. [Session memory and token management](#4-session-memory-and-token-management)
5. [Differential review — checking that work matches intent](#5-differential-review)
6. [Multiple review layers — when one review is not enough](#6-multiple-review-layers)
7. [Failure modes discovered in this session](#7-failure-modes-discovered)
8. [How to run the next session](#8-how-to-run-the-next-session)
9. [Tooling setup — adr-kit and MCP configuration](#9-tooling-setup)
10. [What product owners must inspect before approving work](#10-what-product-owners-must-inspect)
11. [Red flags](#11-red-flags)
12. [Reusable checklist for future sessions](#12-reusable-checklist-for-future-sessions)
13. [Glossary](#13-glossary)
11. [Reusable checklist for future sessions](#11-reusable-checklist-for-future-sessions)
12. [Glossary](#12-glossary)

---

## 1. What Happened in This Session

The learn-wings LMS platform was originally built in Lovable, a visual AI app builder that hosted the backend on Supabase (a third-party cloud service). The migration goal was to move everything to Azure — Microsoft's cloud — so the team controls every part of the infrastructure.

**The problem being solved:** Supabase Auth, Supabase PostgreSQL, and 10 server-side functions all needed to be replaced with Azure equivalents. Every single user login, file upload, quiz grade, and certificate generation touched Supabase. Replacing it incorrectly could break the product for all users overnight.

**What the session accomplished (in order):**

| Phase | What was done |
|-------|--------------|
| Discovery | Full inventory of every Supabase dependency — 10 functions, 42 database migration files, 190 lines of access-control logic, 12 frontend integration points |
| Planning | A written spec with all 10 open questions and a 25-task implementation plan |
| Azure verification | Queries against live Azure infrastructure to resolve all 10 questions before touching code |
| ADR setup | 11 architectural decisions recorded in a machine-readable format (ADRs) |
| Early implementation | Tasks 1–8 completed: Lovable removed, CI/CD fixed, functions directory scaffolded, three shared utilities built and tested |

**What was not done:** No application logic has been replaced yet. The Supabase system still runs in production. The Azure system is being built alongside it. No users were affected.

---

## 2. Spec-Driven Development

### What it means

Spec-driven development means writing down precisely what you are going to build — and why — before writing code. The specification is not a high-level wish list. It is a contract: here is what done looks like, here is the acceptance criteria, here is what is forbidden.

In practice, this session used three artifact types as the specification:

**1. The migration spec** (`migration/lovable-supabase-removal/`)
This directory contains the written plan for removing Supabase. It was written before any code was changed. It identifies every dependency, lists the risks, names every file that will change, and defines what the final state looks like. The executive summary is at `migration/lovable-supabase-removal/00-executive-summary.md`.

**2. The open questions file** (`migration/lovable-supabase-removal/10-open-questions.md`)
Before implementation began, 10 questions were written down — things the team needed to decide before it was safe to start. Each question had a "why it matters" explanation and a "safest next step." All 10 were resolved by querying live Azure infrastructure and the Lovable source before a single line of application code was changed. This is deliberate: you do not start building until you have answered the questions that could invalidate your plan.

**3. The 25-task implementation plan** (`docs/superpowers/plans/2026-05-17-lovable-supabase-migration.md`)
This plan breaks the entire migration into 25 tasks. Each task specifies: which files change, what the test verifies, what the commit message should be, and what "done" looks like. Tasks are organized into phases (0 through 7) with explicit dependencies. You cannot start Phase 2 until Phase 1 is complete, because Phase 2 depends on decisions that Phase 1 makes.

### How tasks were gated and committed

Each task in the plan follows this pattern:

1. Write a failing test that will pass only when the task is complete
2. Implement the change
3. Verify the test passes
4. Commit with a specific message (the plan names the exact commit message)

This pattern is called test-driven development (TDD). The key insight is that the test is written *before* the code. If you write the test after the code, you are verifying what you built, not what was required. Writing the test first forces you to specify the requirement precisely.

Example from the session — Task 5 (CORS helper):
- The test was written first: it checked that a known origin is allowed through, an unknown origin is blocked, and null is handled gracefully
- Only then was `functions/shared/cors.ts` written to pass those tests
- Commit: `feat(functions/shared): add CORS helper with ai-uddannelse.dk allowlist`

### How the Superpowers skills were involved

The implementation plan file (`docs/superpowers/plans/2026-05-17-lovable-supabase-migration.md`) was authored using the `superpowers:writing-plans` methodology and references `superpowers:subagent-driven-development` as the recommended execution method. The plan structure — phases, gated tasks, checkbox steps, explicit commit messages — reflects the Superpowers planning discipline.

*What this means for you:* When you commission a new AI-assisted session to continue implementation, you should instruct the agent to read the plan file and execute tasks in order, one at a time, committing after each task. The plan tells the agent what to do; it does not need to re-invent the structure.

### How ADRs preserve intent

An ADR (Architectural Decision Record) is a short document that records a single technical decision: what was decided, why, what alternatives were rejected, and what the consequences are. Once approved, an ADR is law for the project — code that contradicts it fails review.

In this session, 11 ADRs were created (see `docs/adr/`). Each decision that could have been made differently was captured as an ADR. Examples:

- **ADR-0005:** Use multi-tenant Microsoft Entra ID, not Azure AD B2C, not custom passwords. Why? External organizations need to sign in without per-tenant configuration. Entra ID handles this natively.
- **ADR-0010:** Never commit `.env` files or secrets to git. Why? This was a real security issue — a `.env` file was committed by the Lovable platform on 2026-01-27 and tracked for four months before detection. The ADR turned a lesson from a security incident into a permanent rule.
- **ADR-0011:** In SAS token generation, URL encoding is the caller's responsibility, not the library's. Why? Encoding inside the library creates a "double encoding" bug if callers also encode. Current callers use UUID-based filenames (always safe), so the rule is documented rather than forced.

Each ADR answers the question: "When someone asks 'why is it done this way?', where is the answer?" The answer is in the ADR.

---

## 3. The Implementation Seam

### What an implementation seam is

An implementation seam (sometimes called a **strangler fig** boundary) is a boundary in the code where old behavior and new behavior can be swapped without either knowing about the other. You build the new system to be complete at the seam, then move the seam, then remove the old system.

The name "strangler fig" comes from a tree that grows around an existing tree, eventually replacing it completely. The original tree is not cut down at the start — it continues to function while the replacement grows. Only after the replacement is complete is the original removed.

### How this session applied the pattern

The session kept the entire `supabase/` directory intact. Every Supabase Edge Function (10 functions, still in production) is untouched. The Azure Functions are being built in a new `functions/` directory alongside the Supabase directory. The plan defers deletion of `supabase/` to Phase 7 — the last phase, after production cutover is verified.

This is the strangler fig pattern in operation:

```
Current state (safe to run):
  frontend → supabase/ (10 functions, live)
             functions/ (being built, not wired in yet)

Future state (after cutover):
  frontend → functions/ (10 replacement functions, live)
  supabase/ (deleted)
```

No user is affected during the build phase because the new system is not wired in until it is complete.

### The adapter layer

The shared utilities in `functions/shared/` are the **adapter layer** — they translate between the old behavior (Deno/Supabase patterns) and the new behavior (Node.js/Azure patterns) without changing what the functions do.

Concrete example: The Supabase Edge Functions used the Deno `Web Crypto API` to generate Azure Blob SAS tokens. Azure Functions use Node.js, which does not have the Deno API. The file `functions/shared/sas.ts` ports the exact same HMAC-SHA256 algorithm to Node.js `node:crypto`. The output is identical — a valid Azure SAS token. Only the runtime changed; the behavior did not. This is a **surgical refactor**: change the minimum required to make the code run in the new environment, do not change what it does.

### The compatibility boundary

The planned `src/lib/api-client.ts` file (not yet built) will be the **compatibility boundary** — a single place in the frontend that replaces all 12 calls to Supabase Edge Functions with calls to Azure Functions. Every component in the frontend calls this one file; none of them need to know which backend they are talking to. This is also called an **adapter layer** — it presents the same interface to consumers while the implementation behind it changes.

This minimizes **change surface area** — the amount of code that needs to change when you swap the backend. Instead of changing 12 different components, you change one file.

### Least changes needed — minimizing blast radius

The phrase "least changes needed" in this context means: do not change anything that does not need to change to achieve the goal. Every additional change is additional **blast radius** — potential for new bugs, regressions, and unexpected behavior.

Examples from this session:

- **Auth identity:** Rather than rewriting all existing `profiles.id` UUIDs (which would require updating dozens of foreign keys), the decision was to add two new columns (`entra_oid`, `entra_tid`) to the existing profiles table. Old IDs are not touched. This is the smallest coherent change that adds Entra ID support without breaking existing data relationships.

- **Database access control (RLS):** Supabase used Row Level Security (RLS) — database-level access control that runs for every query. Azure PostgreSQL can also run RLS, but the plan removes all 190 lines of Supabase-specific RLS rather than rewriting it. The replacement access control is moved to the Azure Functions application layer (where each function checks authorization before querying). This is a behavioral change, but it is an intentional, planned change — not collateral damage.

- **CORS:** The Supabase functions had Lovable domains in their CORS allowlists. Rather than auditing and fixing each function, the `functions/shared/cors.ts` adapter sets the correct domain (`ai-uddannelse.dk`) once, and all 10 replacement functions import it. One change, 10 beneficiaries.

---

## 4. Session Memory and Token Management

### Why session memory matters

An AI agent (Claude) has a context window — a limit on how much text it can read and reason about at once. A complex migration session accumulates enormous amounts of context: code, decisions, errors, test output, open questions. If that context is not managed carefully, two things happen:

1. The session runs out of space and the agent loses track of earlier decisions
2. Future sessions start from scratch, re-discovering things the previous session already found

The solution is to move information that must survive between sessions into durable files, and remove from the context window information that is only needed in the current session.

### What belongs in durable project memory

In this session, durable memory is maintained through four mechanisms:

**WORKLOG.md** (`migration/WORKLOG.md`)
A chronological log of every significant action, decision, and finding, written as each phase completed. This file is the "what happened and why" record for any future session. If you start a new session and want to understand where you are, read WORKLOG.md first.

**Open questions file** (`migration/lovable-supabase-removal/10-open-questions.md`)
Resolved and updated as each question was answered. Future sessions do not need to re-discover these findings.

**ADRs** (`docs/adr/`)
Every accepted ADR is permanent memory. Future sessions are constrained by them. An agent that contradicts an ADR should be stopped and asked to explain the contradiction.

**Git commit history**
Every task in the plan produces a commit with a specific, descriptive message. The git log is a timestamped record of what was built, in what order. Running `git log --oneline feature/lovable-migration` shows the full progression.

### What belongs only in the current session

- Error messages from specific tool calls
- Intermediate reasoning ("I'm considering X vs Y")
- Azure CLI output from diagnostic queries (summarized in WORKLOG.md; the raw output is not preserved)
- Partial implementations before they are committed

### The Caveman skill — memory compression

The `caveman:caveman-compress` skill is available in this project. It compresses verbose natural-language memory files (like CLAUDE.md) into a compact format that preserves all technical substance while using fewer tokens. This is relevant when CLAUDE.md or WORKLOG.md grow large enough to strain the context window.

*Note: Caveman compression artifacts (`.original.md` files) are not present in the repository as of this writing. The methodology is available but was not exercised in this session. The session instead relied on the WORKLOG, ADRs, and git commits as its memory infrastructure — which is the correct baseline approach.*

### How the memory layers work together

```
Durable (survives sessions):
  WORKLOG.md          → What happened, what was decided, what is next
  10-open-questions.md → All findings and decisions, indexed by question
  ADRs (docs/adr/)    → Locked architectural decisions with rationales
  git log             → Timestamped record of every change

Session-only:
  Tool call outputs   → Summarized into WORKLOG at end of phase
  Reasoning traces    → Not preserved (not needed after decision is made)
  Error details       → Captured in ADRs if they produce a rule (e.g., ADR-0010)
```

---

## 5. Differential Review

### What it is

A differential review is a structured comparison between what was planned and what was actually built. It asks: does the current implementation match the spec? Does it match the ADRs? Are there new risks that were not in the original plan?

The word "differential" means you are looking at the *difference* between two states — the intent and the implementation — not just inspecting the code in isolation.

### Why every plan-level change should trigger one

If a task in the plan is changed, skipped, or expanded beyond its original scope, a differential review catches it before it becomes a problem. Without this review:

- A decision made in Phase 0 might be silently contradicted in Phase 3
- A security constraint might be correctly documented in an ADR but incorrectly implemented in code
- The product owner might approve work that technically passes tests but deviates from the agreed architecture

### How to perform a differential review

Compare the current state against each of these reference points:

**Against the original migration plan:**
Open `docs/superpowers/plans/2026-05-17-lovable-supabase-migration.md`. Check: Are the completed tasks checkboxed? Is any checkbox marked complete when the corresponding commit is not in `git log`? Is any code present that does not correspond to a planned task?

**Against the ADRs:**
Open each ADR in `docs/adr/`. Each ADR has a `policy` section listing disallowed imports or patterns. If the code imports something on the `disallow` list, the ADR is being violated. You do not need to read the code deeply — you can search for the disallowed import name.

**Against the latest committed diff:**
Run `git diff main...feature/lovable-migration` (or ask an agent to run it) to see everything that has changed on this branch. Compare the diff against the task list. Every change should trace back to a specific task.

**Against the task checklist:**
Find the task in the plan. Are all steps in that task checked? Is the commit message correct? If a step was skipped because it was already done or unnecessary, is that documented?

### What product owners can review without reading code

You do not need to read TypeScript to perform a meaningful review. What you can inspect:

- The commit message names the task. Does it match the plan?
- The ADR for a given technology area was approved by you. Does the code still match the decision?
- The open-questions file lists all findings. Were they applied? (Check: is the decision documented in both the ADR and the implementation plan?)
- The WORKLOG records what was done in each phase. Does the WORKLOG entry say the task is done? Is the commit present?

This is reviewing **intent, scope, and alignment** — which is the product owner's job. The engineering review (correctness, security, performance) is a separate layer.

---

## 6. Multiple Review Layers

### Why one review is not enough

A single review catches some things and misses others. Different review lenses have different blind spots:

- A plan review checks whether the work is the right work
- A code review checks whether the code correctly implements the plan
- A security review checks whether the code introduces security vulnerabilities
- An architecture review checks whether the code is consistent with the ADRs and overall system design

For security-sensitive or architecture-shaping changes, multiple review layers are required. A change that passes a plan review and a code review can still introduce a vulnerability that only a security review would catch.

### The review skills used in this project

**Superpowers: `superpowers:requesting-code-review`**
Used after completing a phase or a significant task. Checks: Does the implementation match the plan? Are the acceptance criteria met? Are there obvious gaps or contradictions? This is the general-purpose review gate.

**Anthropic built-in review (advisor tool)**
The `advisor` tool (available in Claude Code sessions) forwards the full conversation history to a stronger model for review. It is used before committing to an approach and before declaring work complete. This session used it at several decision points — the auth provider decision (Q1) and the implementation seam design. The advisor review found the sequential ADR approval constraint and the compatibility boundary design.

**Differential security review (Trail of Bits `differential-review` skill)**
This is a security-focused review that compares changed code against the previous state and looks for security regressions. In this session, this review identified the `.env` file that had been tracked in git since 2026-01-27 — a high-severity finding that produced ADR-0010. The ADR records the finding explicitly: "HIGH severity finding from differential security review 2026-05-19 (F-01)."

*Note: ADR-0010 references a "differential security review 2026-05-19 (F-01)" but the session history does not contain a transcript confirming which specific skill or tool produced this output. The finding and its consequence (ADR-0010, git untracking of .env in commit `8c292bb`) are confirmed. The specific tool invocation is not verified from session history.*

### When to use each

| Situation | Review to use |
|-----------|--------------|
| Before starting a new phase | Advisor (full history review) |
| After completing a task | Superpowers code review |
| Before cutover to production | All three |
| Any change touching secrets, auth, or access control | Differential security review (required) |
| A plan change that contradicts an ADR | Advisor (flag the contradiction explicitly) |
| A new ADR is proposed | Superpowers code review + advisor |

### The principle for product owners

For any change that touches authentication, authorization, secrets, or database access control: require at least two review layers before approving. These are the areas where a mistake is hardest to detect and most damaging in production.

---

## 7. Failure Modes Discovered

These are not hypothetical risks. They are things that actually went wrong in this session and the lessons they produced.

### Failure 1: adr-kit YAML corruption from `adr_approve`

**What happened:** After approving the first batch of ADRs (ADR-0001 through ADR-0009) using the `adr_approve` MCP tool, the YAML frontmatter in each ADR file was corrupted. The `approval_date` field was concatenated onto the same line as the closing bracket of the previous field instead of on a new line. This caused the adr-kit tools to fail to parse the ADRs.

**Evidence:** Commit `a5f316e` (`fix(adr): repair YAML frontmatter in all 9 ADRs`) and commit `6896abc` (`fix(adr): repair YAML corruption in ADR-0010 and ADR-0011 from adr_approve bug`) confirm this was a recurring bug in the tool.

**Lesson:** Tool output should be verified, not trusted. After using `adr_approve`, always open the ADR file and verify the YAML is valid. A broken YAML header silently disables the machine-readable policy enforcement that makes ADRs useful.

**Lesson for product owners:** If an agent says "I approved 9 ADRs," that is not done until you can verify the files are readable. Ask to see the YAML of at least one ADR to confirm the tool worked correctly.

### Failure 2: adr-kit schema bug preventing `adr_approve`

**What happened:** The adr-kit MCP server (`solution8-com/AIRStack-ADRKit v0.2.7`) had a schema bug that prevented `adr_approve` from running at all. The agent had to manually install the schema from GitHub as a workaround. The session also filed bug reports (GitHub issues #23 and #24) and a pull request (#1) upstream to fix the root cause.

**Evidence:** WORKLOG Phase 2 documents this explicitly.

**Lesson:** When a third-party tool fails, the session should not be blocked. The correct response is: find and apply a manual workaround, document the workaround, and report the bug upstream. The session did all three.

**Lesson for product owners:** If an agent says it cannot perform a step because a tool is broken, it should propose a workaround and a bug report. If it simply stops and says "tool broken," that is a failure of execution discipline. Expect the agent to find a path forward.

### Failure 3: Parallel ADR approval deadlock

**What happened:** Claude Code's permission system only allows one permission prompt to be active at a time. If an agent fires multiple `adr_approve` calls simultaneously (in parallel), only the first prompt is clickable. The rest are auto-rejected silently. This means the remaining ADRs appear to fail for no obvious reason.

**Evidence:** This constraint is documented in both `CLAUDE.md` and `AGENTS.md` as a permanent rule: "Always approve ADRs one at a time, sequentially. Never call `adr_approve` in parallel."

**Lesson:** This is a fundamental constraint of the Claude Code permission system, not a bug in adr-kit. The rule must be in the agent instructions file (`CLAUDE.md`) so every future session is bound by it from the start.

**Process lesson:** Any tool that requires a user permission prompt must be called one at a time. Before introducing a new tool that requires permissions, add its sequential-call constraint to `CLAUDE.md` before the first session that uses it. Discovering this constraint mid-session costs time and creates uncertainty about which approvals actually succeeded.

### Failure 3b: Subagent approval deadlock — `adr_approve` must stay in the main thread

**What happened:** Even when ADR approvals are called sequentially (one at a time), there is a second failure mode: if a subagent or parallel agent is dispatched to perform the approval, the permission prompt does not surface in the main session. The subagent runs in a separate execution context that does not own the permission stream. The approval silently fails because the user never sees the prompt. The subagent may report success or simply hang — neither is reliable.

**Evidence:** This constraint is documented in `CLAUDE.md` and `AGENTS.md` as a corollary to the sequential approval rule. The rule states "Always approve ADRs one at a time, sequentially" — the "main thread" requirement is the reason this rule exists. Not verified from session history that a subagent deadlock incident occurred; the rule was codified to prevent it.

**Lesson:** The fix for Failure 3 (parallel calls) does not fix this. Sequential calls from a subagent still deadlock. The correct rule is: all `adr_approve` calls run in the main agent session, never delegated to a subagent, parallel agent, or background task.

**Process lesson:** When the `superpowers:dispatching-parallel-agents` or similar parallel execution skills are used, ADR approvals must be explicitly excluded from the tasks dispatched to subagents. List `adr_approve` as a main-thread-only operation in the task plan before dispatching.

### Failure 4: `.env` tracked in git for four months

**What happened:** A `.env` file containing Supabase credentials was committed to git by the Lovable platform bot on 2026-01-27 (commit `43a079e`). It was tracked for approximately four months before detection via a differential security review on 2026-05-19.

**Evidence:** ADR-0010 documents the full timeline and remediation. Commit `8c292bb` (`security: untrack .env, add to .gitignore`) is the immediate fix.

**Lesson:** A `.env` file in git is not immediately obvious — it is a normal-looking file that only becomes dangerous when its contents are examined. Automated detection (the security review) caught what manual inspection missed for months. This is why periodic security reviews are not optional.

**Process lesson for product owners:** Any time there is a human-readable `.env` or similar file in a repository, ask the agent to run `git log --follow .env` to check whether it was ever committed. If it was, treat it as a potential credential exposure and rotate the affected secrets.

### Failure 5: `.mcp.json` agent hard-block

**What happened:** The agent was unable to create the `.mcp.json` file (which configures the adr-kit MCP server) because Claude Code security constraints prevent agents from writing JSON files that configure MCP servers. The user had to create this file manually.

**Evidence:** WORKLOG Phase 2: "User created `.mcp.json` manually (agent hard-blocked from writing this file — Claude Code security constraint)."

**Lesson:** Some infrastructure setup steps require human action. An agent that cannot complete a step should clearly name the action required and wait. It should not attempt workarounds that touch security-sensitive configuration files.

**Process lesson for product owners:** When setting up a new session with new tools, expect at least one "human action required" step for configuration files. Build this into your time estimate.

---

## 8. How to Run the Next Session

The next session picks up at Task 9 of the implementation plan (`docs/superpowers/plans/2026-05-17-lovable-supabase-migration.md`). Tasks 1–8 are complete. Tasks 9 onward build the Azure Function handlers and the frontend replacement layer.

### Before starting the session

Complete these two user actions that are blocking cutover (not blocking implementation):

1. **Add Key Vault secrets:** `database-url` and `resend-api-key` must be added to the `ai-education-migration` Key Vault before the functions can be deployed and tested against real Azure services. Instructions are in `migration/lovable-supabase-removal/10-open-questions.md`, Q3.

2. **Link custom domain:** `ai-uddannelse.dk` must be linked to the Static Web App in Azure Portal. Instructions are in `10-open-questions.md`, Q7. This is required before users can log in via Entra ID (the redirect URI must match the custom domain).

### Starting the session with an agent

Give the agent this orientation sequence:

```
1. Read migration/WORKLOG.md                                    — current state
2. Read migration/lovable-supabase-removal/10-open-questions.md — all decisions
3. Read docs/adr/ (all 11 ADRs)                                — architectural law
4. Read docs/superpowers/plans/2026-05-17-lovable-supabase-migration.md — task plan
5. Read CLAUDE.md                                               — agent constraints
6. Begin at Task 9 of the plan, one task at a time
```

### Session discipline

- One task at a time. Commit after each task with the exact commit message named in the plan.
- Tests pass before committing. No partial implementations.
- ADR violations stop the task. If a task requires an import on an ADR's `disallow` list, create a new ADR before proceeding, not after.
- No Azure resource mutations without explicit instruction. The constraint in `CLAUDE.md` is active until migration is complete.
- ADR approvals are sequential (see CLAUDE.md rule). Never approve more than one at a time.

### After the session

Update WORKLOG.md with what was completed and what is next. This takes 10 minutes and saves hours in the next session.

---

## 9. Tooling Setup

This section documents every tool configured in this project, how to install it on a fresh machine, and the known issues discovered in this session. Follow these instructions exactly — several of the issues described below are not documented anywhere else.

---

### 9.1 adr-kit — Architectural Decision Record Management

**What it does:** adr-kit is the tool that creates, approves, and queries ADR files. It runs as an MCP server so the AI agent can call it directly from a session. The ADR files live in `docs/adr/`.

**Package:** `solution8-com/AIRStack-ADRKit` v0.2.7 (a fork of `kschlt/adr-kit` with bug fixes applied during this session)

**Installation (macOS with uv):**

```bash
# Install uv if not already installed
curl -LsSf https://astral.sh/uv/install.sh | sh

# Install adr-kit as a global tool
uv tool install adr-kit

# Verify
adr-kit --help
```

The binary is installed at `~/.local/bin/adr-kit` (symlinked from `~/.local/share/uv/tools/adr-kit/bin/adr-kit`).

**MCP configuration — the file that matters:**

Claude Code reads `.mcp.json` at the project root to load MCP servers. You must create this file manually — the agent cannot write it (Claude Code security constraint prevents agents from modifying MCP server configuration files).

Create `/path/to/learn-wings/.mcp.json` with this exact content (update the path to match your machine):

```json
{
  "mcpServers": {
    "adr-kit": {
      "command": "/Users/YOUR_USERNAME/.local/bin/adr-kit",
      "args": ["mcp-server"]
    }
  }
}
```

Replace `YOUR_USERNAME` with your macOS username. The path must point to the adr-kit binary installed by `uv tool install`.

**Do not use `.claude-mcp-config.json`** — this is the old filename that older versions of adr-kit documentation specified. Claude Code does not read it. The correct filename is `.mcp.json`. The file `.claude-mcp-config.json` exists in this repo as an artifact of the session but is not read by Claude Code.

**Verifying MCP is loaded:**

After creating `.mcp.json`, start a Claude Code session in the project directory. Run:

```
/mcp
```

You should see `adr-kit` listed as a connected MCP server. If it shows as disconnected or missing, check the path in `.mcp.json`.

**adr-kit project initialization:**

The project is already initialized (ADR directory exists at `docs/adr/`, 11 ADRs present). You do not need to run `adr-kit init` again. If you ever need to reinitialize on a fresh clone:

```bash
adr-kit init --adr-dir docs/adr
```

---

#### Known issues with adr-kit (as of v0.2.7)

These are bugs encountered in this session. Bug reports and a fix PR were submitted upstream.

**Issue 1: `adr_approve` causes YAML corruption**

The `adr_approve` MCP tool writes the `approval_date` field on the same line as the closing bracket of the preceding `rationales` list, producing invalid YAML like:

```yaml
  rationales: ['Secret committed  ...  all production credentials']approval_date: 2026-05-19
```

Instead of:

```yaml
  rationales: ['Secret committed  ...  all production credentials']
approval_date: 2026-05-19
```

**What happens:** The ADR file is written but the YAML is unparseable. adr-kit tools that read ADR metadata (like `adr_query_related`) silently fail or return incorrect results.

**How to detect it:** After every `adr_approve` call, open the ADR file and check the YAML frontmatter. Look for `]approval_date` on a single line — that is the corruption pattern.

**How to fix it:** Manually edit the ADR file and insert a newline before `approval_date:`. The fix applied in this session is visible in commits `a5f316e` and `6896abc`.

**Automated check:** Ask the agent to run:
```bash
grep -n "]approval_date" docs/adr/*.md
```
Any output means a corrupted ADR needs manual repair.

---

**Issue 2: `adr_approve` schema bug (may be fixed in later versions)**

In v0.2.7, the `adr_approve` tool may fail to run at all due to a schema resolution bug. The workaround applied in this session was to manually install the corrected schema from the GitHub repository. This is tracked in GitHub issues #23 and #24 on `kschlt/adr-kit` and was fixed in a PR to `solution8-com/AIRStack-ADRKit`.

**What to do if `adr_approve` fails with a schema error:**

1. Check whether a newer version of adr-kit is available: `uv tool upgrade adr-kit`
2. If still failing, check the GitHub issues for a manual workaround
3. Document the workaround in `migration/WORKLOG.md` before proceeding

---

**Issue 3: `adr-index.json` validation errors for ADR-0010 and ADR-0011**

As of the pre-implementation checkpoint, `docs/adr/adr-index.json` reports parse errors for ADR-0010 and ADR-0011. This is a residual effect of the YAML corruption bug (Issue 1). The actual ADR markdown files were repaired (commit `6896abc`), but the index was generated before the repair and has not been regenerated.

**How to regenerate the index:**

```bash
# In a Claude Code session with adr-kit MCP loaded:
# Ask the agent to run adr_index tool to regenerate

# Or manually check that the repair took by reading the files:
grep "approval_date" docs/adr/ADR-0010*.md
grep "approval_date" docs/adr/ADR-0011*.md
```

If the files are clean (approval_date on its own line), the index errors are stale and the ADRs are functionally correct.

---

#### ADR approval workflow (required reading)

Because of the permission prompt constraints in Claude Code, ADR approvals must follow a specific protocol. This is documented in `CLAUDE.md` and `AGENTS.md` but is repeated here because it caused two failure modes in this session.

**Rules:**
1. Approve one ADR at a time. Wait for confirmation before calling `adr_approve` again.
2. All `adr_approve` calls run in the main Claude Code session. Never dispatch them to a subagent.
3. After each approval, verify the YAML in the resulting file is valid.

**What the approval prompt looks like:** When `adr_approve` is called, Claude Code shows a permission prompt asking whether to allow the MCP tool call. Click "Allow" (or "Allow for session"). If you see a prompt flash and disappear, it was probably auto-rejected — check the ADR file to confirm the approval was written.

---

### 9.2 Azure MCP Server

**What it does:** The Azure MCP server gives the AI agent access to Azure CLI-equivalent tools: list subscriptions, query resources, check Key Vault secrets (names only), inspect Static Web App settings, etc. It is what made the Phase 1 open-question resolution possible without leaving the Claude Code session.

**Installation:** The Azure MCP server is pre-installed as part of the Claude Code MCP extension bundle. No separate installation is needed.

**Configuration:** No project-level configuration file is needed. The agent calls Azure MCP tools directly and Azure CLI credentials (logged in via `az login`) are used automatically.

**Prerequisite:** You must be logged into the Azure CLI on the machine where you run Claude Code:

```bash
az login
az account set --subscription <your-subscription-id>
```

**Migration safety constraint:** The `CLAUDE.md` constraint prohibits Azure mutations (`az create`, `az update`, `az delete`) without explicit user instruction. The Azure MCP server read-only tools (listing resources, reading settings) are permitted automatically. Write operations require explicit approval.

---

### 9.3 Lovable MCP Server

**What it does:** The Lovable MCP server provides read access to the Lovable workspace that contains the original learn-wings project. It was used in this session to query the `profiles` table (Q8: how many users exist?) and to confirm the Supabase project is Lovable-managed (Q9).

**Configuration:** The Lovable MCP server is pre-installed. The AIR workspace ID is `Q7aTXTRh50LxV00N6SRQ`.

**Critical constraint:** The Lovable workspace is read-only for this project. Do not call `send_message`, `create_project`, `set_project_knowledge`, `add_connector`, or any mutating Lovable tool against the AIR workspace without explicit user instruction. Mutating it could damage the production Supabase backend that users are still on.

---

### 9.4 Claude Code Superpowers Skills

**What they are:** Superpowers skills are pre-built AI agent workflows accessible via the Skill tool in Claude Code. They provide structured, proven approaches to common tasks.

**Skills used in this project:**

| Skill | Purpose |
|-------|---------|
| `superpowers:writing-plans` | Used to author the 25-task implementation plan with proper task structure, TDD steps, and phase dependencies |
| `superpowers:subagent-driven-development` | Recommended execution method for the plan — each task runs in sequence with review checkpoints |
| `superpowers:requesting-code-review` | Run after completing a task or phase to verify alignment with spec and ADRs |
| `superpowers:brainstorming` | Used before major architecture decisions to explore alternatives |
| `differential-review` | Security-focused review of changed code — identified the `.env` git tracking issue |

**How to invoke a skill:** In a Claude Code session, type `/skill-name` or ask the agent to use the skill by name. The agent invokes it using the `Skill` tool.

---

### 9.5 Project configuration files summary

| File | Purpose | Created by |
|------|---------|-----------|
| `.mcp.json` | Registers adr-kit as an MCP server | Created manually by user (agent cannot write it) |
| `.claude-mcp-config.json` | Old filename — not read by Claude Code | Artifact from session, safe to ignore |
| `CLAUDE.md` | Agent constraints for this repo | Created by agent, committed to git |
| `AGENTS.md` | Identical constraints, alternate filename | Created by agent, committed to git |
| `.eslintrc.adrs.json` | ADR-generated ESLint config (currently empty) | Generated by adr-kit |
| `docs/adr/adr-index.json` | ADR machine-readable index | Generated by adr-kit; may contain stale errors (see Issue 3 above) |

---

## 10. What Product Owners Must Inspect Before Approving Work

You do not need to read code to perform a meaningful product owner review. Here is what to inspect and where to find it.

### Inspect 1: The task is in the plan

Open `docs/superpowers/plans/2026-05-17-lovable-supabase-migration.md`. Find the task that was just completed. Verify:
- The task exists in the plan (it was not invented by the agent)
- The checkbox is marked complete
- The step descriptions match what the agent described doing

**Red flag:** The agent describes doing something that is not in any task in the plan.

### Inspect 2: The commit message matches the plan

Run `git log --oneline feature/lovable-migration` (or ask the agent to run it). The most recent commit message should match the message specified in the task. Every task in the plan names the exact commit message.

**Red flag:** The commit message is generic ("fix things", "update code") rather than task-specific.

### Inspect 3: No ADR is violated

Each ADR has a `disallow` list. For any new file added, ask: does this file import anything from a `disallow` list? You can ask the agent to run `grep` for you. Example: "Search for any import of `@supabase/supabase-js` in `functions/`."

**Red flag:** The agent's work imports a library that an ADR explicitly forbids.

### Inspect 4: No surprise Azure changes

The `CLAUDE.md` constraint says: "Do not mutate Azure resources." Until you explicitly authorize Azure changes, verify that no `az create`, `az update`, or `az delete` commands were run. Ask the agent to show you every command it ran.

**Red flag:** Azure CLI output in the session that creates, updates, or deletes a resource without prior authorization.

### Inspect 5: Secrets are not in the code

Ask the agent: "Search all new or modified files for any occurrence of a password, API key, or access key." The correct pattern is that secrets are referenced as `process.env.SECRET_NAME` — a variable name, not a value. A literal string that looks like a key or password is wrong.

**Red flag:** Any literal credential in code or a committed `.env` file.

### Inspect 6: The WORKLOG was updated

Open `migration/WORKLOG.md`. Verify there is an entry for the completed session. If the agent completed tasks but did not update the WORKLOG, ask for an update before ending the session.

**Red flag:** No WORKLOG entry for a session that made significant changes.

---

## 11. Red Flags

These are warning signs to watch for in any future session. Each is grounded in something that went wrong in this session or represents a known risk class for this type of project.

**RF-01: An agent proposes to change application source code in `src/` without citing a specific task**
The migration safety constraint in `CLAUDE.md` requires explicit instruction before touching application source. If an agent proposes this without a clear task reference, stop and ask why.

**RF-02: An ADR approval produced no confirmation or error, only silence**
Parallel approval silently fails. After every `adr_approve` call, the agent should confirm the file was written and the YAML is valid. Silence means it was likely auto-rejected.

**RF-03: ADR files have YAML syntax errors**
After any `adr_approve` call, check that the YAML frontmatter is valid. A corrupted ADR disables machine-readable policy enforcement. See Failure 1 above.

**RF-04: A task was completed without a test**
Every task in the plan includes a test. If an agent says a task is done but there is no test file and no test pass confirmation, the task is incomplete.

**RF-05: A commit touches more files than the task specifies**
Each task in the plan names the exact files that change. A commit that modifies additional files is expanding scope without authorization. This increases blast radius.

**RF-06: A `.env` file appears in `git status` as a tracked file**
This is an immediate security action item. Run `git rm --cached .env` and verify `.env` is in `.gitignore`. Do not proceed until this is resolved.

**RF-07: The agent proposes to run an Azure resource mutation command**
The `CLAUDE.md` constraint prohibits this until explicitly authorized. This constraint exists because Azure resource mutations can have billing, security, and availability consequences that are difficult to reverse.

**RF-08: The agent skips an open question instead of answering it**
The open questions file was built precisely to avoid assumptions. If a new question arises that is not in the file, it should be added and answered before the task that depends on it continues.

**RF-09: A new dependency is added to `functions/package.json` without an ADR or explicit plan reference**
Every dependency decision in this project is captured in an ADR. Adding a dependency outside the plan is an undocumented architectural decision. The correct path is: write the ADR, get it approved, then add the dependency.

**RF-10: The session ends without a WORKLOG update**
Undocumented sessions create gaps in the memory infrastructure. The next session will waste time reconstructing what was done.

**RF-11: An agent proposes to batch ADR approvals via subagent or parallel agent dispatch**
Even if the approvals would be sequential within the subagent, they will deadlock — the permission prompt does not surface in the main session. ADR approvals must run in the main agent thread. See Failure 3b.

---

## 12. Reusable Checklist for Future Sessions

Use this before, during, and after any implementation session.

### Before the session

- [ ] Read `migration/WORKLOG.md` — confirm where the last session ended
- [ ] Confirm both user actions from Q3 and Q7 are complete (Key Vault secrets, custom domain)
- [ ] Identify the next task in the plan by finding the first unchecked checkbox
- [ ] Verify no open questions in `10-open-questions.md` are unresolved for that task
- [ ] Confirm the agent has read `CLAUDE.md` and its constraints are active

### During the session

- [ ] One task at a time. Do not begin Task N+1 until Task N is committed.
- [ ] Tests are written before implementation (TDD)
- [ ] Tests pass before committing
- [ ] Commit message exactly matches the message in the plan
- [ ] No Azure mutations without explicit authorization
- [ ] ADR approvals are sequential, one at a time, in the main session (never dispatched to a subagent)
- [ ] After each `adr_approve`, verify the YAML is valid in the file
- [ ] No secrets in code — only `process.env.SECRET_NAME` references
- [ ] No imports from ADR `disallow` lists

### After the session

- [ ] `WORKLOG.md` updated with what was completed
- [ ] `10-open-questions.md` updated if any new findings
- [ ] All commits pushed to `feature/lovable-migration`
- [ ] `git log --oneline` reviewed to confirm commits are in expected order
- [ ] Any new ADRs are approved and YAML-verified
- [ ] Any new failure modes documented in this guide or in WORKLOG

### Before approving cutover to production

- [ ] All 25 tasks in the implementation plan are checked
- [ ] Both user action items complete (Q3 + Q7)
- [ ] Differential security review run on the full branch diff
- [ ] All 11 ADRs reviewed against the implemented code — no violations
- [ ] Supabase system confirmed still running (do not cut over until Azure is verified)
- [ ] 22-user identity merge plan confirmed and tested
- [ ] `supabase/` deletion is the last step, after production verification

---

## 13. Glossary

**Adapter layer:** Code that sits between two systems and translates requests and responses between them. In this project, `functions/shared/` is the adapter layer — it provides the same capabilities as the Supabase Edge Functions but implemented in Azure/Node.js.

**ADR (Architectural Decision Record):** A short document that records a single technical decision — what was decided, why alternatives were rejected, and what the consequences are. Once approved, an ADR constrains all future code in that area. Files live in `docs/adr/`.

**Blast radius:** The amount of code, behavior, or infrastructure that could be affected if a change goes wrong. Minimizing blast radius means making the smallest possible change to achieve the goal, so an error affects as little as possible.

**Change surface area:** The total number of files, modules, or system behaviors that a change touches. Smaller surface area means less risk of introducing bugs in unintended places.

**Compatibility boundary:** A layer of code that presents a stable interface to consumers even as the implementation behind it changes. In this project, the planned `src/lib/api-client.ts` is the compatibility boundary — the frontend calls it, and it handles whichever backend (Supabase or Azure) is currently active.

**Context window:** The maximum amount of text an AI model can read and reason about in a single session. Managing the context window means keeping only what the current task needs, and storing everything else in durable files.

**Durable memory:** Information that must survive between sessions — WORKLOG.md, ADRs, open questions, git commit history.

**Implementation seam:** A defined boundary in a system where one implementation can be replaced by another without changing the code on either side of the boundary. The seam is where old behavior and new behavior meet.

**Incremental migration:** A migration strategy that replaces one piece at a time rather than rewriting everything at once. The old system continues to function until the new system has fully replaced each piece.

**MCP (Model Context Protocol):** A protocol that lets AI agents call external tools and services. In this project, adr-kit and the Azure tools are accessed via MCP.

**Minimal viable change:** The smallest change that achieves the required behavior. Anything additional increases blast radius unnecessarily.

**Permission prompt:** A dialog that Claude Code shows the user when an agent wants to perform a sensitive action (like running a bash command or calling an MCP tool). Only one prompt can be active at a time — if multiple are fired simultaneously, all but the first are auto-rejected.

**Phase:** A group of related tasks in the implementation plan that share a dependency structure. Phase 0 tasks have no blockers. Phase 1 tasks can only start after Phase 0 is complete.

**Row Level Security (RLS):** A database feature that restricts which rows a user can see or modify, based on their identity. Supabase used RLS extensively. The migration removes all Supabase RLS and replaces it with application-layer checks inside each Azure Function.

**SAS token (Shared Access Signature):** A cryptographically signed URL parameter that grants time-limited access to a specific file in Azure Blob Storage. Generated by the Azure Functions on the server side; the browser uses the token to access the file directly from Azure Storage.

**Smallest coherent change:** The minimum set of changes that can be deployed together without leaving the system in an inconsistent state. Related to minimal viable change but emphasizes coherence — all parts of the change work together.

**Strangler fig pattern:** An architecture pattern for replacing a legacy system incrementally. The new system is built alongside the old one, gradually taking over more behavior until the old system can be removed entirely. Named after a tree that grows around its host without killing it immediately.

**Surgical refactor:** A code change that modifies the implementation (how something is done) without modifying the behavior (what it does). Example: porting the SAS generation from Deno Web Crypto to Node.js crypto — same algorithm, different runtime.

**Task:** A single unit of work in the implementation plan. Each task has a test, an implementation step, a commit, and an acceptance criterion.

**TDD (Test-Driven Development):** A discipline where the test is written before the code. The test fails first (proving the feature is not yet built), then the code is written to make it pass. Produces a guarantee that the test is actually checking the right thing.

**Worktree:** A Git feature that lets you check out a branch into a separate directory. Useful for implementing changes in isolation while the main workspace remains stable.

---

*This guide was written from session evidence: WORKLOG.md, the 25-task implementation plan, all 11 ADRs, the open questions file, the executive summary, CLAUDE.md, AGENTS.md, and the git commit history of `feature/lovable-migration` as of 2026-05-19.*

*Where session evidence was incomplete, this is noted explicitly. Do not treat unmarked statements as verified fact without checking the cited source files.*
