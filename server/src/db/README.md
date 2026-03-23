# DB Layer — SQLite Database Setup

**Responsibility**: Initialize the database connection and define the schema.

Files: `database.js`

---

## Meta Model

| Permitted | Prohibited |
|-----------|------------|
| Schema DDL (`CREATE TABLE IF NOT EXISTS`) | Business logic or query construction |
| `PRAGMA` configuration | Calling service or route functions |
| Exporting the `db` client instance | Direct use by routes (must go through `services/`) |

This layer is the single source of truth for the connection handle.
All other server layers that need DB access must import `db` from here.

## Key Contracts

- **Journal mode**: `PRAGMA journal_mode = WAL` **must** execute as a standalone `db.execute()` call *before* any `db.batch()`. Running it inside `batch()` causes a `LibsqlBatchError` (see MENTAL_MODEL §3.5).
- **Schema migration**: DDL changes go in `db.batch()` after the PRAGMA call. Use `CREATE TABLE IF NOT EXISTS` to make startup idempotent.
- **Data directory**: The database file is created at `server/data/scenes.db`. The directory is created automatically via `mkdirSync` at startup.

## Schema

```
scenes
  id          TEXT PRIMARY KEY
  name        TEXT NOT NULL
  data        TEXT NOT NULL        — JSON string (scene payload)
  created_at  TEXT NOT NULL
  updated_at  TEXT NOT NULL
```

The `data` column stores a JSON object with the shape:

```json
{
  "objects": [],
  "transformGraph": { "nodes": [], "edges": [] },
  "operationGraph": { "nodes": [], "edges": [] }
}
```

See ADR-015, ADR-016.
