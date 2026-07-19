/**
 * tokens.js — design tokens: the single source for the UI's colour, duration,
 * easing, and z-index vocabulary (ADR-065 Phase 0).
 *
 * GOVERNANCE (核 §1.1 / ADR-065 named rule 3): before this module the colour
 * vocabulary was shared only by repetition — the same hex literals copied into
 * ~30 components (an implicit second source). This module retires that habit:
 *   - The palette table in `docs/LAYOUT_DESIGN.md` § Color Palette is pinned
 *     equal to `COLOR` by the drift test in `src/theme/tokens.test.js`
 *     (same mechanism as the ADR-064 schema/constant drift tests — never
 *     re-list the vocabulary as a third source).
 *   - Opportunistic migration rule: any line you TOUCH that carries a hex
 *     literal present in this palette must be rewritten to consume the token.
 *     No big-bang rewrite; untouched lines keep their literals until touched.
 *
 * Pure and THREE-free: values are plain strings/numbers so the module runs in
 * the bare `node --test` lane and can be imported by pure math modules.
 */

/** UI colour palette. Keys are pinned to docs/LAYOUT_DESIGN.md § Color Palette. */
export const COLOR = Object.freeze({
  // Chrome
  bgPanel:       '#242424',
  bgSecondary:   '#2b2b2b',
  bgButton:      '#383838',
  border:        '#4a4a4a',
  textPrimary:   '#e0e0e0',
  textSecondary: '#888888',
  accentSoft:    '#3d3d6b',
  accent:        '#5c5cff',
  danger:        '#c04040',
  success:       '#3a7a3a',
  // Chrome — active tool / indicator cyan (mobile toolbar, ADR-065 Phase 3)
  accentActive:  '#4fc3f7',
  // 3D scene accents
  measure:       '#f5a623',
  axisX:         '#e05252',
  axisY:         '#52e052',
  axisZ:         '#5252e0',
  // Proof-feedback / landing-effect family (ADR-062 flash tones, ADR-065 Phase 2)
  fxGreen:       '#22c55e',
  fxAmber:       '#d5a23a',
  fxBlue:        '#3a7bd5',
  fxReveal:      '#10b981',
  fxSnap:        '#ff9800',
})

/** Motion durations in milliseconds (DOM) — 3D effects use seconds; convert at the view. */
export const DURATION = Object.freeze({
  flash:      700,   // proof-feedback landing flash (FeedbackMath.flashStyle)
  toastIn:    150,
  toastOut:   300,
  drawer:     200,
  ripple:     600,   // 3D link-acceptance ripple (RippleEffect)
  voxelMaterialize: 640, // ADR-065 Phase 2 (volume revision) entity-appear voxel shell — staggered convergence + assembly flash
  voxelDissolve:    860, // ADR-065 Phase 2 (volume revision) entity-vanish voxel scatter — the loudest lifecycle cue (#30 corollary)
  press:        90,   // ADR-065 Phase 3 press-down (Tier A)
  pressRelease: 260,  // ADR-065 Phase 3 spring-back on release (Tier A)
  hover:        150,  // ADR-065 Phase 3 hover ease
  breathe:      2600, // ADR-065 Phase 3 active-tool breathing glow cycle
  chromeEnter:  180,  // ADR-065 Phase 3 toast / hint entry slide-fade
  celebration:  1600, // ADR-065 Phase 4 celebration burst (DOM banner + 3D field)
  regionResolve: 700, // ADR-065 Phase 5 region-conflict resolve: recolor → dissolve (3D)
  snapFlash:     260, // ADR-065 Phase 2 snap engagement flash (micro band ≤300 — machine-tested)
  bootReveal:   1800, // ADR-067 boot camera fly-in (Tier D — one occasion per session)
  cameraFocus:   620, // ADR-068 focus/frame fly-to-selection (interruptible; user always wins)
  selectPulse:   360, // ADR-068 selection "tap" outline pulse (overlay-only, entity-sized)
  popoverEnter:  150, // ADR-080 Phase 1 popover/menu scale-fade entry (Tier A)
  menuStagger:    24, // ADR-080 Phase 1 per-item entry delay step (anti-lockstep)
})

/** CSS easing vocabulary for DOM animations. */
export const EASING = Object.freeze({
  out:   'ease-out',
  inOut: 'ease-in-out',
  // Overshoot-and-settle curve — the CSS form of MotionMath.easeOutBack,
  // used for the Tier A press-release spring (ADR-065 Phase 3).
  spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
})

/**
 * z-index tiers (explicit stacking contract — CODE_CONTRACTS §3
 * "Three.js Canvas Must Mount in #canvas-container", PHILOSOPHY #26).
 */
export const Z = Object.freeze({
  canvas:     0,
  gizmo:      10,
  sceneLabel: 50,
  edgePanel:  90,
  overlay:    100,
  modal:      300,
})

/**
 * `#rrggbb` → numeric colour for THREE.js material/`setHex` consumers.
 * @param {string} hex
 * @returns {number}
 */
export function hexNumber(hex) {
  return parseInt(hex.slice(1), 16)
}

/**
 * `#rrggbb` + alpha → `rgba(r,g,b,a)` string, so alpha variants of a palette
 * colour are derived from the token instead of a hand-copied rgba literal.
 * @param {string} hex
 * @param {number} alpha
 * @returns {string}
 */
export function rgba(hex, alpha) {
  const n = hexNumber(hex)
  return `rgba(${(n >> 16) & 0xff},${(n >> 8) & 0xff},${n & 0xff},${alpha})`
}
