/**
 * SceneStore — data-access layer for scene persistence.
 *
 * All DB operations are async (@libsql/client).
 * The transform graph (ADR-016) is stored inside the `data` JSON column.
 *
 * Scene document shape (stored as JSON string in `data`):
 * {
 *   objects: SceneObjectDTO[],      // serialised Cuboid / Sketch entities
 *   transformGraph: {
 *     nodes: TransformNode[],
 *     edges: TransformEdge[]
 *   }
 * }
 */
import { db } from '../db/database.js'

function now() { return new Date().toISOString() }

/** @returns {Promise<{ id, name, created_at, updated_at }[]>} */
export async function listScenes() {
  const rs = await db.execute(
    'SELECT id, name, created_at, updated_at FROM scenes ORDER BY updated_at DESC',
  )
  return rs.rows.map(r => ({
    id: r.id, name: r.name, created_at: r.created_at, updated_at: r.updated_at,
  }))
}

/**
 * @param {string} id
 * @returns {Promise<{ id, name, data: object, created_at, updated_at } | null>}
 */
export async function getScene(id) {
  const rs = await db.execute({ sql: 'SELECT * FROM scenes WHERE id = ?', args: [id] })
  if (rs.rows.length === 0) return null
  const row = rs.rows[0]
  let data
  try {
    data = JSON.parse(row.data)
  } catch (err) {
    throw new Error(`Scene ${id}: stored data is not valid JSON — ${err.message}`)
  }
  return { id: row.id, name: row.name, data, created_at: row.created_at, updated_at: row.updated_at }
}

/**
 * Creates a new scene row. Throws if id already exists.
 * @param {{ id: string, name: string, data: object }} scene
 * @returns {Promise<{ id, name, created_at, updated_at }>}
 */
export async function createScene({ id, name, data }) {
  const ts = now()
  await db.execute({
    sql:  'INSERT INTO scenes (id, name, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    args: [id, name, JSON.stringify(data), ts, ts],
  })
  return { id, name, created_at: ts, updated_at: ts }
}

/**
 * Updates name and/or data of an existing scene.
 * @param {string} id
 * @param {{ name?: string, data?: object }} patch
 * @returns {Promise<{ id, name, updated_at } | null>}  null if not found
 */
export async function updateScene(id, patch) {
  const rs = await db.execute({ sql: 'SELECT * FROM scenes WHERE id = ?', args: [id] })
  if (rs.rows.length === 0) return null
  const existing  = rs.rows[0]
  const name       = patch.name ?? existing.name
  const data       = patch.data ? JSON.stringify(patch.data) : existing.data
  const updated_at = now()
  await db.execute({
    sql:  'UPDATE scenes SET name = ?, data = ?, updated_at = ? WHERE id = ?',
    args: [name, data, updated_at, id],
  })
  return { id, name, updated_at }
}

/**
 * @param {string} id
 * @returns {Promise<boolean>}  true if the row existed and was deleted
 */
export async function deleteScene(id) {
  const rs = await db.execute({ sql: 'DELETE FROM scenes WHERE id = ?', args: [id] })
  return rs.rowsAffected > 0
}
