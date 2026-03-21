/**
 * SQLite database setup for the BFF.
 *
 * Schema:
 *   scenes   — scene metadata + full JSON payload
 *
 * The scene JSON payload includes:
 *   objects[]       — serialised domain entities (Cuboid / Sketch)
 *   transformGraph  — adjacency list of TransformNode / TransformEdge (ADR-016)
 */
import Database from 'better-sqlite3'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR  = join(__dirname, '../../data')
mkdirSync(DATA_DIR, { recursive: true })

const DB_PATH = join(DATA_DIR, 'scenes.db')
export const db = new Database(DB_PATH)

// Enable WAL for concurrent read performance
db.pragma('journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS scenes (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    data       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  );
`)
