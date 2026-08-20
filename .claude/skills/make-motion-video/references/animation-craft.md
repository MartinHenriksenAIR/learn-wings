# Animation craft

Distilled from Disney's 12 principles applied to code-driven motion, plus what production runs proved. Write your motion bible from this file: the specific numeric rules you commit to for THIS piece, then a beat sheet mapping each story beat to principles and staging. Critique every iteration against your own bible.

## Rig architecture (characters)

Nest nodes so concurrent motions never fight over one property:

```
character (story moves: position, lean, walks)
└── breath (idle bob loop)
    └── squash (impact scale, PIVOTED AT THE FEET)
        ├── body, shade strips, appendages
        └── eyes (own node: tracking, droop, widen)
```

- Legs top-anchored (`offset: [0, -1]`) and tucked under the body, so height changes happen at the feet — otherwise squash detaches the legs.
- Mirror-symmetric parts bind reactively: `right.rotation(() => -left.rotation())`.
- Shade strips (darker rects on one edge) give flat shapes dimension; keep the shaded side consistent.

## Idle life — nothing is ever still

The number-one reason animation reads dead is a character that turns to stone between cues. Run these as spawned loops for the whole video:

- **Breathing bob**: starts subtle, grows heavier and slower under story load (5 px / 1.0 s fresh → 11 px / 2.4 s exhausted). If breathing is invisible on a filmstrip tile, raise the amplitude.
- **Blinks** every 2–3.5 s (vary the gaps), guarded by an `eyesBusy` flag so story eye-acting wins.
- **Appendage twitches** every 3–5 s with a busy flag arbitrating against impact reactions.
- Anything carried by the character (a pile, a prop) bobs with the breath — parent it to a sibling node driven by the same loop.

## Weight and impacts

- Falls **accelerate** (`easeInCubic`), never ease out. Slight stretch during the fall (scale [0.95, 1.08]).
- Landing: squash (scale [1.07, 0.9]) + small rotation wobble + the RECEIVER reacts — character sinks a few px, carried stack dips (overshoot down, `easeOutBack` recover), existing items ripple with ~0.05 s stagger.
- Recovery overshoots: `easeOutBack` / `easeOutElastic`, 120–150% overshoot on key moments.
- The heaviest impact gets a **hit-stop**: freeze the crushed pose ~0.13 s, then recover slowly and heavily. Optionally dip the whole frame a few px.
- Escalation reads as acceleration: shorten the gap between repeated impacts (e.g. 0.40 s → 0.28 s) so a pile-up snowballs.

## Anticipation and follow-through

- Wind up before every action: 2–4 frames of opposite motion (crouch before a hop, glance up before a catch, slight pull-back before a toss).
- Secondary parts lag the primary by 2–3 frames and settle 4–8 frames after it stops (tail kick after each landing, pile shift after the body moves).
- Items never stop dead: land, wobble, settle.

## Arcs

Nothing travels a straight line. Entrances fall on a diagonal with rotation that straightens into the landing; thrown items fly shallow parabolas with tumble; drops of liquid pop up then arc off. Hops rise and return on an arc (x drifts out and back).

## Staging

- One clear idea per moment. Establish a stable frame hierarchy (e.g. caption zone top-center, HUD top-left, character center-low) and keep it.
- **Layering law**: decide z-order and trajectory bounds up front so moving props CANNOT enter the text zone (clamp flight-start positions), instead of patching collisions later.
- Clear the stage for the climax: hush the caption so the key prop is the only message on screen.
- Whole-video camera moves (slow push-ins) are tempting and usually read as drift — default to a locked frame unless the user asks.

## Readability

Judge every effect at filmstrip scale (~320 px tiles): breathing amplitude, sweat drops, gauge swells. Pale-on-pale is invisible — key effects get the accent color and generous size. If you cannot see it in the strip, the viewer cannot feel it.

## Timing grid

Place major impacts on a consistent subdivision (e.g. multiples of 1/3 s) so later-muxed music feels synchronized without ever hearing it. Keep the grid exact inside dense clusters; drift is fine across long calm stretches.

## Appeal and emotional arc

- Act the arc, don't display it: content → curious → coping → strained → overwhelmed reads through posture, eye direction, and timing changes.
- Contrast is the engine — spend real charm on the good state (perky hop, crisp reactions) so the decline lands.
- One **deadpan look straight at the viewer** (eyes snap to center, tiny head tilt, ~0.7 s dead hold) before the ending is a reliable comedy beat.
- Character canon is inviolable: construction and colors exactly per spec, emotion never via color change.

## Entrances and endings

- Frame 1 is already moving. Drop the character in with a landing; never fade in from stillness.
- No dead frames between the scene fading out and the end card fading in — overlap them.
- End card: title + one-line handoff, subtle accent (a bar drawing in), and a hold long enough to read twice.
