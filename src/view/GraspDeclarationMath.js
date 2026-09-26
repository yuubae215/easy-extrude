/**
 * GraspDeclarationMath — every grasp DECLARATION, turned into the picture that
 * confirms it on the object (ADR-152 D2/D6). Pure and THREE-free: the view
 * (`GraspDeclarationView`) only turns these primitives into meshes, and
 * `node --test` checks the geometry and the census below.
 *
 * ## The rule this module exists to keep (ADR-128 D1, generalised)
 *
 * Input is the panel; confirmation is 3D; and what is drawn are the RESOLVED
 * values — the same local→world resolution the request is built from
 * (`graspTargets.faceRegionSamples`, the spec's closing axis rotated by the
 * object's pose, the hand's declared millimetres) — never the panel's input
 * strings. A picture of the intent could drift from the payload.
 *
 * ## What it never does
 *
 * Judge. Nothing here says "this collides" or "this closes": the fingers are
 * drawn where the declaration puts them, overlapping a wall or not, in the same
 * colours either way (ADR-152: 3D の確認は当たりを色で言わない). Whether they hit
 * is `core/`'s answer, returned on the wire.
 *
 * Units: the scene's (mm). Vectors are `[x, y, z]` arrays.
 *
 * @module view/GraspDeclarationMath
 */

import {
  DECLARABLE_FACES, faceNormalOrThrow, inPlaneAxesOrThrow, faceWorldWord, contactFacesOf,
} from '../domain/graspFeature.js'
import { rotateVec3 } from '../domain/rotateVec3.js'
import { toolParts } from '../domain/robotTool.js'
import { GRIPPER_KIND } from '../context/GraspDeclarationCatalog.js'
import { mmToM, mToMM } from '../domain/worldUnits.js'

const v3 = (o) => [o.x, o.y, o.z]
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k]
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

/** A local axis name → the object's world direction of it. */
function worldAxis(target, axis) {
  const a = { x: 0, y: 0, z: 0 }
  a[axis] = 1
  return v3(rotateVec3(a, target.rotation))
}

/** A local offset → world point on/in the object. */
function toWorld(target, local) {
  return add(v3(target.position), v3(rotateVec3(local, target.rotation)))
}

/**
 * The four world corners of a face region (u,v in 0..1), `inset` mm below the
 * face along its inward normal (0 = on the face — the approach region; depth =
 * the depth plane). Same (u, v) axes as the sampler (`inPlaneAxesOrThrow`), so
 * the outline encloses exactly the grid that is sent.
 */
export function faceRegionCorners(target, face, region, inset = 0) {
  const d = target.dimensions
  const n = faceNormalOrThrow(face)
  const [uAxis, vAxis] = inPlaneAxesOrThrow(face)
  const nAxis = n.x !== 0 ? 'x' : n.y !== 0 ? 'y' : 'z'
  const corner = (u, v) => {
    const local = { x: 0, y: 0, z: 0 }
    local[uAxis] = -d[uAxis] / 2 + d[uAxis] * u
    local[vAxis] = -d[vAxis] / 2 + d[vAxis] * v
    local[nAxis] = n[nAxis] * (d[nAxis] / 2 - inset)
    return toWorld(target, local)
  }
  return [
    corner(region.uMin, region.vMin), corner(region.uMax, region.vMin),
    corner(region.uMax, region.vMax), corner(region.uMin, region.vMax),
  ]
}

const centroid = (pts) => scale(pts.reduce((s, p) => add(s, p), [0, 0, 0]), 1 / pts.length)

/**
 * The picture of a target's grasp declaration.
 *
 * @param {object} args
 * @param {import('../domain/graspTargets.js').GraspTarget} args.target
 * @param {object|null} args.spec   the FOCUSED resolved spec (1 of N — ADR-152 D6)
 * @param {object[]} [args.specs]   all resolved specs (the others get a faint face only)
 * @param {object|null} [args.hand] the resolved hand (mm), or null when undeclared
 * @param {number|null} [args.toolLengthMm] the axial mount, for the hand preview
 * @param {string|null} [args.hoverFace]  the face chip being hovered (painted)
 * @returns {DeclarationPicture}
 */
export function declarationPicture({ target, spec = null, specs = [], hand = null, toolLengthMm = null, hoverFace = null }) {
  const d = target.dimensions
  const extent = Math.max(d.x, d.y, d.z)
  const smallest = Math.min(d.x, d.y, d.z)

  // "+x — where is that?" — six labels at the face centres, a little outside,
  // each with the world word, plus the object's LOCAL triad (it turns with the
  // object, so its misalignment with the world axes is simply visible).
  const faceLabels = DECLARABLE_FACES.map(face => {
    const n = faceNormalOrThrow(face)
    const nAxis = n.x !== 0 ? 'x' : n.y !== 0 ? 'y' : 'z'
    const local = { x: 0, y: 0, z: 0 }
    local[nAxis] = n[nAxis] * (d[nAxis] / 2 + smallest * 0.25)
    return { face, text: faceWorldWord(face, target.rotation).label, position: toWorld(target, local) }
  })
  const triad = {
    origin: v3(target.position),
    axes: [worldAxis(target, 'x'), worldAxis(target, 'y'), worldAxis(target, 'z')],
    length: extent * 0.7,
  }

  const full = { uMin: 0, uMax: 1, vMin: 0, vMax: 1 }
  const hover = hoverFace ? faceRegionCorners(target, hoverFace, full) : null
  const otherApproaches = specs
    .filter(s => s !== spec)
    .map(s => faceRegionCorners(target, s.approach.from, s.approach.region))

  return {
    extent, faceLabels, triad, hover, otherApproaches,
    focused: spec ? focusedPicture(target, spec, hand, toolLengthMm, extent) : null,
  }
}

/** The five facts of one spec (+ the hand on it), as primitives. */
function focusedPicture(target, spec, hand, toolLengthMm, extent) {
  const face = spec.approach.from
  const nWorld = v3(rotateVec3(faceNormalOrThrow(face), target.rotation))
  const approachDir = scale(nWorld, -1)

  // Approach face + region: the outline of the region (the grid inside it is the
  // sample overlay, GraspSampleView). Region centre = where the arrow lands.
  const region = faceRegionCorners(target, face, spec.approach.region)
  const regionCenter = centroid(region)

  // Approach direction: an arrow coming IN, from outside the face to the region
  // centre. Its length is presentation (the object's own extent), not a solver
  // distance — the pre-grasp standoff is core/'s default and not declared here.
  const arrowLength = extent * 0.6
  const arrow = { from: add(regionCenter, scale(nWorld, arrowLength)), to: regionCenter }
  const tilt = spec.approach.tiltTolerance
  const cone = tilt !== null && tilt !== undefined
    ? { apex: regionCenter, axis: nWorld, halfAngle: tilt, length: arrowLength * 0.8 }
    : null

  const jaw = (spec.hand ?? hand?.kind) !== GRIPPER_KIND.SUCTION
  const depth = spec.depth ?? 0

  // Closing axis → the two CONTACT faces (derived, painted striped — distinct
  // from the approach face), and a double arrow across the object at the depth.
  let contact = null
  let closingArrow = null
  let closing = null
  if (jaw && spec.closing) {
    closing = worldAxis(target, spec.closing)
    contact = contactFacesOf(spec.closing).map(f => faceRegionCorners(target, f, { uMin: 0, uMax: 1, vMin: 0, vMax: 1 }))
    const depthCenter = add(regionCenter, scale(approachDir, depth))
    const reach = target.dimensions[spec.closing] / 2 + extent * 0.15
    closingArrow = { a: add(depthCenter, scale(closing, -reach)), b: add(depthCenter, scale(closing, reach)) }
  }

  // Depth: the plane `depth` below the approach face, over the region.
  const depthPlane = jaw && spec.depthDeclared ? faceRegionCorners(target, face, spec.approach.region, depth) : null

  // Hand-dependent pictures — only for a declared hand of the spec's kind.
  const handKind = hand?.kind ?? null
  const tcp = add(regionCenter, scale(approachDir, jaw ? depth : 0))
  let fingers = null
  let cup = null
  if (jaw && handKind === GRIPPER_KIND.PARALLEL_JAW && closing) {
    fingers = fingerSections(tcp, closing, approachDir, hand)
  }
  if (!jaw && handKind === GRIPPER_KIND.SUCTION) {
    cup = {
      center: regionCenter, normal: nWorld, radius: hand.cupDiameter / 2,
      sealHalfAngle: hand.sealTiltTolerance ?? null,
    }
  }

  // The static hand preview: the declared hand, at the region centre, on the
  // declared approach, at the declared depth, jaws across the closing axis —
  // placed exactly as a candidate with zero tilt would place it.
  const preview = handKind && toolLengthMm && (jaw ? handKind === GRIPPER_KIND.PARALLEL_JAW : handKind === GRIPPER_KIND.SUCTION)
    ? handPreview(tcp, approachDir, closing ?? worldAxis(target, inPlaneAxesOrThrow(face)[0]), hand, toolLengthMm)
    : null

  return { region, arrow, cone, contact, closingArrow, depthPlane, fingers, cup, preview }
}

/**
 * The two open fingers' cross-sections on the depth plane (inner faces
 * `maxOpening` apart), and the clearance band `fingerClearance` beyond each.
 * Drawn only when the hand has a SHAPE — no shape, no fingers to show.
 */
function fingerSections(tcp, closing, approachDir, hand) {
  if (!hand?.fingers) return null
  const t = hand.fingers.thickness
  const w = hand.fingers.width
  const across = cross(approachDir, closing)
  const rect = (c, halfA, halfB) => [
    add(add(c, scale(closing, -halfA)), scale(across, -halfB)),
    add(add(c, scale(closing, halfA)), scale(across, -halfB)),
    add(add(c, scale(closing, halfA)), scale(across, halfB)),
    add(add(c, scale(closing, -halfA)), scale(across, halfB)),
  ]
  const off = hand.maxOpening / 2 + t / 2
  const clearance = hand.fingerClearance ?? 0
  return [-1, 1].map(sign => {
    const c = add(tcp, scale(closing, sign * off))
    return {
      section: rect(c, t / 2, w / 2),
      clearance: clearance > 0 ? rect(add(c, scale(closing, -sign * clearance / 2)), t / 2 + clearance / 2, w / 2) : null,
    }
  })
}

/**
 * The declared hand placed with its TCP at `tcp`, the flange frame z along the
 * approach and x along `xAxis` (ADR-150 D5 — the jaws close along flange X).
 * Parts come from `toolParts` — the SAME primitives the arm draws — so the
 * preview cannot show a different hand than the arm carries.
 * @returns {{part:string, shape:string, center:number[], axes:number[][], size:number[]}[]}
 */
export function handPreview(tcp, approachDir, xAxis, hand, toolLengthMm) {
  const z = approachDir
  const x = xAxis
  const y = cross(z, x)
  const flange = sub(tcp, scale(z, toolLengthMm))
  return toolParts(hand, mmToM(toolLengthMm)).map(p => {
    const c = p.center.map(mToMM)
    return {
      part: p.part,
      shape: p.shape,
      center: add(add(add(flange, scale(x, c[0])), scale(y, c[1])), scale(z, c[2])),
      axes: [x, y, z],
      size: p.size.map(mToMM),
    }
  })
}

// ── The census: every declared field has a picture (ADR-152 D6) ───────────────

/**
 * Every field of the grasp declaration → where it is confirmed. Keys are the
 * field's path in the Layout DSL schema (`graspSpec.*`, `graspStrategy.*`,
 * `hand.*`). `picture` names the `declarationPicture` output that draws it, or
 * `'panel'` for the facts whose confirmation is the panel itself (the order of
 * the list, a name). `src/view/GraspDeclarationConfirmation.test.js` enumerates
 * the fields FROM THE SCHEMA and asserts the number of fields missing here is 0 —
 * a field added without a picture fails CI.
 */
export const CONFIRMATION_BY_FIELD = Object.freeze({
  'graspSpec.name':                  { picture: 'panel',       where: 'the spec list (name + rank badge)' },
  'graspSpec.hand':                  { picture: 'preview',     where: 'the hand preview on the object (only the matching hand is drawn)' },
  'graspSpec.approach.from':         { picture: 'faceLabels',  where: 'face labels + local triad; hover paints the face' },
  'graspSpec.approach.region':       { picture: 'region',      where: 'outline of the region on the approach face' },
  'graspSpec.approach.tiltTolerance':{ picture: 'cone',        where: 'cone about the approach arrow' },
  'graspSpec.closing':               { picture: 'contact',     where: 'the two contact faces, striped, + a double arrow' },
  'graspSpec.depth':                 { picture: 'depthPlane',  where: 'translucent plane at the depth below the approach face' },
  'graspStrategy.order':             { picture: 'panel',       where: 'the spec list order + per-spec results' },
  'graspStrategy.fallback':          { picture: 'panel',       where: 'the strategy chips' },
  'hand.kind':                       { picture: 'preview',     where: 'the hand drawn on the arm and on the object' },
  'hand.maxOpening':                 { picture: 'fingers',     where: 'finger cross-sections, inner faces this far apart' },
  'hand.fingerClearance':            { picture: 'fingers',     where: 'clearance band beside each finger section' },
  'hand.cupDiameter':                { picture: 'cup',         where: 'the cup circle on the approach face' },
  'hand.sealTiltTolerance':          { picture: 'cup',         where: 'the seal cone at the cup' },
  'hand.body':                       { picture: 'preview',     where: 'the housing on the arm and in the preview' },
  'hand.fingers':                    { picture: 'preview',     where: 'the fingers on the arm and in the preview' },
  'hand.cupHeight':                  { picture: 'preview',     where: 'the cup on the arm and in the preview' },
})

/** Where a field is confirmed. **Throws on an unregistered field** (原則 #31). */
export function confirmationFor(field) {
  const row = CONFIRMATION_BY_FIELD[field]
  if (!row) {
    throw new Error(`GraspDeclarationMath: "${field}" has no confirming picture — add a row to CONFIRMATION_BY_FIELD (ADR-152 D6)`)
  }
  return row
}

/**
 * @typedef {object} DeclarationPicture
 * @property {number} extent
 * @property {{face:string, text:string, position:number[]}[]} faceLabels
 * @property {{origin:number[], axes:number[][], length:number}} triad
 * @property {number[][]|null} hover
 * @property {number[][][]} otherApproaches
 * @property {object|null} focused
 */
