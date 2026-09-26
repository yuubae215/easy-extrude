/**
 * Rotate a vector by a unit quaternion — the one pure implementation the grasp
 * domain shares (graspTargets: samples and obstacle boxes; graspFeature: the
 * world word a local face points to, ADR-152 D2).
 *
 * @module domain/rotateVec3
 */

/**
 * Rotate a vector by a quaternion (pure; the standard
 * v + 2q_w(q_v × v) + 2(q_v × (q_v × v)) form, no matrix allocation).
 *
 * This is coordinate math on a declared pose, not a kinematic solution — the same
 * arithmetic the view layer already does to place a mesh.
 *
 * @param {{x:number,y:number,z:number}} v
 * @param {{x:number,y:number,z:number,w:number}} q
 * @returns {{x:number,y:number,z:number}}
 */
export function rotateVec3(v, q) {
  // t = 2 * (q_v × v)
  const tx = 2 * (q.y * v.z - q.z * v.y)
  const ty = 2 * (q.z * v.x - q.x * v.z)
  const tz = 2 * (q.x * v.y - q.y * v.x)
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  }
}
