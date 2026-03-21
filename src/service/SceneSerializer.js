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
 * SceneObjectDTO (Cuboid):
 * { type: 'Cuboid', id, name, description, vertices: [{ id, x, y, z }] }
 *
 * SceneObjectDTO (Sketch):
 * { type: 'Sketch', id, name, description,
 *   sketchRect: { p1: {x,y,z}, p2: {x,y,z} } | null }
 */
import { Vector3 } from 'three'
import { Cuboid }  from '../domain/Cuboid.js'
import { Sketch }  from '../domain/Sketch.js'
import { Vertex }  from '../graph/Vertex.js'
import { MeshView } from '../view/MeshView.js'

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
    if (obj instanceof Cuboid) {
      objects.push({
        type: 'Cuboid',
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
    } else if (obj instanceof Sketch) {
      const sr = obj.sketchRect
      objects.push({
        type:        'Sketch',
        id:          obj.id,
        name:        obj.name,
        description: obj.description ?? '',
        sketchRect: sr ? {
          p1: { x: sr.p1.x, y: sr.p1.y, z: sr.p1.z },
          p2: { x: sr.p2.x, y: sr.p2.y, z: sr.p2.z },
        } : null,
      })
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

// ── Deserialise ───────────────────────────────────────────────────────────────

/**
 * Reconstructs live domain entities from a plain-JSON scene payload.
 * New MeshView instances are created for each entity.
 *
 * @param {object} data          Parsed scene `data` field from BFF
 * @param {import('three').Scene} threeScene  Three.js scene for MeshView
 * @returns {{ entities: (Cuboid|Sketch)[], activeId: string|null }}
 */
export function deserializeScene(data, threeScene) {
  const entities = []

  for (const dto of (data.objects ?? [])) {
    if (dto.type === 'Cuboid') {
      const vertices = dto.vertices.map(v =>
        new Vertex(v.id, new Vector3(v.x, v.y, v.z))
      )
      const cuboid = new Cuboid(dto.id, dto.name, vertices, new MeshView(threeScene))
      cuboid.description = dto.description ?? ''
      cuboid.meshView.updateGeometry(cuboid.corners)
      entities.push(cuboid)
    } else if (dto.type === 'Sketch') {
      const meshView = new MeshView(threeScene)
      meshView.setVisible(false)
      const sketch = new Sketch(dto.id, dto.name, meshView)
      sketch.description = dto.description ?? ''
      if (dto.sketchRect) {
        sketch.sketchRect = {
          p1: new Vector3(dto.sketchRect.p1.x, dto.sketchRect.p1.y, dto.sketchRect.p1.z),
          p2: new Vector3(dto.sketchRect.p2.x, dto.sketchRect.p2.y, dto.sketchRect.p2.z),
        }
      }
      entities.push(sketch)
    }
  }

  return { entities }
}
