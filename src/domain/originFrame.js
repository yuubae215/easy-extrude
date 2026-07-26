/**
 * Origin CF identity — "is this frame a Solid's body frame?" (ADR-037).
 *
 * Every Solid owns exactly one child CoordinateFrame named `Origin`, created
 * atomically with the Solid and sitting at its centroid with its orientation
 * (ADR-037 §1). That frame is the ROS/URDF **body frame**: user CFs hang off it,
 * the TC proxy copies its world quaternion, and every editing operation on it is
 * blocked (ADR-037 §4). It is therefore an entity the rest of the app constantly
 * has to *recognise* — and, until this module existed, recognised by re-deriving
 * `name === 'Origin'` inline at 16 call sites across 10 files.
 *
 * ## Why one module (§1.1)
 *
 * The duplication was of the DERIVATION RULE, not of data — the failure mode
 * ADR-090 closed for `robot_base` and `src/IdentityContainment.test.js` was built
 * to guard. Each inline copy is a defensible local judgement, so the rule spreads
 * silently and the (n+1)-th copy is always the path of least resistance. The
 * literal `'Origin'` now appears in `src/` exactly here; the guard fails the build
 * on any other occurrence.
 *
 * ## Why the NAME is still the rule (and why that is not ADR-090's mistake)
 *
 * `robot_base` was a bad identity because it was scene-global: a second robot
 * could not have the name, so the rule could never identify N robots. `Origin` is
 * different — it is scoped by parent (one per Solid), so the pair
 * (`parentId`, `name`) is a legitimate key. What made it a defect here was the
 * re-derivation, not the name.
 *
 * The name is only a sound key while nothing can acquire it after creation. That
 * half was missing: renaming an Origin frame was blocked, but renaming ANOTHER
 * frame *to* `Origin` was not, which would have given a Solid a second locked,
 * undeletable "body frame" that is not its own. `isOriginFrameName()` is the
 * reserved-name predicate that closes the reverse direction, enforced at the
 * authoritative rename entry point (`SceneService.renameObject`, 原則 #1).
 *
 * Promoting identity onto a declared field (`frameRole: 'origin'`, the ADR-090
 * shape) stays open as a future move — it touches scene JSON, Layout DSL, schema
 * and a migration pass, so it is a versioned act needing its own ADR. It is cheap
 * *because* of this module: one file changes, not sixteen call sites.
 *
 * ## Cardinality (原則 #31)
 *
 *   0 — a Solid with no Origin CF. NOT a legal steady state, but reachable from
 *       scenes saved before ADR-037. `findOriginFrame()` returns `null` and the
 *       caller branches on it; the repair is explicit and named
 *       (`SceneService._ensureOriginFrames`), never a silent default.
 *   1 — the steady state. Solid : Origin CF is a 1:1 bijection (ADR-037 §1).
 *   N — two Origin CFs under one Solid is an illegal state. Nothing creates it;
 *       the reserved-name guard is what keeps it unreachable by rename.
 *       `findOriginFrame()` returns the first match in iteration order rather
 *       than pretending the case cannot occur.
 *
 * Pure module: no THREE, no DOM. `LayoutCompiler` / `LayoutDecompiler` declare
 * themselves Three.js-free and load under bare `node --test`, so identity is
 * duck-typed on `{ name, parentId }`. Callers that need a hard type guard pair
 * these predicates with `instanceof CoordinateFrame` — same contract as
 * `domain/robotFrames.js`.
 */

/**
 * The body frame's name — the seed passed at creation AND the rule that
 * recognises it afterwards. Both readings live on this one constant so they
 * cannot drift apart.
 * @type {'Origin'}
 */
export const ORIGIN_FRAME_NAME = 'Origin'

/**
 * True when `obj` is a Solid's body frame (ADR-037 §1).
 *
 * Duck-typed on the name so the pure layout lanes can call it. Callers holding an
 * entity of unknown type keep their own `instanceof CoordinateFrame` narrowing —
 * that guard is about the entity's capabilities (原則 #2), not about Origin-ness,
 * and the two compose.
 *
 * @param {{name?: string}|null|undefined} obj
 * @returns {boolean}
 */
export function isOriginFrame(obj) {
  return obj?.name === ORIGIN_FRAME_NAME
}

/**
 * True when `name` is reserved for the body frame — the guard that keeps the name
 * rule sound by preventing any other entity from BECOMING an Origin (see the
 * module note above). Asked at the authoritative rename entry point, so no
 * caller-side path can bypass it (原則 #1).
 *
 * @param {string|null|undefined} name
 * @returns {boolean}
 */
export function isOriginFrameName(name) {
  return name === ORIGIN_FRAME_NAME
}

/**
 * The Origin CF of `parentId` among `objects`, or `null` when the parent has none
 * (cardinality 0 — a pre-ADR-037 scene, or a parent kind that never gets one).
 *
 * `null` is a real answer the caller must branch on: the two "parent a user CF
 * under the body frame" call sites fall back to the parent itself, and the
 * migration pass creates the missing frame. Neither invents one silently.
 *
 * `objects` may be any iterable of entities — a whole scene's `objects.values()`
 * or an already-parent-scoped child list; the `parentId` filter makes both safe.
 *
 * @param {Iterable<{name?: string, parentId?: string|null}>|null|undefined} objects
 * @param {string|null|undefined} parentId
 * @returns {{name?: string, parentId?: string|null}|null}
 */
export function findOriginFrame(objects, parentId) {
  if (parentId == null) return null
  for (const obj of objects ?? []) {
    if (obj?.parentId === parentId && isOriginFrame(obj)) return obj
  }
  return null
}
