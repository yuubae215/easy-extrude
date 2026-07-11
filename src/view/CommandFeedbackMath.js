/**
 * CommandFeedbackMath — pure derivation from a CommandStack landing to a
 * lifecycle-effect descriptor (ADR-065 Phase 2, revised by the volume design).
 *
 * VOLUME DESIGN (ADR-065 Phase 2 revision, 2026-07-11): a landing effect fires
 * ONLY when an entity APPEARED or VANISHED — the discrete existence transition
 * is the one fact the scene itself does not keep showing (after a delete there
 * is nothing left to look at; after an add the "it just arrived" moment is
 * gone a frame later). Routine pose/geometry operations (Move / Rotate /
 * Face Extrude and their undo/redo) are SILENT: their result is already
 * visible at the anchor, so a same-shaped pulse per operation carries zero
 * information = decoration by the PHILOSOPHY #30 one-sentence test, and reads
 * as noise during modeling.
 *
 * FACT SOURCE (ADR-062 discipline, unchanged): the input is always a
 * *committed* operation — the CommandStack landing notification fired by
 * `push()` (post-hoc recording = the operation has already been applied) and
 * `undo()`/`redo()`. Optimistic previews (live grab/extrude drags) never reach
 * here; neither does the boot-created initial solid or a scene load (the
 * listener attaches after the constructor's `clear()`, and loads push no
 * command — initial load is not a transition).
 *
 * Only *entity-lifecycle labels* yield a descriptor; everything else
 * (pose ops, context/doc commands, links, renames) returns `null` — honest
 * silence, never a guessed celebration (#11).
 *
 * Pure and THREE-free (`node --test`): the view (`LandingEffects.js`) renders
 * descriptors; per-frame shape comes from `voxelFrame` so the animation curve
 * itself is unit-testable.
 */
import { COLOR, DURATION, hexNumber } from '../theme/tokens.js'
import { clamp01, easeOutCubic } from './MotionMath.js'

/**
 * Commands whose apply/undo CREATES or REMOVES an entity. `push` is the
 * transition on push AND redo (redo re-applies); `undo` is its inverse.
 * Label vocabulary is the commands' own `label` fields (src/command/*.js).
 */
const LIFECYCLE_LABELS = [
  { re: /^Add "/,       push: 'appear', undo: 'vanish' }, // AddSolidCommand / AddProfileCommand (box add, duplicate, sketch)
  { re: /^Add Frame "/, push: 'appear', undo: 'vanish' }, // CreateCoordinateFrameCommand (no corners → anchor degrades to silence)
  { re: /^Extrude$/,    push: 'appear', undo: 'vanish' }, // ExtrudeSketchCommand: Profile→Solid swap — the Solid is what (dis)appears
  { re: /^Delete "/,    push: 'vanish', undo: 'appear' }, // DeleteCommand (soft delete)
]

function entryOf(label) {
  for (const entry of LIFECYCLE_LABELS) {
    if (entry.re.test(label)) return entry
  }
  return null
}

/**
 * Derive the lifecycle-effect descriptor for one CommandStack landing.
 *
 * `direction` names which domain-event anchor the effect renders at:
 * `'added'` (the entity that just appeared) or `'removed'` (the entity that
 * just vanished) — the controller captures both from `objectAdded` /
 * `objectRemoved` and feeds the matching one.
 *
 * @param {{phase?: string, label?: string}} [landing]
 * @returns {{kind: 'materialize'|'dissolve', direction: 'added'|'removed',
 *            color: number, duration: number}|null}
 *   `null` for malformed input, a pose/geometry label (silent by the volume
 *   design), or an unrecognised label — no effect, honest silence (#11).
 */
export function lifecycleDescriptor(landing) {
  if (!landing || typeof landing !== 'object') return null
  const { phase, label } = landing
  if (typeof label !== 'string') return null
  if (phase !== 'push' && phase !== 'undo' && phase !== 'redo') return null
  const entry = entryOf(label)
  if (!entry) return null
  const transition = phase === 'undo' ? entry.undo : entry.push
  return transition === 'appear'
    ? { kind: 'materialize', direction: 'added',
        color: hexNumber(COLOR.fxGreen),
        duration: DURATION.voxelMaterialize / 1000 }
    : { kind: 'dissolve', direction: 'removed',
        color: hexNumber(COLOR.accentActive),
        duration: DURATION.voxelDissolve / 1000 }
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
 * Per-frame shape of one lifecycle voxel. The whole animation is this pure
 * curve; the view only composes `{dist, opacity, scale, spin}` into instance
 * matrices.
 *
 * Motion allowed:
 *   - dissolve: fragments fly outward (dist 0.15 → 1), tumble, shrink, fade —
 *     the entity shatters into voxels that evaporate (the "SAO" scatter).
 *   - materialize: the exact reverse — a voxel shell converges onto the entity
 *     (dist 1 → 0.1), grows, then evaporates revealing the real object
 *     (which is already standing underneath).
 * Reduced motion: a static held cue — a frozen mid-transition shell, low
 * opacity — information preserved ("an entity just appeared/vanished here"),
 * movement dropped (#30/#11).
 *
 * @param {'materialize'|'dissolve'} kind
 * @param {number} progress ∈ [0,1]
 * @param {boolean} [reduced]
 * @returns {{dist: number, opacity: number, scale: number, spin: number}}
 */
export function voxelFrame(kind, progress, reduced = false) {
  if (reduced) {
    return kind === 'dissolve'
      ? { dist: 0.55, opacity: 0.4, scale: 0.8, spin: 0 }
      : { dist: 0.35, opacity: 0.4, scale: 0.8, spin: 0 }
  }
  const p = clamp01(progress)
  const eased = easeOutCubic(p)
  if (kind === 'dissolve') {
    return {
      dist:    0.15 + 0.85 * eased,
      opacity: p < 0.35 ? 0.9 : 0.9 * (1 - (p - 0.35) / 0.65),
      scale:   1 - 0.6 * p,
      spin:    2.4 * eased,
    }
  }
  // materialize
  return {
    dist:    1 - 0.9 * eased,
    opacity: p < 0.3 ? 0.9 * (p / 0.3) : p < 0.75 ? 0.9 : 0.9 * (1 - (p - 0.75) / 0.25),
    scale:   0.5 + 0.5 * eased,
    spin:    -1.6 * eased,
  }
}

/**
 * Deterministic per-voxel radius jitter ∈ [0.55, 1) — breaks the perfect
 * sphere shell into a voxel-cloud silhouette without Math.random (a replayed
 * effect looks identical; tests stay reproducible).
 *
 * @param {number} index
 * @returns {number}
 */
export function voxelJitter(index) {
  return 0.55 + 0.45 * ((index * 0.6180339887) % 1)
}

/**
 * Deterministic glitch flicker gate for the materialize shell: a per-voxel
 * square wave that momentarily collapses some voxels' scale (InstancedMesh
 * shares one material, so flicker rides scale, not opacity). Returns 1 (shown)
 * or 0.25 (glitch-dimmed). Never used under reduced motion (the static held
 * cue does not flicker).
 *
 * @param {number} index
 * @param {number} progress ∈ [0,1]
 * @returns {number}
 */
export function glitchGate(index, progress) {
  const step = Math.floor(clamp01(progress) * 24)
  return ((index * 7 + step) % 6) === 0 ? 0.25 : 1
}
