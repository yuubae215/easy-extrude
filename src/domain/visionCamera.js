/**
 * visionCamera (domain) — the vision camera as a SCENE ENTITY (ADR-164 D3).
 *
 * ## What a camera is
 *
 * A CoordinateFrame that carries a `camera` declaration. Its pose is the frame's
 * own pose (position + rotation — moved with G / R like any frame, parentable
 * like any frame), and the declaration holds the one fact the pose does not:
 * how wide it sees — `fovHalfAngles: { horizontal, vertical }` (radians, the half
 * angles across the image's width and height). The same shape as a tcp's `hand`
 * (ADR-152 D3) and as ROS, where a camera IS a TF frame. Before this the camera
 * was a card of React state in the grasp panel, belonging to no entity (DEF-033).
 *
 * ## Which way it looks — the ROS optical frame (当事者判断 2026-10-11)
 *
 * `+Z` of the frame is the line of sight, `+X` is image-right and `+Y` is
 * image-down (REP-103 `*_optical_frame`). The wire's `viewAxis` is DERIVED from
 * the frame's world rotation (`CAMERA_VIEW_AXIS_LOCAL`), never stored beside
 * it — a stored world vector next to a rotation would be a second source that
 * goes stale the first time the camera is rotated (§1.1).
 *
 * ## What is drawn is what is judged — a rectangle (ADR-171, closes DEF-061)
 *
 * The viewport draws a rectangular frustum and `core/` judges the same
 * four-sided pyramid: the wire carries `fovHalfAngles` + `imageUp` (the world
 * direction of image-up, DERIVED from the frame's rotation like `viewAxis`).
 * Until ADR-171 the wire had one half angle and the solver judged a cone, so the
 * four corners were drawn but not judged.
 *
 * A camera written before ADR-171 declares one number, `fovHalfAngle: a`. It is
 * READ as the square `{ horizontal: a, vertical: a }` — exactly the square that
 * was always drawn for it — and every writer writes the two-angle form. Both
 * fields on one camera is malformed (two answers to one question).
 *
 * ## Cardinality (原則 #31)
 *
 * `0..N` cameras. 0 is the default and legal — the search does not ask "can it
 * be seen" (the wire omits `camera`, the visibility stage passes everything).
 * 1 is used implicitly. N needs an explicit pick (the robot picker's shape —
 * ADR-090 D3); until then Run has a gap. Existence IS the declaration that
 * visibility is asked: there is no second on/off switch (当事者判断).
 *
 * Units: the scene's (mm, ADR-136); the wire is metres — converted here, once.
 * Pure (no THREE / no DOM): node --test, the controller and the view read the
 * same numbers.
 *
 * @module domain/visionCamera
 */

import { mmToM } from './worldUnits.js'
import { rotateVec3 } from './rotateVec3.js'

/** The frame-local line of sight — ROS optical frame (+Z forward, +Y down). */
export const CAMERA_VIEW_AXIS_LOCAL = Object.freeze({ x: 0, y: 0, z: 1 })

/** The frame-local image-up direction (optical +Y is DOWN). */
export const CAMERA_IMAGE_UP_LOCAL = Object.freeze({ x: 0, y: -1, z: 0 })

/** Resolved state of a camera declaration. There is no "undeclared" camera: without the declaration the frame is not a camera. */
export const CAMERA_STATE = Object.freeze({
  DECLARED:  'declared',
  MALFORMED: 'malformed',
})

/** Roster cardinality — the same words as the robot roster's (the pickers share one shape). */
export const CAMERA_CARDINALITY = Object.freeze({ NONE: 'none', SINGLE: 'single', MULTI: 'multi' })

/**
 * The field-of-view a camera added from the menu is born with: the first
 * vision preset's (0.6 rad ≈ 69° full). A DECLARED number the user sees and
 * edits on the camera's panel — not a fill-in on read.
 */
export const DEFAULT_CAMERA_DECLARATION = Object.freeze({
  fovHalfAngles: Object.freeze({ horizontal: 0.6, vertical: 0.6 }),
})

/**
 * How far the frustum is drawn, mm. PRESENTATION only (原則 #29): the wire has
 * no range and nothing judges it — the solver's cone is unbounded.
 */
export const FRUSTUM_DISPLAY_LENGTH_MM = 400

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v)

/**
 * True when `obj` is a vision camera — THE identity predicate (`IDENTITY_RULES`):
 * a frame carrying a `camera` declaration object. Callers never re-test the
 * field themselves.
 *
 * @param {{camera?: unknown}|null|undefined} obj
 * @returns {boolean}
 */
export function isCameraFrame(obj) {
  return !!obj && obj.camera !== null && typeof obj.camera === 'object' && !Array.isArray(obj.camera)
}

const isHalfAngle = (v) => isFiniteNumber(v) && v > 0 && v < Math.PI / 2

/**
 * Read a camera's declaration. The field of view may be absent (declared
 * camera, field of view undeclared → no field-of-view gate; the solver still
 * asks line of sight). Never filled in on read. The pre-ADR-171 single
 * `fovHalfAngle` reads as the square it was always drawn as.
 *
 * @param {{camera?: object}|null} frame
 * @returns {{state: 'declared'|'malformed', fov: {horizontal: number, vertical: number}|null, errors: string[]}|null}
 *          null when the frame is not a camera
 */
export function cameraDeclarationOf(frame) {
  if (!isCameraFrame(frame)) return null
  const legacy = frame.camera.fovHalfAngle ?? null
  const rect = frame.camera.fovHalfAngles ?? null
  const malformed = (message) => ({ state: CAMERA_STATE.MALFORMED, fov: null, errors: [message] })
  if (legacy !== null && rect !== null) {
    return malformed('field of view is declared twice (fovHalfAngle and fovHalfAngles) — keep one')
  }
  if (rect !== null) {
    if (typeof rect !== 'object' || !isHalfAngle(rect.horizontal) || !isHalfAngle(rect.vertical)) {
      return malformed(`field-of-view half angles must be two numbers in (0, π/2) rad — got ${JSON.stringify(rect)}`)
    }
    return { state: CAMERA_STATE.DECLARED, fov: { horizontal: rect.horizontal, vertical: rect.vertical }, errors: [] }
  }
  if (legacy !== null) {
    if (!isHalfAngle(legacy)) {
      return malformed(`field-of-view half angle must be a number in (0, π/2) rad — got ${JSON.stringify(legacy)}`)
    }
    return { state: CAMERA_STATE.DECLARED, fov: { horizontal: legacy, vertical: legacy }, errors: [] }
  }
  return { state: CAMERA_STATE.DECLARED, fov: null, errors: [] }
}

/**
 * The stored declaration with a new field of view (or none) — THE writer's
 * shape: always the two-angle form, the pre-ADR-171 key dropped. Other keys of
 * the declaration are kept.
 *
 * @param {object|null|undefined} camera  the stored declaration
 * @param {{horizontal: number, vertical: number}|null} fov
 * @returns {object}
 */
export function withFieldOfView(camera, fov) {
  const { fovHalfAngle: _legacy, fovHalfAngles: _rect, ...rest } = camera ?? {}
  return fov ? { ...rest, fovHalfAngles: { horizontal: fov.horizontal, vertical: fov.vertical } } : rest
}

/** One camera — the typed aggregate the roster is made of. Identity = the frame's entity id. */
export class VisionCamera {
  /** @param {{id: string, name?: string, camera: object}} frame */
  constructor(frame) {
    this.frame = frame
    Object.freeze(this)
  }

  get id() { return this.frame.id }

  get label() { return this.frame.name ?? 'camera' }
}

/**
 * THE resolution point: scene entities → the camera roster, in insertion order.
 * @param {Iterable<object>} objects
 * @returns {VisionCamera[]}
 */
export function resolveCameras(objects) {
  return [...(objects ?? [])].filter(isCameraFrame).map(f => new VisionCamera(f))
}

/**
 * @param {VisionCamera[]} cameras
 * @returns {'none'|'single'|'multi'}
 */
export function cameraCardinality(cameras) {
  const n = cameras?.length ?? 0
  if (n === 0) return CAMERA_CARDINALITY.NONE
  if (n === 1) return CAMERA_CARDINALITY.SINGLE
  return CAMERA_CARDINALITY.MULTI
}

/**
 * "Which camera does this search ask about?" — the robot rule (ADR-090 D3):
 * 0 → null (visibility not asked), 1 → that one, N → the explicit pick or null
 * (never "first one wins").
 *
 * @param {VisionCamera[]} cameras
 * @param {string|null|undefined} selectedId
 * @returns {VisionCamera|null}
 */
export function selectCamera(cameras, selectedId) {
  if (!cameras?.length) return null
  if (cameras.length === 1) return cameras[0]
  return cameras.find(c => c.id === selectedId) ?? null
}

/** Round to 1e-4 so derived values read cleanly (+0 normalises -0). */
const round4 = (v) => Math.round(v * 1e4) / 1e4 + 0

/**
 * The wire `camera` (request contract, ADR-081 / ADR-171) DERIVED from a
 * camera's world pose and declaration: position mm → m, `viewAxis` = world
 * rotation · optical +Z. With a declared field of view also `fovHalfAngles` and
 * `imageUp` (= world rotation · optical −Y) — the rectangle `core/` judges is
 * the one `frustumCorners` draws. Null for a malformed declaration or an
 * unresolved pose — the caller gates Run with the reason, it never ships a
 * guessed camera.
 *
 * @param {{position: {x:number,y:number,z:number}, quaternion: {x:number,y:number,z:number,w:number}}|null} worldPose  mm
 * @param {ReturnType<typeof cameraDeclarationOf>} declaration
 * @returns {{position: number[], viewAxis: number[], fovHalfAngles?: {horizontal: number, vertical: number}, imageUp?: number[]}|null}
 */
export function wireCameraOf(worldPose, declaration) {
  if (!worldPose?.position || !worldPose?.quaternion) return null
  if (!declaration || declaration.state !== CAMERA_STATE.DECLARED) return null
  const p = worldPose.position
  const unitWorld = (local) => {
    const v = rotateVec3(local, worldPose.quaternion)
    const len = Math.hypot(v.x, v.y, v.z)
    return len > 0 ? [round4(v.x / len), round4(v.y / len), round4(v.z / len)] : null
  }
  const viewAxis = unitWorld(CAMERA_VIEW_AXIS_LOCAL)
  const imageUp = unitWorld(CAMERA_IMAGE_UP_LOCAL)
  if (!viewAxis || !imageUp) return null
  return {
    position: [round4(mmToM(p.x)), round4(mmToM(p.y)), round4(mmToM(p.z))],
    viewAxis,
    ...(declaration.fov !== null
      ? { fovHalfAngles: { horizontal: declaration.fov.horizontal, vertical: declaration.fov.vertical }, imageUp }
      : {}),
  }
}

/**
 * Quaternion of a rotation whose columns are the unit vectors `xa`, `ya`, `za`
 * (closed form — Shepperd's method).
 */
export function quaternionFromBasis(xa, ya, za) {
  const m00 = xa.x, m10 = xa.y, m20 = xa.z
  const m01 = ya.x, m11 = ya.y, m21 = ya.z
  const m02 = za.x, m12 = za.y, m22 = za.z
  const tr = m00 + m11 + m22
  let x, y, z, w
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1)
    w = 0.25 / s; x = (m21 - m12) * s; y = (m02 - m20) * s; z = (m10 - m01) * s
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22)
    w = (m21 - m12) / s; x = 0.25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22)
    w = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11)
    w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s
  }
  const n = Math.hypot(x, y, z, w)
  return { x: x / n, y: y / n, z: z / n, w: w / n }
}

/**
 * "Copy the current view" — the pure half: a viewport-camera snapshot → the
 * camera entity's WORLD pose (mm) and field of view.
 *
 * A THREE camera looks down its local −Z with +Y up; the optical frame looks
 * down +Z with +Y down. So optical x = three x, optical y = −three y,
 * optical z = −three z (a half turn about x).
 *
 * `fovDeg` is THREE's VERTICAL full angle; half of it is the vertical half
 * angle, and the horizontal one follows from the viewport's `aspect`
 * (width / height): tan(h) = aspect · tan(v) — the copied camera sees exactly
 * the viewport's rectangle. An orthographic viewport has no fov, and a
 * perspective one whose aspect is unreadable has no rectangle → `fov: null`
 * (said by the caller, not guessed).
 *
 * @param {{position: {x:number,y:number,z:number}|null, matrixWorldElements: number[]|null, fovDeg: number|null, aspect?: number|null}} snap
 * @returns {{position: {x:number,y:number,z:number}, quaternion: {x:number,y:number,z:number,w:number}, fov: {horizontal: number, vertical: number}|null}|null}
 */
export function cameraPoseFromViewport(snap) {
  const p = snap?.position
  const e = snap?.matrixWorldElements
  if (!p || ![p.x, p.y, p.z].every(isFiniteNumber)) return null
  if (!e || e.length !== 16 || !e.every(isFiniteNumber)) return null
  const unit = (x, y, z) => {
    const l = Math.hypot(x, y, z)
    return l > 0 ? { x: x / l, y: y / l, z: z / l } : null
  }
  // Column-major (THREE Matrix4.elements): column 0 = local x, 1 = y, 2 = z.
  const xa = unit(e[0], e[1], e[2])
  const ya = unit(-e[4], -e[5], -e[6])
  const za = unit(-e[8], -e[9], -e[10])
  if (!xa || !ya || !za) return null
  const fovDeg = snap.fovDeg
  const aspect = snap.aspect
  let fov = null
  if (isFiniteNumber(fovDeg) && fovDeg > 0 && fovDeg < 180 && isFiniteNumber(aspect) && aspect > 0) {
    const vertical = (fovDeg * Math.PI / 180) / 2
    fov = { horizontal: round4(Math.atan(aspect * Math.tan(vertical))), vertical: round4(vertical) }
  }
  return {
    position: { x: p.x, y: p.y, z: p.z },
    quaternion: quaternionFromBasis(xa, ya, za),
    fov,
  }
}

/**
 * The drawn frustum, frame-local (mm): apex at the origin, the far rectangle at
 * +Z = `length`, its side planes at ±`horizontal` (about the image's vertical
 * axis) and ±`vertical` — the same four-sided pyramid `core/` judges
 * (`inside_rectangular_view`; the agreement is asked by the shared fixture
 * `fixtures/cross-language/camera-rectangular-view.json`). Corners in image
 * order (top-left, top-right, bottom-right, bottom-left; image-up is optical −Y).
 *
 * @param {{horizontal: number, vertical: number}|null} fov  rad, each in (0, π/2)
 * @param {number} [length]  mm
 * @returns {{x:number,y:number,z:number}[]|null}  null when the fov is not drawable
 */
export function frustumCorners(fov, length = FRUSTUM_DISPLAY_LENGTH_MM) {
  if (!fov || !isHalfAngle(fov.horizontal) || !isHalfAngle(fov.vertical)) return null
  const w = length * Math.tan(fov.horizontal)
  const h = length * Math.tan(fov.vertical)
  return [
    { x: -w, y: -h, z: length },
    { x:  w, y: -h, z: length },
    { x:  w, y:  h, z: length },
    { x: -w, y:  h, z: length },
  ]
}

/**
 * Next free camera name: `camera`, `camera_2`, … (labels only; identity is the id).
 * @param {Iterable<{name?: string}>} objects
 */
export function nextCameraName(objects) {
  const taken = new Set([...(objects ?? [])].map(o => o?.name))
  if (!taken.has('camera')) return 'camera'
  for (let i = 2; ; i++) if (!taken.has(`camera_${i}`)) return `camera_${i}`
}

/**
 * Where a camera added from the menu stands: overhead of the origin, looking
 * straight down (optical +Z = world −Z, image-up = world +X), 1.2 m up — the
 * first vision preset's pose. Offset along +Y per camera already present so a
 * second does not spawn inside the first.
 *
 * @param {number} existingCount
 * @returns {{position: {x:number,y:number,z:number}, rotation: {x:number,y:number,z:number,w:number}}}  (the `createWorldFrame` pose shape)
 */
export function cameraSeedPose(existingCount = 0) {
  // optical x (image-right) = world −Y, optical y (image-down) = world −X, z = world −Z.
  const quaternion = quaternionFromBasis({ x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, { x: 0, y: 0, z: -1 })
  return { position: { x: 0, y: existingCount * 500, z: 1200 }, rotation: quaternion }
}
