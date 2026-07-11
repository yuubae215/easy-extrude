/**
 * RegionGhostMath — pure derivations for the region-ghost overlay and the
 * conflict-resolution choreography (ADR-049 §5.3 view math, ADR-065 Phase 5).
 *
 * Everything here derives *presentation* geometry from proof-layer facts —
 * `PersonaProjection.projectRegionGhosts` entries (whose `state` mirrors the
 * conflict matrix and whose `intersection` comes from `RegionGeometry`).
 * Nothing here re-implements the validator's conflict judgment (ADR-062):
 * a transition is recognised purely by comparing two committed projections.
 *
 * Pure: no THREE, no DOM, no I/O, input-immutable — loads under bare
 * `node --test`.
 *
 * @module view/RegionGhostMath
 */
import { COLOR, hexNumber } from '../theme/tokens.js'

/** Conflict gap colour (empty intersection band) — single source for the
 * RegionGhostView band and the RegionResolveEffect recolor start. */
export const GAP_COLOR = 0xcc3333
/** Resolution flood colour (the "it settled" green — token-derived). */
export const RESOLVE_COLOR = hexNumber(COLOR.fxGreen)

/** Fallback range when neither the intersection box nor the domain bounds the
 * non-empty axis (mirrors the view's historical fallback). */
const FALLBACK_RANGE = [-100, 100]

/**
 * The no-man's-land band rectangles of ONE ghost's empty intersection — the
 * red "共通部分なし = 衝突" bands. Extracted from RegionGhostView so the live
 * overlay and the resolve-transition effect share ONE geometry derivation
 * (核 §1.1). Non-empty (or malformed) intersections yield [] — a band is only
 * ever derived from a committed empty-intersection fact (PHILOSOPHY #11).
 *
 * @param {object} ghost — one projectRegionGhosts() entry
 * @returns {{axis: string, x: [number, number], y: [number, number], gap: [number, number]}[]}
 */
export function gapBandRects(ghost) {
  const inter = ghost?.intersection
  if (!inter?.empty || !Array.isArray(inter.emptyAxes)) return []
  const axes = Array.isArray(ghost.axes) && ghost.axes.length > 0 ? ghost.axes : ['x', 'y']
  const rects = []
  for (const axis of inter.emptyAxes) {
    const g = inter.gap?.[axis]
    if (!Array.isArray(g) || g.length !== 2 || !g.every(Number.isFinite)) continue
    const other = axes.find(a => a !== axis) ?? (axis === 'x' ? 'y' : 'x')
    const common = inter.box?.[other]
    const oRange = (Array.isArray(common) && common[0] < common[1])
      ? common
      : (ghost.domain?.[other] ?? FALLBACK_RANGE)
    const lo = Math.min(g[0], g[1]), hi = Math.max(g[0], g[1])
    rects.push({
      axis,
      x: axis === 'x' ? [lo, hi] : [oRange[0], oRange[1]],
      y: axis === 'y' ? [lo, hi] : [oRange[0], oRange[1]],
      gap: [lo, hi],
    })
  }
  return rects
}

/** Ghost states that render a live conflict gap band. */
const LIVE_STATES = new Set(['conflict', 'proposed'])
/** Ghost states that mean the cell settled. */
const SETTLED_STATES = new Set(['resolved', 'satisfied'])

/**
 * Conflict-cell resolutions between two committed ghost projections — the 3-D
 * counterpart of the conflict-matrix cell flash (ADR-062 / ADR-065 Phase 5).
 * A variable transitions when its previous ghost rendered a live gap band
 * (state conflict/proposed AND an empty intersection) and its next projection
 * settled (state resolved/satisfied, or the intersection became non-empty
 * after a region edit).
 *
 * Recognition only — never a judgment: both inputs are validator-derived
 * projections. A variable that disappeared from the next projection is NOT a
 * resolution (we cannot claim a settlement nobody committed — PHILOSOPHY #11).
 * Malformed inputs yield [].
 *
 * @param {object[]|null|undefined} prevGhosts — projection before the doc change
 * @param {object[]|null|undefined} nextGhosts — projection after
 * @returns {{variable: string, rects: ReturnType<typeof gapBandRects>}[]}
 */
export function regionResolveTransitions(prevGhosts, nextGhosts) {
  if (!Array.isArray(prevGhosts) || !Array.isArray(nextGhosts)) return []
  const nextByVar = new Map(
    nextGhosts.filter(g => g && typeof g.variable === 'string').map(g => [g.variable, g]),
  )
  const out = []
  for (const prev of prevGhosts) {
    if (!prev || typeof prev.variable !== 'string') continue
    if (!LIVE_STATES.has(prev.state)) continue
    const next = nextByVar.get(prev.variable)
    if (!next) continue
    const settled = SETTLED_STATES.has(next.state) || next.intersection?.empty === false
    if (!settled) continue
    const rects = gapBandRects(prev)
    if (rects.length === 0) continue
    out.push({ variable: prev.variable, rects })
  }
  return out
}

/** Fraction of the resolve effect spent recolouring (red → green) before the
 * dissolve begins. */
export const RESOLVE_RECOLOR_SPLIT = 0.35
/** Static opacity of the held reduced-motion cue / the band during recolor. */
const RESOLVE_OPACITY = 0.3

/**
 * Presentation frame of the recolor→dissolve resolve effect at progress `p`.
 * Phase 1 (p < RESOLVE_RECOLOR_SPLIT): the gap band floods red → green at
 * constant opacity. Phase 2: fully green, fading out.
 *
 * Reduced motion holds a static green cue for the whole duration (information
 * preserved — the band visibly settled — movement dropped, PHILOSOPHY #30).
 * A non-finite progress renders nothing rather than a fabricated frame (#11).
 *
 * @param {number} p — progress ∈ [0,1]
 * @param {boolean} [reduced=false]
 * @returns {{mix: number, opacity: number}} mix 0 = GAP_COLOR, 1 = RESOLVE_COLOR
 */
export function resolveFrame(p, reduced = false) {
  if (reduced) return { mix: 1, opacity: RESOLVE_OPACITY }
  if (!Number.isFinite(p)) return { mix: 1, opacity: 0 }
  const t = Math.min(1, Math.max(0, p))
  if (t < RESOLVE_RECOLOR_SPLIT) {
    return { mix: t / RESOLVE_RECOLOR_SPLIT, opacity: RESOLVE_OPACITY }
  }
  const fade = (t - RESOLVE_RECOLOR_SPLIT) / (1 - RESOLVE_RECOLOR_SPLIT)
  return { mix: 1, opacity: RESOLVE_OPACITY * (1 - fade) }
}
