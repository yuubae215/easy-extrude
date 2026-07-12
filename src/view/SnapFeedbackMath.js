/**
 * SnapFeedbackMath — pure derivation from the grab handler's snap state to a
 * snap-engagement flash descriptor (ADR-065 Phase 2, the last remaining
 * candidate: the "snap engagement flash").
 *
 * WHY THIS CUE EXISTS (#30 one-sentence test): during an auto-snap or
 * stack-mode drag the entity's position jump IS visible, but *whether that
 * jump was a lock* — and the exact point the drag engaged — is invisible
 * outside a small status-bar caption. The flash renders that one invisible
 * fact at its world anchor, at the moment it happens.
 *
 * FACT SOURCE: the snap-lock EVENT itself, not the pose. The grab handler's
 * `snapping/snappedTarget/stacking` flags flip only when the snap system has
 * actually applied the lock to the domain preview — the engagement is a fact
 * that has already happened, regardless of whether the gesture is later
 * confirmed or cancelled. This is distinct from rendering an optimistic
 * *result* (forbidden for landing effects): the flash never claims the move
 * is committed, only that a lock engaged. See the CODE_CONTRACTS row.
 *
 * VOLUME DESIGN: the flash fires on *transitions only* — free→locked
 * (`engage`, full intensity) and locked→other-target (`retarget`, quieter,
 * shorter: the jump between targets is already visible, only the new lock
 * point is news). Holding the same lock across frames fires nothing;
 * disengaging fires nothing (the entity simply follows the cursor again —
 * fully visible). Duration stays in the micro-transition band (≤ 300 ms,
 * machine-tested) because engagement is a high-frequency event.
 *
 * Pure and THREE-free (`node --test`); malformed input → null, honest
 * silence (#11). The view (`SnapFlash.js`) renders descriptors; the per-frame
 * shape comes from `snapFlashFrame` so the curve itself is unit-testable.
 */
import { COLOR, DURATION, hexNumber } from '../theme/tokens.js'
import { clamp01, easeOutCubic, easeOutBack } from './MotionMath.js'

/** Intensity per transition — retarget is deliberately the quieter sibling. */
const INTENSITY = Object.freeze({ engage: 1, retarget: 0.55 })
/** Retarget flashes are shorter: the inter-target jump is already visible. */
const RETARGET_DURATION_SCALE = 0.65

/**
 * Normalize the geometry auto-snap channel (G→V lock onto a vertex/edge/face
 * or a world anchor) into a comparable snapshot.
 *
 * @param {boolean} snapping   handler `state.snapping`
 * @param {{label?: string, type?: string,
 *          position: {x:number,y:number,z:number}}|null|undefined} target
 *   handler `state.snappedTarget`
 * @returns {{key: string, x: number, y: number, z: number}|null}
 *   `null` when not locked or malformed (#11).
 */
export function geometrySnapshot(snapping, target) {
  if (!snapping || !target || typeof target !== 'object') return null
  const p = target.position
  if (!p || ![p.x, p.y, p.z].every(Number.isFinite)) return null
  const name = typeof target.label === 'string' ? target.label : String(target.type ?? '')
  return {
    key: `g:${name}@${p.x.toFixed(4)},${p.y.toFixed(4)},${p.z.toFixed(4)}`,
    x: p.x, y: p.y, z: p.z,
  }
}

/**
 * Normalize the stack-snap channel (bottom face resting on the surface below)
 * into a comparable snapshot. The key quantizes only the landing Z (to the
 * handler's own 1 mm engagement tolerance): sliding along one surface keeps
 * the same key — the "resting at this level" fact is unchanged — while
 * dragging onto a surface at a different height re-fires as a retarget.
 *
 * @param {boolean} stacking  handler `state.stacking`
 * @param {{x:number,y:number,z:number}|null|undefined} contact
 *   handler `state.stackContact` (bottom-face centre at the landing surface)
 * @returns {{key: string, x: number, y: number, z: number}|null}
 */
export function stackSnapshot(stacking, contact) {
  if (!stacking || !contact || ![contact.x, contact.y, contact.z].every(Number.isFinite)) return null
  return { key: `s:${contact.z.toFixed(3)}`, x: contact.x, y: contact.y, z: contact.z }
}

/**
 * Detect the engagement transition between two per-frame snapshots of one
 * channel. Same-key hold and disengagement are silent by the volume design.
 *
 * @param {{key: string}|null|undefined} prev
 * @param {{key: string}|null|undefined} next
 * @returns {'engage'|'retarget'|null}
 */
export function snapTransition(prev, next) {
  if (!next || typeof next.key !== 'string') return null
  if (!prev || typeof prev.key !== 'string') return 'engage'
  return prev.key === next.key ? null : 'retarget'
}

/**
 * Build the flash descriptor for one detected transition.
 *
 * Sizing follows the VoxelBurst precedent (#27): proportional to the grabbed
 * entity's bounding radius with a small floor — a missing/non-finite radius
 * (e.g. an entity whose handles yielded no bounds) spawns nothing rather than
 * guessing a world-unit constant (#11).
 *
 * @param {'geometry'|'stack'} channel  colour vocabulary: geometry lock =
 *   snap orange (`fxSnap`, the status bar's own snap colour), stack landing =
 *   settled green (`fxGreen`)
 * @param {'engage'|'retarget'|null|undefined} transition
 * @param {{x:number,y:number,z:number}|null|undefined} snap  the new snapshot
 * @param {number|null|undefined} entityRadius  grabbed entity bounding radius
 * @returns {{x:number, y:number, z:number, radius:number, color:number,
 *            duration:number, intensity:number}|null} duration in seconds
 */
export function snapFlashDescriptor(channel, transition, snap, entityRadius) {
  if (transition !== 'engage' && transition !== 'retarget') return null
  if (channel !== 'geometry' && channel !== 'stack') return null
  if (!snap || ![snap.x, snap.y, snap.z].every(Number.isFinite)) return null
  if (!Number.isFinite(entityRadius) || entityRadius <= 0) return null
  const base = DURATION.snapFlash / 1000
  return {
    x: snap.x, y: snap.y, z: snap.z,
    radius:    Math.max(entityRadius * 0.4, 0.02),
    color:     hexNumber(channel === 'stack' ? COLOR.fxGreen : COLOR.fxSnap),
    duration:  transition === 'retarget' ? base * RETARGET_DURATION_SCALE : base,
    intensity: INTENSITY[transition],
  }
}

/**
 * Per-frame shape of the flash — the whole animation is this pure curve; the
 * view only composes `{scale, opacity}` per part.
 *
 * Choreography (never a bare linear fade):
 *   - ring: pops with an overshoot-and-settle (easeOutBack — the boundary
 *     moment is the subject, so it gets the settle),
 *   - echo: a second, thinner wavefront starting ~22% later (staggered — the
 *     two fronts never move in unison),
 *   - spark: a centre dot that *contracts* onto the lock point on its own
 *     faster timeline (overlap) — the "click" that marks the exact anchor.
 * Reduced motion: a static held ring at fixed scale/opacity — the information
 * ("a lock engaged here") is preserved, the movement is dropped (#30/#11).
 *
 * @param {number} progress ∈ [0,1]
 * @param {boolean} [reduced]
 * @param {number} [intensity] ∈ [0,1] from the descriptor
 * @returns {{ringScale:number, ringOpacity:number, echoScale:number,
 *            echoOpacity:number, sparkScale:number, sparkOpacity:number}}
 */
export function snapFlashFrame(progress, reduced = false, intensity = 1) {
  const k = Number.isFinite(intensity) ? Math.min(1, Math.max(0, intensity)) : 0
  if (reduced) {
    return { ringScale: 1, ringOpacity: 0.35 * k,
             echoScale: 0, echoOpacity: 0, sparkScale: 0, sparkOpacity: 0 }
  }
  const p = clamp01(progress)
  const ringScale   = 0.25 + 0.75 * easeOutBack(p)
  const ringOpacity = k * (p < 0.2 ? 0.95 : 0.95 * (1 - (p - 0.2) / 0.8))
  const ep          = clamp01((p - 0.22) / 0.78)
  const echoScale   = 0.4 + 1.1 * easeOutCubic(ep)
  const echoOpacity = ep === 0 ? 0 : k * 0.35 * (1 - ep)
  const sp           = clamp01(p / 0.45)
  const sparkScale   = Math.max(1.4 - 1.15 * easeOutCubic(sp), 0.001)
  const sparkOpacity = k * (1 - sp)
  return { ringScale, ringOpacity, echoScale, echoOpacity, sparkScale, sparkOpacity }
}
