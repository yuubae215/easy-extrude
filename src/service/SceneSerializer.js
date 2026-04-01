/**
 * SceneSerializer — convert between live domain entities and plain JSON DTOs.
 *
 * Used by SceneService when saving to / loading from the BFF REST API (ADR-015).
 *
 * DTO format (stored in the BFF DB):
 * {
 *   objects: SceneObjectDTO[],
 *   transformGraph: { nodes: TransformNode[], edges: TransformEdge[] }  // ADR-016
 * }
 *
 * SceneObjectDTO (Solid):
 * { type: 'Solid', id, name, description, vertices: [{ id, x, y, z }] }
 *
 * SceneObjectDTO (Profile):
 * { type: 'Profile', id, name, description,
 *   sketchRect: { p1: {x,y,z}, p2: {x,y,z} } | null }
 *
 * SceneObjectDTO (MeasureLine):
 * { type: 'MeasureLine', id, name, p1: {x,y,z}, p2: {x,y,z} }
 *
 * SceneObjectDTO (CoordinateFrame):
 * { type: 'CoordinateFrame', id, name, parentId,
 *   translation: {x,y,z}, rotation: {x,y,z,w} }
 *
 * SceneObjectDTO (ImportedMesh):
 * { type: 'ImportedMesh', id, name,
 *   positions: <base64 Float32Array>, normals: <base64 Float32Array>|null,
 *   indices: <base64 Uint32Array>|null, offset: {x,y,z} }
 */
import { Solid }            from '../domain/Solid.js'
import { Profile }          from '../domain/Profile.js'
import { MeasureLine }      from '../domain/MeasureLine.js'
import { CoordinateFrame }  from '../domain/CoordinateFrame.js'
import { ImportedMesh }     from '../domain/ImportedMesh.js'

// ── Base64 helpers for typed arrays ──────────────────────────────────────────

/** @param {Float32Array} arr */
function f32ToBase64(arr) {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength)
  let str = ''
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i])
  return btoa(str)
}

/** @param {string} b64 @returns {Float32Array} */
function base64ToF32(b64) {
  const str   = atob(b64)
  const bytes = new Uint8Array(str.length)
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i)
  return new Float32Array(bytes.buffer)
}

/** @param {Uint32Array} arr */
function u32ToBase64(arr) {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength)
  let str = ''
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i])
  return btoa(str)
}

/** @param {string} b64 @returns {Uint32Array} */
function base64ToU32(b64) {
  const str   = atob(b64)
  const bytes = new Uint8Array(str.length)
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i)
  return new Uint32Array(bytes.buffer)
}

export { f32ToBase64, u32ToBase64, base64ToF32, base64ToU32 }

// ── Serialise ─────────────────────────────────────────────────────────────────

/**
 * Converts all live objects in a SceneModel into a plain-JSON payload
 * suitable for the BFF REST API.
 *
 * @param {import('../model/SceneModel.js').SceneModel} scene
 * @returns {{ objects: object[], transformGraph: { nodes: [], edges: [] } }}
 */
export function serializeScene(scene) {
  const objects = []

  for (const obj of scene.objects.values()) {
    if (obj instanceof Solid) {
      objects.push({
        type: 'Solid',
        id:          obj.id,
        name:        obj.name,
        description: obj.description ?? '',
        vertices: obj.vertices.map(v => ({
          id: v.id,
          x:  v.position.x,
          y:  v.position.y,
          z:  v.position.z,
        })),
      })
    } else if (obj instanceof Profile) {
      const sr = obj.sketchRect
      objects.push({
        type:        'Profile',
        id:          obj.id,
        name:        obj.name,
        description: obj.description ?? '',
        sketchRect: sr ? {
          p1: { x: sr.p1.x, y: sr.p1.y, z: sr.p1.z },
          p2: { x: sr.p2.x, y: sr.p2.y, z: sr.p2.z },
        } : null,
      })
    } else if (obj instanceof MeasureLine) {
      objects.push({
        type: 'MeasureLine',
        id:   obj.id,
        name: obj.name,
        p1:   { x: obj.p1.x, y: obj.p1.y, z: obj.p1.z },
        p2:   { x: obj.p2.x, y: obj.p2.y, z: obj.p2.z },
      })
    } else if (obj instanceof CoordinateFrame) {
      objects.push({
        type:     'CoordinateFrame',
        id:       obj.id,
        name:     obj.name,
        parentId: obj.parentId,
        translation: {
          x: obj.translation.x,
          y: obj.translation.y,
          z: obj.translation.z,
        },
        rotation: {
          x: obj.rotation.x,
          y: obj.rotation.y,
          z: obj.rotation.z,
          w: obj.rotation.w,
        },
      })
    } else if (obj instanceof ImportedMesh) {
      const bufs = obj.meshView.getGeometryBuffers()
      if (bufs) {
        objects.push({
          type:      'ImportedMesh',
          id:        obj.id,
          name:      obj.name,
          positions: f32ToBase64(bufs.positions),
          normals:   bufs.normals  ? f32ToBase64(bufs.normals)  : null,
          indices:   bufs.indices  ? u32ToBase64(bufs.indices)  : null,
          offset:    bufs.offset,
        })
      }
    }
  }

  // Phase A: no real transform-graph editing yet; emit a node per object.
  const nodes = objects.map(o => ({
    id:       `tnode_${o.id}`,
    objectId: o.id,
    label:    o.name,
    transform: {
      translation: [0, 0, 0],
      rotation:    [0, 0, 0, 1],
    },
  }))
  const worldId = 'tnode_world'
  const edges = nodes.map((n, i) => ({
    id:         `tedge_${i}`,
    parentId:   worldId,
    childId:    n.id,
    constraint: 'fixed',
  }))

  return {
    objects,
    transformGraph: { nodes, edges },
  }
}
