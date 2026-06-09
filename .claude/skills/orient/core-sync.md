# core-sync — keep the durable core honest

`core-sync` reconciles the durable core (`docs/orientation/CONTEXT.md`) against reality. It is the WRITE counterpart to `orient` (which is read-only on the core).

**When it runs:**
- At **handoff** (session end — the natural "here's what changed" moment). REQUIRED.
- As a **mid-work behavior** — when an agent's own change *obviously* moves the core (closes a tracked issue, makes a structural decision, adds a whole new subsystem), update the core in the same change.
- NOT from `orient` / `pickup` — those only FLAG drift in the rendered digest; they never write `CONTEXT.md`. (Session start does no new work yet, and auto-editing a committed file then is surprising.)

**Why the split exists:** confidently-wrong core is worse than obviously-stale core — it looks authoritative, so nobody double-checks it. So **detection is automatic; writing of anything subjective is human-confirmed.**

## Two modes, by confidence

**Auto-fix (mechanical / verifiable — just do it):**
- A `known_issues` entry is now closed/merged → remove it; an open issue clearly belonging to a component → add it.
- A decision was made this session → append a plain-English line to the `decisions` log.
- `current_focus` names a PR/issue that is now merged/closed → strike or update the mechanical part.

**Propose (judgment — suggest, human confirms):**
- A `health` change (e.g. a component that just gained several bug issues → `fragile`?).
- A `summary` rewrite (only when behavior materially changed).
- The NEW `current_focus` direction (the *fact* that focus shifted is detectable; the new direction is the human's call).

Never silently rewrite intent or judgment.

## Forward note
When the core graduates to a structured `docs/orientation/context.yml` (the "Option 3" structured core), this same reconcile becomes the automated **consistency check** (e.g. "issue #17 is closed but still in `authz.known_issues`"). Building `core-sync` now in prose form is what makes that graduation natural.
