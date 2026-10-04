/**
 * GraspPhaseMath — how the interference-by-motion-phase facts are SHOWN (ADR-157).
 *
 * The wire carries decided facts only (ADR-060): six phase rows
 * (`evaluated{rejected}` / `unevaluated{reason}`) and, when asked, the all-phase
 * analysis with `obstacleIndex` numbers. Everything a person reads — the phase
 * words, why a phase was not judged, which body an index is — is derived HERE,
 * client-side, and never sent back (原則 #29).
 *
 * Every table throws on a key it does not declare (原則 #31): a new phase,
 * reason or part that nobody wrote words for must fail loudly rather than
 * render as a blank row that reads like "fine".
 *
 * 未実装 (DEF-059): replaying the phases over time in the viewport — the
 * original "share it at 30fps" ask, lifted to "receive the phase facts once,
 * derive the replay here". Only the facts half is in.
 *
 * Pure (no THREE / no DOM / no store).
 *
 * @module view/GraspPhaseMath
 */

/** The motion phases in motion order — the contract's closed vocabulary. */
export const MOTION_PHASES = Object.freeze(['transit', 'approach', 'close', 'lift', 'transport', 'place'])

/** What each phase is called on screen. */
export const PHASE_LABEL = Object.freeze({
  transit:   'Move to pre-grasp',
  approach:  'Approach',
  close:     'Close the hand',
  lift:      'Lift out',
  transport: 'Carry',
  place:     'Place',
})

/**
 * Why a phase was not judged, in words that say what to DO (原則 #11 — the
 * reason travels with the thing). Keyed by the contract's closed `reason`.
 */
export const UNEVALUATED_REASON_TEXT = Object.freeze({
  notYetDecided:       'not judged yet — the solver has no method for this phase',
  gripperUndeclared:   'not judged — declare the hand on the robot tcp',
  handShapeUndeclared: 'not judged — declare the hand\'s body and fingers',
  targetBoxUndeclared: 'not judged — the object has no box to measure',
  liftUndeclared:      'not judged — declare how the object is lifted out ("lift" on the object)',
})

/** What each struck part is called on screen (the contract's `hits[].part`). */
export const PART_LABEL = Object.freeze({
  tcpPath: 'tool path',
  arm:     'arm',
  hand:    'hand',
  held:    'held object',
})

function lookup(table, key, name) {
  if (!Object.prototype.hasOwnProperty.call(table, key)) {
    throw new Error(`GraspPhaseMath: 未宣言の${name} "${key}" — 表に行を足すこと (ADR-157 / 原則 #31)`)
  }
  return table[key]
}

/**
 * The six phase rows as the panel renders them. Null when the response predates
 * contract v8 (no rows to show — never six invented "0"s).
 *
 * @param {object|null} diagnostics  the wire `diagnostics`
 * @returns {{phase:string, label:string, evaluated:boolean, rejected:number|null, note:string|null}[]|null}
 */
export function phaseRows(diagnostics) {
  const rows = diagnostics?.interferencePhases
  if (!Array.isArray(rows)) return null
  return rows.map(r => {
    const label = lookup(PHASE_LABEL, r.phase, 'phase')
    if (r.kind === 'evaluated') return { phase: r.phase, label, evaluated: true, rejected: r.rejected, note: null }
    if (r.kind === 'unevaluated') {
      return { phase: r.phase, label, evaluated: false, rejected: null,
        note: lookup(UNEVALUATED_REASON_TEXT, r.reason, 'unevaluated reason') }
    }
    throw new Error(`GraspPhaseMath: 未宣言の相の kind "${r.kind}"`)
  })
}

/**
 * The all-phase analysis with every obstacle index turned into the name of the
 * body it came from. `obstacleLabels` is the list the SAME request's obstacles
 * were built from (index-aligned), so the name cannot drift from the index.
 *
 * @param {object|null} analysis         the wire `interferenceAnalysis`
 * @param {string[]} obstacleLabels
 * @returns {{candidatesAnalysed:number, phases:{phase:string,label:string,collided:number,
 *            hits:{part:string, partLabel:string, obstacle:string, candidates:number}[]}[]}|null}
 */
export function analysisSummary(analysis, obstacleLabels) {
  if (analysis?.kind !== 'allPhases') return null
  return {
    candidatesAnalysed: analysis.candidatesAnalysed,
    phases: analysis.phases.map(p => ({
      phase: p.phase,
      label: lookup(PHASE_LABEL, p.phase, 'phase'),
      collided: p.collided,
      hits: p.hits.map(h => ({
        part: h.part,
        partLabel: lookup(PART_LABEL, h.part, 'part'),
        // An index the labels do not cover is shown as a number, never dropped —
        // a hit with no name is still a hit.
        obstacle: obstacleLabels?.[h.obstacleIndex] ?? `obstacle #${h.obstacleIndex}`,
        candidates: h.candidates,
      })),
    })),
  }
}

/**
 * Whether the analysis on screen is about the search on screen (ADR-157 D6).
 * DERIVED on every read from the identity of the request it was run for — never
 * stored (原則 #23): a new search replaces `grasp.request`, and the analysis
 * becomes stale without anybody remembering to mark it.
 *
 * @param {object|null} analysisState  `context.graspAnalysis`
 * @param {object|null} grasp          `context.grasp`
 * @returns {'none'|'fresh'|'stale'}
 */
export function analysisFreshness(analysisState, grasp) {
  if (!analysisState) return 'none'
  return grasp?.status === 'results' && grasp.request === analysisState.request ? 'fresh' : 'stale'
}

/**
 * Whether the all-phase analysis can be offered, and if not, why (原則 #15 — the
 * button keeps its slot, disabled with the reason). Backend only (ADR-157 D6):
 * a stubbed build fabricates numbers, and fabricating an analysis would teach a
 * reviewer to trust a breakdown nothing computed.
 *
 * @param {{stubLane:boolean, bffConnected:boolean, grasp:object|null, analysisState:object|null}} s
 * @returns {{enabled:boolean, reason:string|null}}
 */
export function analysisAvailability({ stubLane, bffConnected, grasp, analysisState }) {
  if (stubLane) return { enabled: false, reason: 'Needs the real backend — this build answers locally with stubbed numbers.' }
  if (!bffConnected) return { enabled: false, reason: 'Needs the backend — start the stack (pnpm dev:stack).' }
  if (grasp?.status !== 'results') return { enabled: false, reason: 'Run a search first — the analysis re-checks that search.' }
  if (analysisState?.status === 'running') return { enabled: false, reason: 'Analysing in the background…' }
  return { enabled: true, reason: null }
}
