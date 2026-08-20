# Revideo: setup and hard-won constraints

Revideo (MIT, Motion Canvas fork) is the framework of choice: fully open source and API-renderable. Remotion has richer agent tooling but requires a paid company license above 3 employees — do not switch to it without the user deciding that.

## Setup

- Scaffold from `assets/template/` (pinned `@revideo/*` 0.11.0 — `2d`, `core`, `renderer`, plus `ui` and `vite-plugin` which are undeclared peer dependencies that break the render when missing, and `vite`, `tsx`, `typescript`).
- `npm install`, then `node <skill-dir>/scripts/patch-renderer.mjs <project-dir>`. The renderer force-injects Chromium's `--single-process` flag, which crashes Chrome on Windows with "Navigating frame was detached" / LifecycleWatcher errors. The script guards the flag behind a non-Windows check. Re-run after any `npm install` — installs revert the patch.
- The ffmpeg exporter is forced in `project.tsx` settings (`{name: '@revideo/core/ffmpeg', options: {format: 'mp4'}}`). The default wasm exporter is broken on Windows.
- The interactive editor is unusable on Windows. Preview exclusively through renders and extracted frames.

## API constraints

- **One scene per video.** Multiple scenes trigger the multi-scene audio bug (revideo #373). All beats live in a single `makeScene2D('name', function* (view) {...})`.
- **Object API with direct node instances** — `new Rect({...})`, `new Txt({...})`, kept in variables. `createRef` binding fails in this setup ("Cannot read properties of undefined (reading 'opacity')").
- Tweens: `node.prop(target, duration, easing)`; compose with `all`, `delay`, `waitFor`, `spawn`, `loop`. Background loops via `spawn(generator)`, stopped with `cancel(task)` — flags like `alive`/`eyesBusy` arbitrate loops against story moves.
- Reactive bindings work and are the clean way to mirror parts: `armR.rotation(() => -armL.rotation())`.
- Variants (styles, languages) come in through `renderVideo({variables})`, read with `useScene().variables.get('variant', 'default')()`. One scene, N renders.
- Fonts load via a Google Fonts `@import` in `src/global.css`, imported by `project.tsx`.

## Rendering

- `npx tsx render.ts [variant...]` from the project directory. A ~25 s 1080p30 render takes 2–4 minutes; run it in the background.
- ffmpeg 9 removed `-vsync`; use `-fps_mode vfr`.
- Frame extraction and filmstrip recipes live in `qa-loop.md`.
