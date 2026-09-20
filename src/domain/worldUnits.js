/**
 * worldUnits — the ONE authority for what a Three.js world-unit means (ADR-136).
 *
 * `src/`'s world-unit is millimeters (matching Solid / Layout DSL / CoordinateFrame,
 * unchanged since before this ADR). Robotics inputs (the URDF, ROS/URDF-standard
 * meters) and the grasp-contract wire (meters, matching `plan.reachMin/reachMax`)
 * disagree, so every boundary where those meet the mm scene converts through this
 * module rather than each picking its own factor (§1.1 — one source of truth for
 * the conversion factor).
 *
 * Pure: no THREE, no DOM, no I/O.
 */

/** How many mm-scale world-units make one meter (the wire/URDF unit). */
export const MM_PER_METER = 1000

/** @param {number} mm @returns {number} meters */
export function mmToM(mm) { return mm / MM_PER_METER }

/** @param {number} m @returns {number} millimeters (world-units) */
export function mToMM(m) { return m * MM_PER_METER }

/**
 * @param {readonly [number, number, number]} point  [x,y,z] in mm (world-units)
 * @returns {[number, number, number]} the same point in meters
 */
export function mmPointToM([x, y, z]) {
  return [mmToM(x), mmToM(y), mmToM(z)]
}

/**
 * @param {readonly [number, number, number]} point  [x,y,z] in meters (wire)
 * @returns {[number, number, number]} the same point in mm (world-units)
 */
export function mPointToMM([x, y, z]) {
  return [mToMM(x), mToMM(y), mToMM(z)]
}

/**
 * A length written as an ABSOLUTE PHYSICAL QUANTITY, in millimetres (ADR-137 D2).
 *
 * This is a DECLARATION, not a conversion: `mm(1)` is `1` and always was. What it
 * adds is that the unit rides the CALL SITE's syntax, so the next person cannot
 * write a scale-bearing threshold without choosing a unit. ADR-136's `mmToM` /
 * `mToMM` convert between two conventions at a boundary; `mm()` converts nothing
 * and marks a number that was already in world-units as deliberately absolute.
 *
 * ADR-137 D1 closes scale-dependent quantities to exactly three declared kinds —
 * screen-space (`*_PX`, invariant to scene scale), scene-derived (a function of
 * the scene's bounding radius), and an absolute physical length (this). A bare
 * literal reaching a world-space sink is the fourth kind, which does not exist;
 * `src/WorldUnitCensus.test.js` counts the ones that are none of the three.
 *
 * @param {number} millimetres
 * @returns {number} the same number, in world-units
 */
export function mm(millimetres) { return millimetres }
