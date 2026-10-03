# screencast — declarative screen recordings on virtual time

Write *what happens* as a JSON scenario; get a smooth GIF / MP4 / WebM of the real
app, with an animated cursor, key HUD, lower-third captions, title cards and a
virtual camera. Design record: [ADR-160](../../docs/adr/ADR-160-screencasts-are-declared-scenarios-recorded-on-virtual-time.md).

```bash
pnpm screencast validate tools/screencast/scenarios/hero-sketch-extrude.screencast.json
pnpm screencast plan     tools/screencast/scenarios/hero-sketch-extrude.screencast.json   # timeline, no browser
pnpm screencast record   tools/screencast/scenarios/hero-sketch-extrude.screencast.json --stills 2500,7000
pnpm screencast record   tools/screencast/scenarios/hero-sketch-extrude.screencast.json   # full render + encode
pnpm test:screencast     # schema ⇄ registry drift, macros, planner (no browser)
```

Needs Chromium (Playwright) and `ffmpeg` on PATH. The dev server is started for you
if `app.url` does not answer and `app.server` is declared.

## Why virtual time

The page clock (`Date`, timers, `requestAnimationFrame`) is installed by
`page.clock` and advanced **exactly 1/fps per frame**. A software-rendered WebGL
page that needs a second to draw a frame still produces a perfect 30 fps video,
and every run is frame-identical. Cost: ≈1 s of wall time per frame here
(15 s video ≈ 10 min). Use `--stills` to review composition in minutes.

## Layout

```
tools/screencast/
  schema/screencast-1.0.schema.json   the contract (scenario + library)
  src/dsl.mjs        shape check, macro expansion, defaults        PURE
  src/plan.mjs       schedule + frameState(t)                       PURE
  src/actions.mjs    core action registry (pure parts + begin/tick)
  src/ease.mjs       easing catalog (pinned to the schema enum)
  src/overlay.browser.js  in-page view (shadow DOM) — applies numbers only
  src/runner.mjs     browser on virtual time, capture               IMPURE
  src/encode.mjs     ffmpeg lanes (gif palette / h264 / vp9)
  library/           macro libraries (screencast-library/1.0)
  plugins/           x-* action plugins (example: page-eval)
  scenarios/         scenarios (screencast/1.0)
```

## The document

Three layers that never borrow each other's fields:

| Layer | Field | Question |
|---|---|---|
| WHAT | `steps`, `macros`, `imports` | what happens |
| HOW IT LOOKS | `style` | accent colour, cursor, key HUD, caption placement |
| WHERE | `outputs` | gif / mp4 / webm, width, fps, quality |

plus `app` (url, server, viewport, `storage` seeded into localStorage, `css`,
`ready` target, `probes`) and `capture` (`fps`, `pace`, `format`).

### Steps — closed union on `do`

Every step accepts `note` (never rendered), `async` (next step starts at this
step's start) and `label` (shown as a HUD chip).

| `do` | Fields | Default duration | Notes |
|---|---|---|---|
| `title` | `text`, `sub`, `backdrop` (`blur`/`solid`/`none`), `enter`, `exit` | 2000 | full-frame card; `enter:false`/`exit:false` make a loop seam / poster frame |
| `caption` | `text` (null clears), `index` | 0, async | lower-third; lives until the next caption |
| `move` | `to`, `ease`, `arc` | 650 | cursor travels on a bowed curve |
| `click` | `target`, `button`, `ease`, `arc` | 700 | travel → 90 ms press → settle; ripple on press |
| `drag` | `from?`, `to`, `button`, `ease`, `arc`, `hideCursor` | 1400 | press, stroke, beat of stillness, release |
| `key` | `keys` (Playwright chord), `show` | 500 | chord shown as keycaps |
| `type` | `text`, `perCharMs`, `show` | n×85+250 | |
| `wait` | `duration` | — | |
| `focus` | `zoom` (1 = full), `target?`, `ease` | 1000, async | virtual camera (crop); clamps inside the frame |
| `use` | `macro`, `with` | — | expands in place |
| `x-<ns>/<name>` | plugin-defined | plugin | the only extension point |

### Targets — exactly one locator (+ optional `offset: [dx, dy]`)

`{text, exact?, nth?, within?}` · `{role, name?}` · `{selector}` ·
`{viewport: [fx, fy]}` · `{canvas: [fx, fy], selector?}` ·
`{world: [x, y, z]}` (needs `app.probes.worldToScreen`) · `{relative: [dx, dy]}`
(from the cursor; inside `drag.to`, from the drag start).

Prefer `world` for 3D work: it survives camera changes that would silently move a
`canvas` fraction onto something else.

## Ecosystem

- **Macros** — `"macros": { "ns/name": { "params": {"p": null, "q": 3}, "steps": [...] } }`.
  `null` = required. `"${p}"` as a whole value keeps its type (arrays, numbers);
  inside a longer string it interpolates. Steps are schema-checked *after* expansion,
  so a bad argument is caught with the call site in the error (`[6.ee/add.1]`).
- **Libraries** — documents with `"version": "screencast-library/1.0"` holding only
  `macros`; scenarios list them in `imports`. App-specific gestures live there once
  (`library/easy-extrude.screencast.json`), so a UI change is fixed in one place.
- **Plugins** — ES modules exporting `actions: ActionDef[]` with kind
  `x-<namespace>/<name>` and a JSON Schema for their payload. See
  `plugins/page-eval.mjs`. An undeclared `x-*` kind fails at load.
- **Versioning** — adding a kind or field is a minor bump (`1.x`); changing or
  removing meaning is a major bump. The schema enums are pinned to the code by
  `test/dsl.test.mjs`.
- **Editor support** — put `"$schema": "../schema/screencast-1.0.schema.json"` at
  the top for completion and inline validation.

### ActionDef

```js
{
  kind: 'x-ns/name',
  schema: { /* JSON Schema of the step */ },
  async: false,                              // default blocking
  duration(step, style) { return 600 },      // pure — drives the schedule
  async begin(rt, step) { return resolved }, // impure — rt.page, rt.resolve(target), rt.cursor()
  async tick(rt, step, resolved, ms) {},     // impure, each frame while active
  pointer(step, resolved, ms, dur) {},       // pure → {x, y, down, button, hidden}
  overlay(step, resolved, ms, dur, ctx) {},  // pure → {chips, ripples, caption, title}
  camera(step, resolved, ms, dur, fromClip, viewport) {}, // pure → clip
}
```
