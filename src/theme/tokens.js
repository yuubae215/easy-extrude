/**
 * tokens.js — design tokens: the single source for the UI's colour, duration,
 * easing, and z-index vocabulary (ADR-065 Phase 0, governed by ADR-100).
 *
 * GOVERNANCE (核 §1.1):
 *   - VOCABULARY (ADR-065 Phase 0): the palette table in
 *     `docs/LAYOUT_DESIGN.md` § Color Palette is pinned equal to `COLOR` by the
 *     drift test in `src/theme/tokens.test.js` — neither side may grow alone.
 *   - USAGE (ADR-100): the same strength of guarantee now covers *use*. The old
 *     rule here was "migrate any line you TOUCH", which is a rule nobody is ever
 *     asked at the moment of writing, so the ~400 untouched lines were never
 *     going to move. It is replaced by a machine question: `tokens.test.js`
 *     counts the hex literals that live OUTSIDE this vocabulary and fails when
 *     that count goes UP (a ratchet — 憲法 Q3, 原則 #31).
 *
 * NAMES ARE ROLES, NOT VALUES (ADR-100 Decision 1). `fxGreen` could not survive
 * its own colour changing; `factTone` can. A token named after its hue is the
 * same second source as a copied literal — it stops tracking meaning the moment
 * meaning moves.
 *
 * SATURATION IS SPENT ON STATE (ADR-100 G1). `entityDefault` is neutral so that
 * "carries colour" and "carries meaning" are the same set on screen. The ground
 * (backdrop, grid) stays as ADR-067 tuned it; it is the FIGURE that moved to
 * neutral, not the ground.
 *
 * ONE MEANING, ONE COLOUR (ADR-100 G2/Decision 3). `accent` is the only colour
 * for "this is what you are operating on" — selection, active tool, focus. It
 * replaced four (Outliner salmon, `accent` blue-violet, indicator cyan, origin
 * gold). The reverse rule holds too: two meanings never share a hue, which
 * `COLOR_RULES.minHueSeparationDeg` enforces over `STATE_TOKENS`.
 *
 * Pure and THREE-free: values are plain strings/numbers so the module runs in
 * the bare `node --test` lane and can be imported by pure math modules.
 */

/**
 * UI colour palette. Keys are pinned to docs/LAYOUT_DESIGN.md § Color Palette.
 *
 * Every entry is a ROLE. If you need a colour whose role is not here, the
 * question to answer first is "what state does it report?" — not "which hue
 * looks right". A colour with no state to report should be neutral.
 */
export const COLOR = Object.freeze({
  // ── Chrome surfaces (the ground: no state, no saturation budget) ──────────
  surface:       '#242424',
  surfaceSunken: '#2b2b2b',
  surfaceRaised: '#383838',
  border:        '#4a4a4a',
  textPrimary:   '#e0e0e0',
  // Lifted from #888888 (ADR-100): at 4.38 : 1 on `surface` it missed WCAG AA,
  // and the contrast check added by this ADR is the thing that asked.
  textSecondary: '#9a9a9a',

  // ── Scene ground (ADR-067 boot atmosphere — values unchanged, only named) ──
  // Tokenised so the contrast check can ask "is the figure separable from the
  // ground?" without re-typing the gradient stops as a second source (§1.1).
  backdropTop:   '#262a4a',
  backdropMid:   '#1a1a2e',
  backdropDeep:  '#0e0e18',
  gridMajor:     '#444466',
  gridMinor:     '#222244',

  // ── The figure: an entity with nothing to report is neutral (G1) ──────────
  entityDefault: '#b9bcc0',

  // ── "This is what you are operating on" — exactly one colour (G2) ─────────
  accent:        '#ff7d2e',
  accentSoft:    '#4a2c18',   // same hue, low strength: selected-row ground

  // ── State tones (renamed from the fx* family — ADR-062/047 meanings kept) ──
  factTone:      '#22c55e',   // was fxGreen  — a result is settled
  cautionTone:   '#d9b23c',   // was fxAmber  — seed / example / take care
  infoTone:      '#3a7bd5',   // was fxBlue   — a decision landed
  revealTone:    '#0dbd97',   // was fxReveal — something came into view
  snapTone:      '#a86ceb',   // was fxSnap   — a constraint engaged
  dangerTone:    '#c04040',   // was danger   — destructive
  successTone:   '#3a7a3a',   // was success  — confirmed

  // Measurement. Declared #f5a623 while the code drew #f9a825 in 13 places —
  // one meaning with two sources (§1.1). Both are retired: amber sat 15° from
  // the new accent, and a measurement is not a selection.
  measure:       '#1fb6d6',

  // ── Reserved by external convention (ROS REP-103) — never re-tuned here ────
  axisX:         '#e05252',
  axisY:         '#52e052',
  axisZ:         '#5252e0',

  // ── Atmosphere, not state (ADR-067): the stage glow and rim light ─────────
  // This is the half of the retired `accentActive` that was never saying
  // "active" — it was saying "the stage is lit". Splitting it out is what let
  // the other half collapse into `accent`.
  stageGlow:     '#4fc3f7',
})

/**
 * Tokens that answer "what state is this?" — the set over which "two meanings
 * never share a hue" is enforced (ADR-100 Decision 3).
 *
 * DECLARED EXCLUSIONS, and why each is not an oversight (原則 #29: every entry
 * is either governed or explicitly out of scope — an unlisted token would make
 * the rule quietly weaker):
 *   - chrome surfaces / text / `entityDefault` — neutral by construction; a
 *     hue with no saturation behind it separates nothing.
 *   - `backdrop*` / `grid*` — the ground. G1's whole claim is that the ground
 *     reports no state, so it has no meaning to collide with.
 *   - `accentSoft` — the SAME meaning as `accent` at lower strength. It shares
 *     `accent`'s hue on purpose; that is the rule working, not breaking.
 *   - `axis*` — the source is an external convention (ROS REP-103), not us.
 *   - `stageGlow` — atmosphere, not state (see above).
 */
export const STATE_TOKENS = Object.freeze([
  'accent', 'measure',
  'factTone', 'cautionTone', 'infoTone', 'revealTone', 'snapTone',
  'dangerTone', 'successTone',
])

/**
 * The numeric thresholds the palette is judged against (ADR-100 Consequences).
 *
 * They live beside the values they judge rather than inside the test, so that
 * changing a threshold is as visible as changing a colour. `colorMath.js` owns
 * the predicates; `tokens.test.js` only asks.
 */
export const COLOR_RULES = Object.freeze({
  /** HSL saturation at or below which a colour counts as neutral (G1). */
  neutralMaxSaturation: 0.12,
  /**
   * Minimum circular hue distance between any two `STATE_TOKENS`, in degrees.
   * The wheel is crowded — today's tightest pair (`successTone` ↔ `factTone`)
   * sits at ~22°, so this budget is nearly spent. A new state colour is
   * therefore a deliberate act: it must find ~20° of clear wheel, or displace
   * an existing meaning. That is the intended cost.
   */
  minHueSeparationDeg: 20,
  /** WCAG AA for text and for the accent that has to be read as a label. */
  minTextContrast: 4.5,
  /** WCAG AA for non-text UI: the entity body against the scene it sits in. */
  minEntityContrast: 3.0,
})

/**
 * Chrome grounds that text and accent are actually drawn on.
 *
 * Declared as PAIRINGS rather than a cross product: `textSecondary` on
 * `surfaceRaised` is 4.17 : 1 and is not a pairing the UI makes — asserting the
 * full cross product would force secondary text light enough to stop being
 * secondary. Naming the real pairings keeps the check honest instead of
 * loosening the threshold for everyone (原則 #31: declare the exception,
 * don't dilute the rule).
 */
export const CONTRAST_PAIRINGS = Object.freeze({
  textPrimary:   ['surface', 'surfaceSunken', 'surfaceRaised'],
  textSecondary: ['surface', 'surfaceSunken'],
  accent:        ['surface', 'surfaceSunken', 'surfaceRaised'],
})

/** Scene grounds the entity body must stay separable from (ADR-100 G1). */
export const SCENE_GROUNDS = Object.freeze([
  'backdropTop', 'backdropMid', 'backdropDeep', 'gridMajor', 'gridMinor',
])

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

/**
 * `#rrggbb` scaled toward black — the derived form for emissive/tint strengths.
 *
 * Exists so a "dim accent" is a FUNCTION of `accent` rather than a second hex
 * that stops tracking it (§1.1). `MeshView`'s selected/hover emissive is the
 * motivating caller: those used to be `#112244` and `#0a1522`, two literals
 * that silently kept pointing at the retired cyan.
 *
 * @param {string} hex
 * @param {number} factor  0 = black, 1 = unchanged
 * @returns {string} `#rrggbb`
 */
export function dim(hex, factor) {
  const n = hexNumber(hex)
  const scale = c => Math.max(0, Math.min(255, Math.round(c * factor)))
  const r = scale((n >> 16) & 0xff)
  const g = scale((n >> 8) & 0xff)
  const b = scale(n & 0xff)
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}
