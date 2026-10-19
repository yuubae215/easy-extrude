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
 * descriptors. The shattering voxels are cut from the entity's own shape and
 * their per-cell curve lives in `ShapeVoxelMath.js` (ADR-166 M5); the curves
 * left here drive the outline construction (`WireframeAssembly`) and the
 * celebration's stagger.
 */
import { COLOR, DURATION, hexNumber } from '../theme/tokens.js'
import { clamp01, easeOutExpo, easeOutQuad } from './MotionMath.js'
import { STAGE_LIGHT } from './StageMath.js'

/**
 * Commands whose apply/undo CREATES or REMOVES an entity. `push` is the
 * transition on push AND redo (redo re-applies); `undo` is its inverse.
 * Label vocabulary is the commands' own `label` fields (src/command/*.js).
 */
const LIFECYCLE_LABELS = [
  { re: /^Add "/,       push: 'appear', undo: 'vanish' }, // AddSolidCommand / AddProfileCommand / AddAnnotationCommand (box add, duplicate, sketch, map placement — ADR-072)
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
 *            color: number, flash: number, duration: number}|null}
 *   `color` is the state tone (the fact: appeared / vanished); `flash` is what
 *   the boundary instant lights toward — the ONE stage light (ADR-166 M4d3),
 *   never a private white.
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
        color: hexNumber(COLOR.factTone),
        flash: hexNumber(STAGE_LIGHT.color),
        duration: DURATION.voxelMaterialize / 1000 }
    : { kind: 'dissolve', direction: 'removed',
        color: hexNumber(COLOR.infoTone),
        flash: hexNumber(STAGE_LIGHT.color),
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
 * Per-voxel timeline offset ∈ [0, STAGGER_SPREAD): the deterministic golden-
 * ratio scatter that turns a lockstep shell into a staggered wave (the anti-
 * vanilla "no simultaneous motion" rule — animation-fx §2). Golden-ratio so
 * adjacent indices (adjacent directions on the fibonacci sphere) do NOT detach
 * together — the ripple reads as spatial, not banded. Replay-identical (no
 * Math.random), same discipline as `voxelJitter`.
 *
 * @param {number} index
 * @returns {number}
 */
export const STAGGER_SPREAD = 0.4
export function voxelDelay(index) {
  return STAGGER_SPREAD * ((index * 0.6180339887) % 1)
}

/**
 * Remap the burst's GLOBAL progress to one voxel's LOCAL progress given its
 * `delay`. Each voxel animates over the window `[delay, delay + (1−SPREAD)]`,
 * so the earliest voxel finishes at global `1−SPREAD` and holds, the latest
 * finishes exactly at global 1 — the whole cloud still lands inside the token
 * duration. (The generalised "0.3/0.7 split" remap from the motion language.)
 *
 * @param {number} progress global progress ∈ [0,1]
 * @param {number} delay from `voxelDelay` (clamped to the spread window)
 * @returns {number} clamped local progress ∈ [0,1]
 */
export function localProgress(progress, delay) {
  const d = Number.isFinite(delay) ? Math.min(Math.max(delay, 0), STAGGER_SPREAD) : 0
  return clamp01((clamp01(progress) - d) / (1 - STAGGER_SPREAD))
}

/**
 * Edge/boundary flash intensity ∈ [0,1] — the "境目こそ主役" accent the view
 * lerps the (shared) material colour toward the descriptor's `flash` (the one
 * stage light — ADR-166 M4d3; it was a private white) by. The flash marks the one
 * instant the transition is legible: for dissolve, the BREAK at t≈0 (the entity
 * cracks apart); for materialize, the ASSEMBLY as the shell lands (~55–90%,
 * the moment the object snaps into being). A single spike each, decayed — never
 * a strobe. Zero under reduced motion (the view skips it). Both slopes are the
 * `fade` role (colour — outQuad): the charge rises as outQuad, the decay reads
 * outQuad from 1 to 0, i.e. (1 − x)² (ADR-166 M4d3 — they were linear ramps).
 *
 * @param {'materialize'|'dissolve'} kind
 * @param {number} progress global progress ∈ [0,1]
 * @returns {number}
 */
export function voxelFlash(kind, progress) {
  const p = clamp01(progress)
  if (kind === 'dissolve') {
    return p < 0.18 ? 1 - easeOutQuad(p / 0.18) : 0     // bright crack at the start
  }
  if (p < 0.55) return 0                                // shell still inbound
  if (p < 0.72) return easeOutQuad((p - 0.55) / 0.17)   // charge as it lands
  if (p < 0.92) return 1 - easeOutQuad((p - 0.72) / 0.20) // flash + decay
  return 0
}

/**
 * Whole-cloud alpha envelope for the shared InstancedMesh material (a single
 * material has a single opacity — per-voxel fade rides scale). Held high, then
 * a soft fade-out over the final 15% so the burst never pops out of existence
 * (the `fade` role — outQuad read 1 → 0; ADR-166 M4d3, was linear).
 *
 * @param {number} progress global progress ∈ [0,1]
 * @returns {number} material opacity ∈ [0, 0.92]
 */
export function voxelEnvelope(progress) {
  const p = clamp01(progress)
  return p < 0.85 ? 0.92 : 0.92 * (1 - easeOutQuad((p - 0.85) / 0.15))
}

/**
 * Size of one assembly spark at its LOCAL progress (`WireframeAssembly` layer 2
 * — the fade rides scale because one shared material has one opacity). It
 * grows on approach with the `land` role (outExpo — the same curve that flies
 * it in) and evaporates after landing with the `fade` role (outQuad read
 * 1 → 0). Before ADR-166 M4d3 the evaporation was a linear ramp.
 *
 * @param {number} lp local progress ∈ [0,1]
 * @returns {number} ∈ [0,1]
 */
export function sparkScale(lp) {
  const p = clamp01(lp)
  if (p < 0.7) return 0.35 + 0.65 * easeOutExpo(p)
  return 1 - easeOutQuad((p - 0.7) / 0.3)
}
