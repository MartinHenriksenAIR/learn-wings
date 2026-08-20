---
name: make-motion-video
description: Use when producing a short motion-graphics video as code — a lesson hook, product intro, animated explainer, or mascot piece rendered to mp4 by the agent with no video editor. Also use when a Revideo render fails (especially on Windows) or when an existing motion piece reads as stiff, dead, or "not lively".
---

# Make a motion video

Short brand videos produced entirely as code: a Revideo scene renders headless to mp4, the agent inspects rendered frames, critiques, edits, re-renders. The agent is the animator, the director, and the editor.

**Core principle: rendered pixels are the only truth.** Motion that looks right in code routinely looks wrong on screen — invisible sweat drops, detached legs, dead holds. Never judge animation from source; judge filmstrips (see `references/qa-loop.md`).

## The brief — gather before writing anything

- **Purpose, audience, placement, duration.** A hook above a lesson wants 20–26 s; an intro can run longer. Silent-legible is the default: visuals carry 100% of the meaning, music is added after render, narration is a separate (larger) project.
- **Brand tokens.** Lift EXACT values from the host project's design system (colors, font, radii) — read the real token files, never eyeball from screenshots.
- **Character canon.** If a mascot exists it has a canonical spec: exact colors, construction, silhouette, what may never change. Collect it and treat it as hard constraints. Never improvise onto a mascot and never rebrand it — emotion is expressed through posture, eyes, and timing, never through color. When the user supplies an example image, ask which parts are canon and which are pose-of-the-day; guessing wrong costs a full iteration.
- **Copy rules.** On-screen text follows the house writing rules (for learn-wings: ASD-STE-100 — short active sentences, no contractions — no em-dashes anywhere, glossary terminology). Captions, cards, and end-card text all count.
- **Story.** Beats with an emotional arc, not a feature list. Contrast is the engine: show the good state before the bad one, or the joke has no baseline.

## Workflow

1. **Scaffold.** Copy `assets/template/` to a scratch directory outside the repo, `npm install`, then `node <skill-dir>/scripts/patch-renderer.mjs <project-dir>` (mandatory on Windows, harmless elsewhere). Read `references/revideo.md` first — it lists the constraints that each cost hours to discover.
2. **Smoke render immediately.** Render the template scene before any real work (`npx tsx render.ts`). Pipeline breakage found now costs minutes; found after choreography it costs the afternoon.
3. **Design before animating.** Read `references/animation-craft.md`, then write a motion bible (the numeric rules you commit to) and a beat sheet (each story beat mapped to principles and staging) in a scratch `notes.md`. Scenes built without this get liveliness patched on later, which has a low ceiling.
4. **Build.** One scene, object API, rig and loops per the craft reference. `references/worked-example.tsx` is a complete proven scene (25 s mascot hook) — mine it for patterns, do not paste from it blindly.
5. **QA loop.** Minimum 4 render → filmstrip → written critique → edit iterations for a new piece, per `references/qa-loop.md`. The critique is written before the edit, against your own motion bible.
6. **Music.** After the final render, per `references/music.md`. Never bundle or commit tracks.
7. **Deliver.** Final mp4, proof filmstrips, a per-iteration log, and honest remaining weaknesses. Raw facts — the user decides what is good enough.

## When quality plateaus

Incremental patching of a mediocre scene stalls: the fixes fight the skeleton. Rebuild from scratch with the old version as a baseline to beat — keep its copy and rig lessons, re-author the motion, and gate the finish on a beat-by-beat filmstrip comparison where no beat may lose to the old cut (`references/qa-loop.md`). A from-scratch rebuild informed by a written motion bible reliably beats iteration five of a patch series.

## Common mistakes

| Mistake | Reality |
|---|---|
| Judging motion from code | Renders lie in the other direction — extract frames, look at them |
| Fade-in entrance | Frame 1 must already be moving; drop the character in |
| Static character between cues | Idle life (breathing, blinks, twitches) runs as background loops the whole video |
| Effects sized for 1080p viewing | If it is invisible on a 320 px filmstrip tile, the viewer never feels it |
| Straight-line motion | Everything arcs: entrances diagonal, tosses parabolic, rotation settling into landings |
| Mascot recolored to show emotion | Canon violation; posture, eyes, and timing only |
| Captions and props sharing airspace | Decide layering and trajectory bounds up front so collision is impossible, not patched |
| Skipping the smoke render | Setup bugs surface after an hour of scene work instead of two minutes |
