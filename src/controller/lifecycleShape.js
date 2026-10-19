/**
 * lifecycleShape — which shape the lifecycle voxels are cut from, per entity
 * TYPE (ADR-166 M5; 原則 #2 — the capability is the type, not `corners.length`).
 *
 * Before M5 the effect chose its form by `corners.length === 8`: a Solid got
 * the outline construction, everything else a sphere of voxels around the
 * centre — and an eight-vertex Zone would have been drawn as a box. Here every
 * entity type DECLARES its shape, and an undeclared type throws (原則 #31 —
 * a fall-through cannot tell "declared silent" from "nobody thought of it").
 *
 * `null` from a declaration = declared silent: the type has no extent to break
 * into pieces (a point, a frame, a link). `ShapeVoxelMath.voxelCells` reads
 * the shape; `LandingEffects.createLandingEffect` routes on it.
 */
import { FACES } from '../model/CuboidModel.js'
import { Solid } from '../domain/Solid.js'
import { Profile } from '../domain/Profile.js'
import { ImportedMesh } from '../domain/ImportedMesh.js'
import { MeasureLine } from '../domain/MeasureLine.js'
import { CoordinateFrame } from '../domain/CoordinateFrame.js'
import { AnnotatedPoint } from '../domain/AnnotatedPoint.js'
import { AnnotatedLine } from '../domain/AnnotatedLine.js'
import { AnnotatedRegion } from '../domain/AnnotatedRegion.js'
import { SpatialLink } from '../domain/SpatialLink.js'

const plain = c => ({ x: c.x, y: c.y, z: c.z })

/** The 6 faces of the 8 corners in `CuboidModel` order (outward CCW). */
function boxFaces(corners) {
  return FACES.map(f => f.corners.map(i => plain(corners[i])))
}

/** The 6 faces of the axis-aligned box around arbitrary points. */
function aabbFaces(points) {
  const lo = { x: Infinity, y: Infinity, z: Infinity }, hi = { x: -Infinity, y: -Infinity, z: -Infinity }
  for (const p of points) for (const k of ['x', 'y', 'z']) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]) }
  // Same corner numbering as CuboidModel (0..3 bottom, 4..7 top).
  const c = [
    { x: hi.x, y: lo.y, z: lo.z }, { x: hi.x, y: hi.y, z: lo.z }, { x: lo.x, y: hi.y, z: lo.z }, { x: lo.x, y: lo.y, z: lo.z },
    { x: hi.x, y: lo.y, z: hi.z }, { x: hi.x, y: hi.y, z: hi.z }, { x: lo.x, y: hi.y, z: hi.z }, { x: lo.x, y: lo.y, z: hi.z },
  ]
  return boxFaces(c)
}

/** Declarations, one row per entity type that can enter the scene. */
export const SHAPE_BY_TYPE = Object.freeze([
  // A real cuboid: its 6 faces; `box` lets the materialize draw its outline.
  [Solid,           obj => obj.corners?.length === 8 ? { kind: 'surface', box: true, corners: obj.corners.map(plain), polygons: boxFaces(obj.corners) } : null],
  // An imported mesh's 8 corners are a synthetic bounding box — break the box.
  [ImportedMesh,    obj => obj.corners?.length >= 2 ? { kind: 'surface', polygons: aabbFaces(obj.corners) } : null],
  // A sketch and a Zone are one sheet lying on (or near) the floor.
  [Profile,         obj => obj.corners?.length >= 3 ? { kind: 'surface', faceUp: true, polygons: [obj.corners.map(plain)] } : null],
  [AnnotatedRegion, obj => obj.corners?.length >= 3 ? { kind: 'surface', faceUp: true, polygons: [obj.corners.map(plain)] } : null],
  [AnnotatedLine,   obj => obj.corners?.length >= 2 ? { kind: 'path', points: obj.corners.map(plain) } : null],
  [MeasureLine,     obj => obj.corners?.length >= 2 ? { kind: 'path', points: obj.corners.map(plain) } : null],
  // Declared silent: no extent to break into pieces.
  [AnnotatedPoint,  () => null],
  [CoordinateFrame, () => null],
  [SpatialLink,     () => null],
])

/**
 * @param {object} obj a scene entity
 * @returns {object|null} the shape, or `null` when its type is declared silent
 * @throws when the type has no declaration
 */
export function lifecycleShapeOf(obj) {
  // Most specific first: the table is searched in order, so a subclass row
  // would have to come before its parent (none today).
  for (const [Type, shapeOf] of SHAPE_BY_TYPE) {
    if (obj instanceof Type) return shapeOf(obj)
  }
  throw new Error(`lifecycleShapeOf: no shape declared for ${obj?.constructor?.name ?? typeof obj}`)
}
