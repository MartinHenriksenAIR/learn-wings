# The render-and-critique loop

Rendered pixels are the only truth. Every iteration: render → extract filmstrips → written critique → targeted edits. Minimum 4 full iterations for a new piece (the smoke render does not count). Production experience: iteration 1 finds composition errors, 2 finds rig/contact bugs, 3 applies craft depth, 4 fixes rhythm and visibility, 5 polishes transitions.

## Filmstrips

Full-video scan (one tile per ~0.5 s — spot dead holds, story flow, layout drift):

```bash
ffmpeg -y -v error -i output/main.mp4 -vf "fps=2,scale=320:-1,tile=7x8" -frames:v 1 output/scan.png
```

Close-up burst of a moment (8 fps over a frame range — this is where motion quality lives; even spacing between tiles reads mechanical, good animation shows anticipation, impact, settle):

```bash
ffmpeg -y -v error -i output/main.mp4 -vf "select=between(n\,A\,B),fps=8,tile=6x2" -frames:v 1 output/strip-moment.png
```

Cut close-ups for every landing, the climax impact, the entrance, and the ending. Read the PNGs — actually look at them.

## Written critique before edits

For each strip, write what fails against your motion bible (in your scratch notes.md): name the beat, the principle violated, and the intended fix. Then make exactly those edits. Critique-free editing degenerates into wandering.

Checks that catch real bugs:
- Does anything hold fully still longer than ~0.8 s? (idle life missing or cancelled)
- Do feet stay planted through squash? Do carried items track the carrier?
- Is every keyed effect visible at tile scale?
- Do props cross text? (layering law violated)
- Does the story parse with captions covered? (silent-legibility)
- Do HUD elements contradict the caption timeline? (clock/state changes must sync with the words)

## Rebuild with a baseline gate

When patching plateaus, rebuild from scratch:

1. Back up the current scene (`scene-vN-reference.tsx.bak`) and its render (`output/baseline.mp4`).
2. Re-author: keep the locked copy and the rig lessons, redesign the motion from a fresh motion bible. Do not paste old animation code.
3. Final gate: extract strips from baseline and new render at the same story moments; verdict per beat. **No beat may lose to the baseline** — fix any that do before finishing.

A long rebuild is a good fit for a background agent: give it the full brief (canon, constraints, craft references, iteration minimum, baseline gate), let it run the loop, then verify its proof strips yourself before delivering. Feedback rounds after user review are usually small targeted edits — do those inline.

## Report format

Deliver with: per-iteration log (what you saw → what you changed), final duration, beat-by-beat verdict vs baseline (for rebuilds), honest remaining weaknesses, and the proof filmstrip paths. Raw facts, no marketing language — the user decides what is good enough.
