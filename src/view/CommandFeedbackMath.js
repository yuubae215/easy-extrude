/**
 * CommandFeedbackMath — pure derivation from a CommandStack landing to a
 * landing-effect descriptor (ADR-065 Phase 2, the core-modeling flagship).
 *
 * FACT SOURCE (ADR-062 discipline, unchanged): the input is always a
 * *committed* operation — the CommandStack landing notification fired by
 * `push()` (post-hoc recording = the operation has already been applied) and
 * `undo()`/`redo()`. Optimistic previews (live grab/extrude drags) never reach
 * here; neither does the boot-created initial solid (the listener attaches
 * after the constructor's `clear()` — initial load is not a transition).
 *
 * Only *recognised core-modeling labels* yield a descriptor; everything else
 * (context/doc commands, links, renames, class changes) returns `null` — those
 * surfaces own their own ADR-062 feedback, and a fabricated pulse at the wrong
 * anchor would be dishonest (#11: degrade to nothing, never guess).
 *
 * Pure and THREE-free (`node --test`): the view (`LandingEffects.js`) renders
 * descriptors; per-frame shape comes from `pulseFrame` so the animation curve
 * itself is unit-testable.
 */
import { COLOR, DURATION, hexNumber } from '../theme/tokens.js'
import { clamp01, easeOutCubic, easeOutBack } from './MotionMath.js'

/**
 * Landing kinds for recognised core-modeling command labels.
 * Label vocabulary is the commands' own `label` fields (src/command/*.js).
 *  - spawn:  something new appeared (Add solid/frame, sketch extrude, face extrude)
 *  - settle: an existing entity landed at a new pose (move / rotate)
 */
const LABEL_KINDS = [
  // vanishesOnUndo: undoing this command REMOVES the entity — there is no
  // honest anchor left, so the undo phase renders nothing (a rewind pulse at
  // whatever object becomes active instead would be a fabricated signal, #11).
  { re: /^Add "/,          kind: 'spawn', vanishesOnUndo: true },  // AddSolidCommand (box add, duplicate)
  { re: /^Add Frame "/,    kind: 'spawn', vanishesOnUndo: true },  // CreateCoordinateFrameCommand
  { re: /^Extrude$/,       kind: 'spawn'  },   // ExtrudeSketchCommand (undo swaps back to the Profile — anchor survives)
  { re: /^Face Extrude$/,  kind: 'spawn'  },   // FaceExtrudeHandler command (undo retracts the face)
  { re: /^Move( |$)/,      kind: 'settle' },   // MoveCommand ('Move' / 'Move N objects')
  { re: /^Rotate (Solid|Frame)$/, kind: 'settle' },
]

function entryOf(label) {
  for (const entry of LABEL_KINDS) {
    if (entry.re.test(label)) return entry
  }
  return null
}

/**
 * Derive the effect descriptor for one CommandStack landing.
 *
 * @param {{phase?: string, label?: string}} [landing]
 * @returns {{kind: 'spawn'|'settle'|'rewind'|'replay', color: number,
 *            expand: 1|-1, overshoot: boolean, duration: number}|null}
 *   `null` for malformed input or an unrecognised label (no effect — honest
 *   silence, not a guessed celebration).
 */
export function landingDescriptor(landing) {
  if (!landing || typeof landing !== 'object') return null
  const { phase, label } = landing
  if (typeof label !== 'string') return null
  if (phase !== 'push' && phase !== 'undo' && phase !== 'redo') return null
  const entry = entryOf(label)
  if (!entry) return null
  const kind = entry.kind
  const sec = ms => ms / 1000
  if (phase === 'undo') {
    if (entry.vanishesOnUndo) return null
    // Rewind cue: a CONTRACTING amber pulse — visually "time flowed backwards".
    return { kind: 'rewind', color: hexNumber(COLOR.fxAmber), expand: -1, overshoot: false, duration: sec(DURATION.landingSettle) }
  }
  if (phase === 'redo') {
    return { kind: 'replay', color: hexNumber(COLOR.fxBlue), expand: 1, overshoot: false, duration: sec(DURATION.landingSettle) }
  }
  return kind === 'spawn'
    ? { kind: 'spawn',  color: hexNumber(COLOR.fxGreen), expand: 1, overshoot: true,  duration: sec(DURATION.landingPop) }
    : { kind: 'settle', color: hexNumber(COLOR.fxBlue),  expand: 1, overshoot: false, duration: sec(DURATION.landingSettle) }
}

/**
 * Bounding anchor of a point cloud (entity world corners): centre = midpoint
 * of the axis-aligned min/max (NOT the centroid average — display-only here,
 * but the min/max midpoint is scale-stable), radius = half diagonal.
 *
 * @param {Array<{x:number,y:number,z:number}>|null|undefined} points
 * @returns {{center: {x:number,y:number,z:number}, radius: number}|null}
 *   `null` when points are missing/malformed (#11: the caller spawns nothing).
 */
export function boundsOf(points) {
  if (!Array.isArray(points) || points.length === 0) return null
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (const p of points) {
    if (!p || ![p.x, p.y, p.z].every(Number.isFinite)) return null
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.z < minZ) minZ = p.z
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
    if (p.z > maxZ) maxZ = p.z
  }
  const dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ
  return {
    center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 },
    radius: Math.sqrt(dx * dx + dy * dy + dz * dz) / 2,
  }
}

/**
 * Per-frame shape of a landing pulse. The whole animation is this pure curve;
 * the view only applies `{scale, opacity}` to its overlay mesh.
 *
 * Motion allowed:
 *   - expand +1: scale grows 0.4 → 1.6 (spawn uses the overshooting back-ease
 *     = the "pop"), opacity fades 0.85 → 0.
 *   - expand −1 (rewind): scale CONTRACTS 1.6 → 0.4, same fade.
 * Reduced motion: a static cue — fixed scale 1, fixed low opacity — held for
 * the descriptor's duration (information preserved, movement dropped).
 *
 * @param {{expand: 1|-1, overshoot: boolean}} desc
 * @param {number} progress ∈ [0,1]
 * @param {boolean} [reduced]
 * @returns {{scale: number, opacity: number}}
 */
export function pulseFrame(desc, progress, reduced = false) {
  if (reduced) return { scale: 1, opacity: 0.35 }
  const p = clamp01(progress)
  const eased = desc.overshoot ? easeOutBack(p) : easeOutCubic(p)
  const scale = desc.expand === -1
    ? 1.6 - 1.2 * eased
    : 0.4 + 1.2 * eased
  return { scale: Math.max(scale, 0.01), opacity: 0.85 * (1 - p) }
}
