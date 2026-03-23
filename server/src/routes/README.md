# Routes Layer — REST API Endpoints

**Responsibility**: Define Express route handlers for the BFF REST API.
Translate HTTP requests into service calls and return JSON responses.

Files: `scenes.js`, `auth.js`, `import.js`

---

## Meta Model

| Permitted | Prohibited |
|-----------|------------|
| Parsing and validating request bodies | Direct DB queries (must go through `services/`) |
| Calling `services/` functions | Geometry computation (must go through `geometry/`) |
| Setting HTTP status codes and JSON bodies | Holding in-memory state across requests |

Route handlers are thin. Business logic belongs in `services/`; geometry in `geometry/`.

## Endpoints

### scenes.js — mounted at `/api/scenes`

| Method | Path | Description |
|--------|------|-------------|
| `GET`    | `/`      | List all scenes (id, name, timestamps) |
| `POST`   | `/`      | Create a new scene |
| `GET`    | `/:id`   | Get full scene (objects + transformGraph + operationGraph) |
| `PUT`    | `/:id`   | Update scene (name and/or data payload) |
| `DELETE` | `/:id`   | Delete scene |

Scene `data` payload always contains `objects[]` and `transformGraph` (ADR-016).
Missing fields are initialised to empty defaults on create and update.

### auth.js — mounted at `/api/auth`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/token` | Issue a dev JWT (Phase A — no credentials required) |

### import.js — mounted at `/api/import`

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/step` | Parse an uploaded STEP file and return geometry buffers |

The `/import/step` route is a REST alternative to the WebSocket `import.step` op.
It uses `occt-import-js` for parsing (see MENTAL_MODEL §3.5 for geometry structure notes).

## Validation rules

- `name` must be a non-empty string on create; optional on update.
- `data` must be a non-null object on create; optional on update.
- `404` is returned when a scene id does not exist.
