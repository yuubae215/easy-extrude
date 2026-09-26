/**
 * graspWire — the grasp request's `target` and `obstacles`, shaped for the wire
 * (contract v7, ADR-152 D4) and converted from the scene's millimetres to the
 * robotics wire's metres (ADR-136) in exactly one place.
 *
 * Everything here is DECLARATION: which samples, which closing axis, how deep,
 * which box. No judgement — whether a jaw closes or a finger hits a wall is
 * `core/`'s (CLAUDE.md AI 向けガード). Pure (no THREE / no DOM).
 *
 * @module domain/graspWire
 */

import { mmToM, mmPointToM } from './worldUnits.js'
import {
  surfaceSamplesFor, graspSpecsFor, sendsDerivedSamples, targetBoxFor,
} from './graspTargets.js'
import { GRASP_FEATURE_STATE } from './graspFeature.js'

/** One sample, mm → m. `normal` is a unit direction and rides unconverted. */
const wireSample = (s) => ({ point: mmPointToM(s.point), normal: s.normal })

/** A box's centre and half-extents are lengths; its orientation is not. */
function wireBox(b) {
  const [hx, hy, hz] = b.halfExtents
  return {
    center: mmPointToM(b.center),
    halfExtents: mmPointToM([hx, hy, hz]),
    orientation: b.orientation,
  }
}

/**
 * One obstacle (a box since ADR-133 D5), mm → m, shape kept. An obstacle of a
 * shape this file does not know THROWS rather than being guessed (原則 #31) —
 * the pre-ADR-152 mapping read every box as a sphere and sent `radius: NaN`.
 *
 * @param {{kind:string, center:[number,number,number], halfExtents?:number[], orientation?:number[], radius?:number}} o  mm
 * @returns {object} wire obstacle, m
 */
export function wireObstacle(o) {
  if (o.kind === 'box') return { kind: 'box', ...wireBox(o) }
  if (o.kind === 'sphere') return { kind: 'sphere', center: mmPointToM(o.center), radius: mmToM(o.radius) }
  throw new Error(`graspWire: 未宣言の障害物種別 "${o.kind}" — 球へ倒すと箱が外接球で判定される`)
}

/**
 * The request's `target` for one grasp target and the declared hand.
 *
 * - `surfaceSamples` — the hand-derived faces (ADR-118). Sent unless specs are
 *   declared; with specs, only for a declared `fallback: 'derived'`.
 * - `graspSpecs` / `strategy` — only when specs are declared (ADR-152 D1/D4),
 *   in priority order and only those this hand can use. `depth` converted.
 * - `box` — the object itself, always (the solver uses it only to measure a
 *   declared closing axis's width; it never becomes an obstacle).
 *
 * @param {import('./graspTargets.js').GraspTarget} target
 * @param {string|null} gripperKind
 * @returns {object}
 */
export function wireTargetFor(target, gripperKind) {
  const wire = {}
  if (sendsDerivedSamples(target.feature)) {
    wire.surfaceSamples = surfaceSamplesFor(target, gripperKind).map(wireSample)
  }
  if (target.feature?.state === GRASP_FEATURE_STATE.DECLARED_SPECS) {
    wire.graspSpecs = graspSpecsFor(target, gripperKind).map(sp => ({
      ...sp,
      samples: sp.samples.map(wireSample),
      ...(sp.depth !== undefined ? { depth: mmToM(sp.depth) } : {}),
    }))
    wire.strategy = { ...target.feature.strategy }
  }
  wire.box = wireBox(targetBoxFor(target))
  return wire
}
