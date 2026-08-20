import {makeScene2D, Txt, Rect, Circle, Node, Layout} from '@revideo/2d';
import {
  all,
  cancel,
  delay,
  easeInCubic,
  easeInOutCubic,
  easeInOutSine,
  easeOutBack,
  easeOutCubic,
  easeOutElastic,
  easeOutSine,
  spawn,
  useScene,
  waitFor,
} from '@revideo/core';

const NAVY = '#10298f';
const INK = '#171a26';
const IVORY = '#f1f2f5';
const MUTED = '#686d7e';
const TINT = '#eef1fb';
const GRAY = '#e9eaf0';
const CLAY = '#D97757';
const CLAY_DARK = '#C05F41';
const FONT = 'Hanken Grotesk, Segoe UI, system-ui, sans-serif';
const BEAT = 1 / 3; // 10 frames at 30fps; every major hit lands on a multiple

export default makeScene2D('beats', function* (view) {
  const style = useScene().variables.get('style', 'calm')();
  const lively = style === 'lively';

  view.fill(IVORY);

  // ---- root container: everything except the end card
  const root = new Node({scale: 1.03});
  view.add(root);

  // ---- floor shadow: grounds the character, shows air during hops
  const shadow = new Circle({x: -40, y: 398, width: 310, height: 34, fill: GRAY});
  root.add(shadow);

  // ---- mascot rig: bot (story moves) > breath (idle bob) > squash (impact, pivot at feet)
  const bot = new Node({x: -40, y: 240});
  const legs = [-88, -32, 28, 84].map(
    x => new Rect({x, y: 94, offset: [0, -1], width: 28, height: 62, radius: 3, fill: CLAY}),
  );
  const legShade = new Rect({x: -100, y: 94, offset: [0, -1], width: 10, height: 62, radius: 3, fill: CLAY_DARK});
  const breath = new Node({});
  const squash = new Node({y: 100});
  const tailNode = new Node({x: -125, y: -90});
  const tail = new Rect({x: -25, y: 0, width: 64, height: 42, radius: 3, fill: CLAY});
  const tailShade = new Rect({x: -49, y: 0, width: 16, height: 42, radius: 3, fill: CLAY_DARK});
  // right arm mirrors the left one, including every kick and twitch
  const armRNode = new Node({x: 125, y: -90});
  const armR = new Rect({x: 25, y: 0, width: 64, height: 42, radius: 3, fill: CLAY});
  const armRShade = new Rect({x: 49, y: 0, width: 16, height: 42, radius: 3, fill: CLAY_DARK});
  armRNode.rotation(() => -tailNode.rotation());
  const body = new Rect({y: -100, width: 250, height: 200, radius: 6, fill: CLAY});
  const bodyShade = new Rect({x: -117, y: -100, width: 16, height: 200, radius: 3, fill: CLAY_DARK});
  const eyes = new Node({y: -100});
  const eyeL = new Rect({x: -55, y: -55, width: 26, height: 26, radius: 2, fill: '#141413'});
  const eyeR = new Rect({x: 45, y: -55, width: 26, height: 26, radius: 2, fill: '#141413'});
  const sweat = new Circle({x: 112, y: -96, size: 44, fill: NAVY, opacity: 0});
  const sweat2 = new Circle({x: 98, y: -106, size: 20, fill: NAVY, opacity: 0});

  tailNode.add(tail);
  tailNode.add(tailShade);
  armRNode.add(armR);
  armRNode.add(armRShade);
  squash.add(tailNode);
  squash.add(armRNode);
  squash.add(body);
  squash.add(bodyShade);
  eyes.add(eyeL);
  eyes.add(eyeR);
  squash.add(eyes);
  breath.add(squash);
  for (const leg of legs) bot.add(leg);
  bot.add(legShade);
  bot.add(breath);
  bot.add(sweat);
  bot.add(sweat2);
  root.add(bot);

  // ---- pile carrier: bobs with the breath, sinks with the load
  const carryBob = new Node({});
  const carry = new Node({x: -40, y: 0});
  carryBob.add(carry);
  root.add(carryBob);

  // ---- idle life
  let alive = true;
  let eyesBusy = false;
  let eyeOpen = 26;
  let breathAmp = 5;
  let breathPeriod = 1.0;

  function* breathe() {
    while (alive) {
      const half = breathPeriod / 2;
      yield* all(
        breath.y(-breathAmp, half, easeInOutSine),
        carryBob.y(-breathAmp, half, easeInOutSine),
      );
      yield* all(breath.y(0, half, easeInOutSine), carryBob.y(0, half, easeInOutSine));
    }
  }

  function* blinkOnce() {
    yield* all(eyeL.height(5, 0.06), eyeR.height(5, 0.06));
    yield* all(eyeL.height(eyeOpen, 0.09), eyeR.height(eyeOpen, 0.09));
  }

  const blinkGaps = [2.2, 3.1, 2.0, 3.4, 2.5, 3.0];
  function* blinkLoop() {
    let k = 0;
    while (alive) {
      yield* waitFor(blinkGaps[k++ % blinkGaps.length]);
      if (!eyesBusy) yield* blinkOnce();
    }
  }

  let tailBusy = false;
  const tailGaps = [3.4, 5.0, 4.2];
  function* tailLoop() {
    let k = 0;
    while (alive) {
      yield* waitFor(tailGaps[k++ % tailGaps.length]);
      if (tailBusy) continue;
      yield* tailNode.rotation(9, 0.09, easeOutCubic);
      yield* tailNode.rotation(-4, 0.12, easeInOutCubic);
      yield* tailNode.rotation(0, 0.16, easeOutCubic);
    }
  }

  function* tailKick(amt: number) {
    if (tailBusy) return;
    tailBusy = true;
    yield* tailNode.rotation(amt, 0.09, easeOutCubic);
    yield* tailNode.rotation(0, 0.26, easeOutBack);
    tailBusy = false;
  }

  function* droop(h: number, dur = 0.6) {
    eyesBusy = true;
    eyeOpen = h;
    yield* all(eyeL.height(h, dur, easeInOutCubic), eyeR.height(h, dur, easeInOutCubic));
    eyesBusy = false;
  }

  // ---- captions: two nodes cross-fade with upward drift, always topmost
  const capA = new Txt({
    text: '', fontFamily: FONT, fontWeight: 800, fontSize: 76, fill: INK, y: -330, opacity: 0,
  });
  const capB = capA.clone();
  let capActive = capA;

  function* say(text: string, opts: {size?: number; fill?: string} = {}) {
    const next = capActive === capA ? capB : capA;
    next.text(text);
    next.fontSize(opts.size ?? 76);
    next.fill(opts.fill ?? INK);
    next.y(-314);
    next.opacity(0);
    const old = capActive;
    capActive = next;
    yield* all(
      old.opacity(0, 0.28, easeInOutCubic),
      old.y(-346, 0.28, easeInCubic),
      next.opacity(1, 0.33, easeOutCubic),
      next.y(-330, 0.33, easeOutCubic),
    );
    old.y(-330);
  }

  function* hush() {
    yield* all(capActive.opacity(0, 0.3, easeInOutCubic), capActive.y(-346, 0.3, easeInCubic));
    capActive.y(-330);
  }

  function card(label: string, w: number, fill: string, color: string, h = 60) {
    return new Rect({
      width: w,
      height: h,
      radius: 13,
      fill,
      layout: true,
      alignItems: 'center',
      justifyContent: 'center',
      opacity: 0,
      shadowColor: 'rgba(23, 26, 38, 0.16)',
      shadowBlur: 16,
      shadowOffset: [0, 5],
      children: [new Txt({text: label, fontFamily: FONT, fontWeight: 700, fontSize: 28, fill: color})],
    });
  }

  // ---- HUD: clock top-left, gauge beside it
  const clock = new Rect({
    x: -790,
    y: -430,
    fill: TINT,
    radius: 16,
    padding: [14, 30, 14, 30],
    layout: true,
    opacity: 0,
    shadowColor: 'rgba(23, 26, 38, 0.10)',
    shadowBlur: 12,
    shadowOffset: [0, 4],
    children: [new Txt({text: '9:00', fontFamily: FONT, fontWeight: 800, fontSize: 54, fill: NAVY})],
  });
  const clockText = clock.children()[0] as Txt;
  root.add(clock);

  const gauge = new Rect({
    x: -600, y: -430, offset: [-1, 0], width: 900, height: 18, radius: 9, fill: GRAY, opacity: 0,
    shadowColor: 'rgba(23, 26, 38, 0.10)', shadowBlur: 8, shadowOffset: [0, 3],
  });
  const gaugeFill = new Rect({x: -600, y: -430, offset: [-1, 0], width: 0, height: 18, radius: 9, fill: NAVY});
  root.add(gauge);
  root.add(gaugeFill);

  // captions on top of everything inside the root
  root.add(capA);
  root.add(capB);

  // ---- pile data. Slots in carry space; flight starts obey the layering law:
  // start y = max(slot - 170, -245) so no trajectory can touch the caption zone.
  const items = [
    {node: card('your instructions', 320, TINT, NAVY), slot: 110, jx: -6, rest: 0.7},
    {node: card("Claude's replies", 300, TINT, NAVY), slot: 48, jx: 5, rest: -0.6},
    {node: card('file · 2,000 lines', 310, GRAY, INK), slot: -14, jx: -4, rest: 0.5},
    {node: card('command output', 290, GRAY, INK), slot: -76, jx: 7, rest: -0.7},
    {node: card('search results', 270, GRAY, INK), slot: -138, jx: -5, rest: 0.6},
  ];
  const gaugeSteps = [180, 330, 480, 610, 720];

  const bumpBusy = new Set<number>();
  function* bump(j: number) {
    if (bumpBusy.has(j)) return;
    bumpBusy.add(j);
    const n = items[j].node;
    const y0 = items[j].slot;
    yield* n.y(y0 - 6, 0.08, easeOutCubic);
    yield* n.y(y0, 0.16, easeOutCubic);
    bumpBusy.delete(j);
  }

  // one tossed card: shallow parabolic arc in from off-screen upper right,
  // tumble rotation, squash on landing, Clawd sinks 3px (legs -3 keeps feet planted)
  function* dropItem(i: number) {
    const it = items[i];
    const n = it.node;
    carry.add(n);
    const flight = (lively ? 0.44 : 0.5) - i * 0.04;
    n.x(1090);
    n.y(Math.max(it.slot - 170, -245));
    n.rotation(-14 + i * 1.5);
    n.scale([0.96, 1.06]);
    yield* all(
      n.opacity(1, 0.07),
      n.x(it.jx, flight, easeOutSine),
      n.y(it.slot, flight, easeInCubic),
      n.rotation(it.rest * 3, flight, easeInOutSine),
    );
    // impact
    yield* all(
      n.scale([1.07, 0.9], 0.08, easeOutCubic),
      n.rotation(it.rest * 2.2, 0.08),
      squash.scale([1.05, 0.94], 0.08, easeOutCubic),
      bot.y(bot.y() + 3, 0.08, easeOutCubic),
      carry.y(carry.y() + 11, 0.08, easeOutCubic),
      ...legs.map(l => l.height(l.height() - 3, 0.08, easeOutCubic)),
      legShade.height(legShade.height() - 3, 0.08, easeOutCubic),
      gaugeFill.width(gaugeSteps[i], 0.3, easeOutCubic),
      ...items.slice(0, i).map((_, j) => delay(0.05 * (i - j), bump(j))),
      delay(0.07, tailKick(-6)),
    );
    if (i === 2) {
      breathAmp = 9;
      breathPeriod = 2.0;
    }
    yield* all(
      n.scale(1, 0.24, easeOutBack),
      n.rotation(it.rest, 0.36, easeOutElastic),
      squash.scale(1, 0.24, easeOutBack),
      carry.y(carry.y() - 8, 0.24, easeOutBack),
    );
  }

  // ================= TIMELINE =================

  // ---- BEAT 1 · ENTRANCE: frame 1 is already mid-fall on a slight diagonal; land ON the grid
  bot.y(-300);
  bot.x(-78);
  bot.rotation(-3.5);
  squash.scale([0.92, 1.1]);
  shadow.scale(0.55);
  shadow.opacity(0.5);
  yield* all(
    bot.y(240, 2 * BEAT, easeInCubic),
    bot.x(-40, 2 * BEAT, easeOutSine),
    bot.rotation(0, 2 * BEAT, easeOutSine),
    shadow.scale(1, 2 * BEAT, easeInCubic),
    shadow.opacity(1, 2 * BEAT, easeInCubic),
  );
  yield* all(
    squash.scale([1.1, 0.86], 0.09, easeOutCubic),
    ...legs.map(l => l.height(44, 0.09, easeOutCubic)),
    legShade.height(44, 0.09, easeOutCubic),
    delay(0.07, tailKick(-11)),
  );
  yield* all(
    squash.scale(1, 0.3, easeOutBack),
    ...legs.map(l => l.height(62, 0.26, easeOutCubic)),
    legShade.height(62, 0.26, easeOutCubic),
  );
  // happy rebound hop: small, quick, charming
  yield* all(
    bot.y(224, 0.13, easeOutCubic),
    squash.scale([0.97, 1.04], 0.13, easeOutCubic),
    shadow.scale(0.96, 0.13, easeOutCubic),
  );
  yield* all(
    bot.y(240, 0.14, easeInCubic),
    squash.scale([1.04, 0.95], 0.14, easeInCubic),
    shadow.scale(1, 0.14, easeInCubic),
  );
  yield* squash.scale(1, 0.22, easeOutBack);

  const breathTask = spawn(breathe);
  const blinkTask = spawn(blinkLoop);
  const tailTask = spawn(tailLoop);

  // ---- BEAT 2 · fresh and alert at 9:00
  yield* say('Long Claude Code sessions');
  clock.scale(0.6);
  yield* all(clock.opacity(1, 0.2), clock.scale(1, 0.33, easeOutBack));
  yield* eyes.x(-8, 0.2, easeOutCubic);
  yield* waitFor(0.15);
  yield* all(eyes.x(8, 0.25, easeInOutCubic), tailKick(10));
  yield* waitFor(0.15);
  yield* eyes.x(0, 0.2, easeOutCubic);
  yield* waitFor(0.1);

  // ---- BEAT 3 · the question: curious tilt
  yield* say('slowly become… vaguer?', {fill: MUTED});
  yield* all(
    bot.rotation(3, 0.45, easeInOutCubic),
    eyes.y(-96, 0.45, easeInOutCubic),
    eyes.x(-6, 0.45, easeInOutCubic),
  );
  yield* waitFor(0.25);
  yield* all(
    bot.rotation(0, 0.35, easeInOutCubic),
    eyes.y(-100, 0.35, easeInOutCubic),
    eyes.x(0, 0.35, easeInOutCubic),
  );

  // ---- BEAT 4 · 'sharp.' — the charm peak: crouch, perky arc hop, crisp land
  yield* say('sharp.', {fill: NAVY});
  eyesBusy = true;
  tailBusy = true;
  // anticipation: crouch, eyes go big
  yield* all(
    squash.scale([1.07, 0.92], 0.16, easeInOutCubic),
    ...legs.map(l => l.height(52, 0.16, easeInOutCubic)),
    legShade.height(52, 0.16, easeInOutCubic),
    eyeL.height(30, 0.16), eyeR.height(30, 0.16),
    tailNode.rotation(6, 0.16, easeInOutCubic),
  );
  // rise on an arc (x drifts out), stretch in the air, legs tuck
  yield* all(
    bot.y(170, 0.2, easeOutCubic),
    bot.x(-24, 0.2, easeOutCubic),
    squash.scale([0.94, 1.09], 0.16, easeOutCubic),
    ...legs.map(l => l.height(46, 0.16, easeOutCubic)),
    legShade.height(46, 0.16, easeOutCubic),
    shadow.scale(0.9, 0.2, easeOutCubic),
    shadow.opacity(0.7, 0.2, easeOutCubic),
    delay(0.06, tailNode.rotation(-9, 0.14, easeOutCubic)),
  );
  // fall back on the return arc
  yield* all(
    bot.y(240, 0.2, easeInCubic),
    bot.x(-40, 0.2, easeInCubic),
    squash.scale([0.97, 1.05], 0.2, easeInCubic),
    shadow.scale(1, 0.2, easeInCubic),
    shadow.opacity(1, 0.2, easeInCubic),
  );
  // crisp landing
  yield* all(
    squash.scale([1.07, 0.91], 0.09, easeOutCubic),
    ...legs.map(l => l.height(48, 0.09, easeOutCubic)),
    legShade.height(48, 0.09, easeOutCubic),
    delay(0.06, tailNode.rotation(7, 0.1, easeOutCubic)),
  );
  yield* all(
    squash.scale(1, 0.28, easeOutBack),
    ...legs.map(l => l.height(62, 0.24, easeOutCubic)),
    legShade.height(62, 0.24, easeOutCubic),
    tailNode.rotation(0, 0.28, easeOutBack),
  );
  tailBusy = false;
  yield* all(eyeL.height(eyeOpen, 0.14), eyeR.height(eyeOpen, 0.14));
  eyesBusy = false;
  yield* waitFor(0.12);

  // ---- BEAT 5 · time passes: the clock ticks forward WITH the caption change
  function* clockRoll() {
    for (const t of ['10:00', '11:00', '11:30']) {
      clockText.text(t);
      yield* clock.scale(1.07, 0.07, easeOutCubic);
      yield* clock.scale(1, 0.1, easeOutCubic);
      yield* waitFor(0.05);
    }
    yield* clock.opacity(0.75, 0.25);
  }
  breathAmp = 7;
  breathPeriod = 1.6;
  yield* all(clockRoll(), say('hours later: re-asking…', {fill: MUTED}));
  yield* all(
    droop(20, 0.6),
    bot.rotation(2.4, 0.6, easeInOutCubic),
    eyes.y(-95, 0.6, easeInOutCubic),
  );
  yield* waitFor(0.3);

  // ---- BEAT 6 · the reveal: gauge in, eyes dart to where the load will come from
  yield* all(gauge.opacity(1, 0.33), say('everything it works with piles onto it'));
  yield* all(
    bot.rotation(0, 0.3, easeInOutCubic),
    eyes.x(12, 0.25, easeOutCubic),
    eyes.y(-108, 0.25, easeOutCubic),
  );
  yield* waitFor(0.15);

  // ---- BEAT 7 · PILE-ON: landings on the grid, gaps 2,2,1,1 BEATs (cadence snowballs)
  {
    const flights = [0.5, 0.46, 0.42, 0.38, 0.34].map(f => (lively ? f - 0.06 : f));
    const lands = [0, 2, 4, 5, 6].map(b => b * BEAT);
    const pad = flights[0];
    yield* all(
      ...items.map((_, i) => delay(pad + lands[i] - flights[i], dropItem(i))),
      delay(pad + lands[2] + 0.4, droop(16, 0.28)),
    );
  }
  yield* all(eyes.x(0, 0.35, easeInOutCubic), eyes.y(-100, 0.35, easeInOutCubic));

  // ---- BEAT 8 · 'and the window keeps filling' — stage the gauge
  yield* say('and the window keeps filling');
  // Clawd glances at the gauge; the gauge strains
  yield* all(
    eyes.x(-10, 0.3, easeInOutCubic),
    eyes.y(-106, 0.3, easeInOutCubic),
    gauge.height(28, 0.22, easeOutCubic),
    gaugeFill.height(28, 0.22, easeOutCubic),
    gaugeFill.width(760, 0.4, easeOutCubic),
  );
  yield* all(
    gauge.height(18, 0.3, easeOutBack),
    gaugeFill.height(18, 0.3, easeOutBack),
  );
  // the pile settles with a cascading shift while the eyes come back
  yield* all(
    ...items.map((_, j) => delay(0.06 * j, bump(j))),
    eyes.x(0, 0.3, easeInOutCubic),
    eyes.y(-100, 0.3, easeInOutCubic),
  );
  yield* waitFor(0.15);

  // ---- BEAT 9 · THE BIG ONE. Caption clears out; the card is the message.
  const bigFile = card('the whole file, every line', 540, NAVY, '#ffffff', 84);
  yield* hush();
  // anticipation: look up, brace
  eyesBusy = true;
  yield* all(
    eyes.y(-108, 0.3, easeOutCubic),
    eyeL.height(24, 0.3), eyeR.height(24, 0.3),
    eyeL.width(30, 0.3), eyeR.width(30, 0.3),
    squash.scale([1.03, 0.97], 0.3, easeInOutCubic),
  );
  carry.add(bigFile);
  bigFile.x(0);
  bigFile.y(-620);
  bigFile.scale([0.94, 1.1]);
  breathAmp = 11;
  breathPeriod = 2.4;
  yield* all(
    bigFile.opacity(1, 0.08),
    bigFile.y(-212, 0.55, easeInCubic),
    bigFile.rotation(-1.2, 0.55, easeInOutSine),
    gaugeFill.width(872, 0.6, easeOutCubic),
  );
  // impact: crush + screen dip
  yield* all(
    bigFile.scale([1.09, 0.88], 0.09, easeOutCubic),
    bigFile.rotation(-1.8, 0.09),
    squash.scale([1.09, 0.88], 0.1, easeOutCubic),
    bot.y(bot.y() + 9, 0.1, easeOutCubic),
    carry.y(carry.y() + 22, 0.1, easeOutCubic),
    ...legs.map(l => l.height(l.height() - 9, 0.1, easeOutCubic)),
    legShade.height(legShade.height() - 9, 0.1, easeOutCubic),
    root.y(12, 0.08, easeOutCubic),
    gauge.height(30, 0.1, easeOutCubic),
    gaugeFill.height(30, 0.1, easeOutCubic),
    ...items.map((_, j) => delay(0.04 * (items.length - j), bump(j))),
    delay(0.07, tailKick(-12)),
  );
  // hit-stop: hold the crushed pose
  yield* waitFor(0.13);
  // heavy recovery
  yield* all(
    bigFile.scale(1, 0.5, easeOutBack),
    bigFile.rotation(-0.8, 0.6, easeOutElastic),
    squash.scale(1, 0.6, easeOutBack),
    carry.y(carry.y() - 13, 0.6, easeOutBack),
    root.y(0, 0.4, easeOutBack),
    gauge.height(20, 0.5, easeOutBack),
    gaugeFill.height(20, 0.5, easeOutBack),
    eyeL.width(26, 0.45), eyeR.width(26, 0.45),
    eyeL.height(13, 0.6, easeInOutCubic), eyeR.height(13, 0.6, easeInOutCubic),
  );
  eyeOpen = 13;
  eyesBusy = false;
  // legs shuffle under the weight
  yield* all(
    ...legs.map((l, j) => delay(0.05 * j, l.x(l.x() + (j % 2 === 0 ? -4 : 4), 0.1, easeInOutCubic))),
  );
  yield* all(
    ...legs.map((l, j) => delay(0.05 * j, l.x(l.x() + (j % 2 === 0 ? 4 : -4), 0.12, easeInOutCubic))),
  );

  // ---- BEAT 10 · 'and nothing leaves on its own' — sag, sweat, sigh
  yield* say('and nothing leaves on its own');
  // the load tips; Clawd braces under it
  yield* all(
    carry.rotation(3, 0.55, easeInOutCubic),
    carry.x(carry.x() - 12, 0.55, easeInOutCubic),
    bot.rotation(-2.2, 0.55, easeInOutCubic),
    bot.x(bot.x() - 9, 0.55, easeInOutCubic),
  );
  yield* all(
    carry.rotation(0.8, 0.5, easeOutBack),
    carry.x(carry.x() + 10, 0.5, easeOutBack),
    bot.rotation(-0.6, 0.5, easeOutBack),
    bot.x(bot.x() + 8, 0.5, easeOutBack),
  );
  // one BIG navy sweat drop arcs off the head, a smaller one trails it
  yield* all(
    sweat.opacity(0.95, 0.12),
    sweat.x(164, 0.2, easeOutCubic),
    sweat.y(-152, 0.2, easeOutCubic),
    delay(0.1, sweat2.opacity(0.9, 0.1)),
    delay(0.1, sweat2.x(138, 0.2, easeOutCubic)),
    delay(0.1, sweat2.y(-146, 0.2, easeOutCubic)),
  );
  yield* all(
    sweat.x(212, 0.5, easeOutSine),
    sweat.y(52, 0.5, easeInCubic),
    delay(0.4, sweat.opacity(0, 0.1)),
    sweat2.x(172, 0.55, easeOutSine),
    sweat2.y(40, 0.55, easeInCubic),
    delay(0.43, sweat2.opacity(0, 0.12)),
  );
  yield* droop(10, 0.5);
  // heavy sigh: inhale up, exhale sag; eyes fall to the floor; the tail gives up
  eyesBusy = true;
  tailBusy = true;
  yield* all(
    squash.scale([0.985, 1.025], 0.5, easeInOutSine),
    eyeL.height(14, 0.5, easeInOutCubic), eyeR.height(14, 0.5, easeInOutCubic),
  );
  yield* all(
    squash.scale([1.045, 0.955], 0.55, easeInOutSine),
    eyeL.height(6, 0.5, easeInOutCubic), eyeR.height(6, 0.5, easeInOutCubic),
    eyes.x(-12, 0.55, easeInOutCubic),
    eyes.y(-92, 0.55, easeInOutCubic),
    tailNode.rotation(-10, 0.55, easeInOutCubic),
    gauge.height(28, 0.5, easeInOutSine),
    gaugeFill.height(28, 0.5, easeInOutSine),
  );
  yield* all(
    squash.scale(1, 0.5, easeInOutSine),
    eyeL.height(9, 0.4, easeInOutCubic), eyeR.height(9, 0.4, easeInOutCubic),
    gauge.height(22, 0.45, easeInOutSine),
    gaugeFill.height(22, 0.45, easeInOutSine),
  );
  eyeOpen = 9;
  yield* waitFor(0.2);

  // ---- BEAT 11 · deadpan: eyes snap from the floor straight to the viewer, dead still
  yield* all(
    eyes.x(0, 0.13, easeOutCubic),
    eyes.y(-100, 0.13, easeOutCubic),
    eyeL.height(20, 0.13), eyeR.height(20, 0.13),
    squash.rotation(3, 0.16, easeOutCubic),
  );
  yield* waitFor(0.7);

  // ---- BEAT 12 · end card
  alive = false;
  cancel(breathTask, blinkTask, tailTask);

  const endTitle = new Txt({
    text: 'Managing Context in Claude Code',
    fontFamily: FONT,
    fontWeight: 800,
    fontSize: 88,
    fill: NAVY,
    y: -50,
    opacity: 0,
  });
  const endSub = new Txt({
    text: 'The lesson below shows you how to stay ahead of it.',
    fontFamily: FONT,
    fontWeight: 700,
    fontSize: 46,
    fill: MUTED,
    y: 70,
    opacity: 0,
  });
  const endBar = new Rect({y: 160, width: 0, height: 6, radius: 3, fill: NAVY, opacity: 0.5});
  view.add(endTitle);
  view.add(endSub);
  view.add(endBar);

  endTitle.y(-26);
  endSub.y(94);
  yield* all(
    root.opacity(0, 0.45, easeInOutCubic),
    delay(0.28, endTitle.opacity(1, 0.5, easeInOutCubic)),
    delay(0.28, endTitle.y(-50, 0.5, easeOutCubic)),
    delay(0.44, endSub.opacity(1, 0.5, easeInOutCubic)),
    delay(0.44, endSub.y(70, 0.5, easeOutCubic)),
  );
  yield* endBar.width(320, 0.7, easeInOutCubic);
  yield* waitFor(0.7);
});
