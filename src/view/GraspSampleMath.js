/**
 * GraspSampleMath — what the line on each grasp sample MEANS (ADR-155 D3).
 *
 * THREE-free, so the unit lane can pin it; `GraspSampleView` only turns the
 * result into geometry.
 *
 * ## The line is the tool
 *
 * Each sample carries a point and the face's outward normal (the wire facts,
 * ADR-128). The line used to be the normal drawn at a fixed 3 × marker radius
 * — a length that meant nothing, so a sample at the bottom of a 150 mm deep bin
 * looked exactly as reachable as one on a table top.
 *
 * With the robot's axial tool mount declared (ADR-151), the line is now the TOOL
 * itself for a straight-in approach: the TCP on the sample, the flange at
 * `point + normal · L` (the approach is `−normal`, so the tool stands out of the
 * face along the normal). Whether the flange clears a bin's rim is then
 * something the user SEES before running. Whether that clearance is enough —
 * interference, tilt, the wrist beyond the flange — is still `core/`'s to
 * decide (CLAUDE.md §AI 向けガード axis 1); this is a closed-form picture of the
 * declared length (axis 3), not a judgement.
 *
 * Without a declared axial mount there is no length to draw, and inventing one
 * would be a picture of a tool nobody has (原則 #31): the line falls back to the
 * short normal whisker, and `flanges` is empty — two looks for two facts.
 *
 * What this does NOT show: a tilted approach (`tiltTolerance`), a jaw's grasp
 * depth, or anything above the flange. It is the straight-in, depth-0 case.
 *
 * @module view/GraspSampleMath
 */

/** Normal whisker length, as a multiple of the marker radius (no tool declared). */
export const WHISKER = 3

/**
 * Line segments (and flange points) for a set of samples.
 *
 * @param {{point:number[], normal?:number[]}[]} samples  wire-shaped, world mm
 * @param {{radius:number, toolLengthMm?:number|null}} opts
 *        `radius` — the marker radius (the whisker's unit when no tool);
 *        `toolLengthMm` — the axial mount (TCP → flange, mm), or null
 * @returns {{kind:'tool'|'normal', positions:number[], flanges:number[][]}}
 *          `positions` — flat [x0,y0,z0, x1,y1,z1, …] pairs for LineSegments
 */
export function sampleLines(samples, { radius, toolLengthMm = null }) {
  const tool = typeof toolLengthMm === 'number' && Number.isFinite(toolLengthMm) && toolLengthMm > 0
  const L = tool ? toolLengthMm : radius * WHISKER
  const positions = []
  const flanges = []
  for (const s of samples ?? []) {
    const [x, y, z] = s.point
    const [nx, ny, nz] = s.normal ?? [0, 0, 0]
    const end = [x + nx * L, y + ny * L, z + nz * L]
    positions.push(x, y, z, ...end)
    if (tool) flanges.push(end)
  }
  return { kind: tool ? 'tool' : 'normal', positions, flanges }
}
