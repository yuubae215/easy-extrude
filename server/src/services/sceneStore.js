/**
 * SceneStore — data-access layer for scene persistence.
 *
 * All DB operations are synchronous (better-sqlite3).
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

const stmts = {
  list:   db.prepare('SELECT id, name, created_at, updated_at FROM scenes ORDER BY updated_at DESC'),
  get:    db.prepare('SELECT * FROM scenes WHERE id = ?'),
  insert: db.prepare(`
    INSERT INTO scenes (id, name, data, created_at, updated_at)
    VALUES (@id, @name, @data, @created_at, @updated_at)
  `),
  update: db.prepare(`
    UPDATE scenes SET name = @name, data = @data, updated_at = @updated_at
    WHERE id = @id
  `),
  delete: db.prepare('DELETE FROM scenes WHERE id = ?'),
  exists: db.prepare('SELECT 1 FROM scenes WHERE id = ?'),
}

function now() { return new Date().toISOString() }

/** @returns {{ id, name, created_at, updated_at }[]} */
export function listScenes() {
  return stmts.list.all()
}

/**
 * @param {string} id
 * @returns {{ id, name, data: object, created_at, updated_at } | null}
 */
export function getScene(id) {
  const row = stmts.get.get(id)
  if (!row) return null
  return { ...row, data: JSON.parse(row.data) }
}

/**
 * Creates a new scene row. Throws if id already exists.
 * @param {{ id: string, name: string, data: object }} scene
 * @returns {{ id, name, created_at, updated_at }}
 */
export function createScene({ id, name, data }) {
  const ts = now()
  stmts.insert.run({ id, name, data: JSON.stringify(data), created_at: ts, updated_at: ts })
  return { id, name, created_at: ts, updated_at: ts }
}

/**
 * Updates name and/or data of an existing scene.
 * @param {string} id
 * @param {{ name?: string, data?: object }} patch
 * @returns {{ id, name, updated_at } | null}  null if not found
 */
export function updateScene(id, patch) {
  const existing = stmts.get.get(id)
  if (!existing) return null
  const name = patch.name ?? existing.name
  const data = patch.data ? JSON.stringify(patch.data) : existing.data
  const updated_at = now()
  stmts.update.run({ id, name, data, updated_at })
  return { id, name, updated_at }
}

/**
 * @param {string} id
 * @returns {boolean}  true if the row existed and was deleted
 */
export function deleteScene(id) {
  const result = stmts.delete.run(id)
  return result.changes > 0
}
