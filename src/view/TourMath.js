/**
 * TourMath — pure derivation from scene facts to the onboarding tour's
 * eligible step (ADR-065 Phase 6, "オンボーディングツアー").
 *
 * The tour is the structural generalisation of the mobile first-visit gesture
 * overlay: instead of a one-shot poster, it derives the NEXT affordance from
 * committed scene facts (object count, selection, mode, the last CommandStack
 * landing) and pulses the matching control — discovery as a design
 * deliverable (PHILOSOPHY #16), expressed as a quest trail.
 *
 * DISCIPLINE:
 *   - Pure and THREE-free (`node --test` lane). No DOM, no store, no I/O.
 *   - A wrong hint is worse than none (#11): malformed facts never advance
 *     the tour, a corrupt state degrades to `null` (no hint), and a step
 *     already satisfied by the facts is SKIPPED, never re-asked.
 *   - The FSM state itself lives in `uiStore.tour` (a discriminated union,
 *     sole writer AppController — see STATE_TRANSITIONS §tour). It is
 *     user-visible APP state (which quest is open), not presentation
 *     history, so the uiStore placement does not violate ADR-062 §2.
 *   - Progress only moves FORWARD: `nextTourState` never regresses a step
 *     (undoing the added box does not resurrect the "Add a box" quest —
 *     the user has demonstrably seen that affordance).
 *   - Step "done" predicates read only committed facts: entity counts,
 *     the committed selection, the mode, and the last CommandStack landing
 *     (a landing is a committed operation — optimistic previews never land).
 */

/**
 * @typedef {object} TourFacts
 * @property {number} solidCount     Solid entities currently in the scene
 * @property {boolean} hasSelection  an object is actively selected
 * @property {string} mode           scene selection mode ('object'|'edit'|'map')
 * @property {string|null} lastLabel committed label of the most recent
 *                                   CommandStack landing (null before any)
 * @property {string|null} lastPhase 'push'|'undo'|'redo' of that landing
 */

/**
 * @typedef {{status:'active', step:string}|{status:'done'}} TourState
 * `null` (not shown: mobile / persisted done / dismissed) is the third
 * member of the union at the store level.
 */

/**
 * The ordered quest trail (desktop core-modeling loop, S-01…S-06). Each step
 * carries the affordance anchor it points at ('outliner-add' pulses the
 * Scene Collection "+ Add" button — Tier A affordance motion via the same
 * activeGlow vocabulary; 'canvas' renders the card only) and a `done`
 * predicate over committed facts.
 */
export const TOUR_STEPS = Object.freeze([
  Object.freeze({
    id:     'add',
    title:  'Add a box',
    text:   'Click “+ Add” in the Scene Collection — or press',
    keys:   Object.freeze(['Shift+A']),
    anchor: 'outliner-add',
    done:   (f) => f.solidCount >= 2, // the boot scene already has one solid
  }),
  Object.freeze({
    id:     'select',
    title:  'Select it',
    text:   'Click a box in the viewport to select it.',
    keys:   Object.freeze([]),
    anchor: 'canvas',
    done:   (f) => f.hasSelection,
  }),
  Object.freeze({
    id:     'grab',
    title:  'Move it',
    text:   'With a box selected, press G, move the mouse, then click to place it.',
    keys:   Object.freeze(['G']),
    anchor: 'canvas',
    // MoveCommand labels are 'Move' / 'Move N objects' (GrabOperationHandler).
    done:   (f) => f.lastPhase === 'push' && /^Move( |$)/.test(f.lastLabel ?? ''),
  }),
  Object.freeze({
    id:     'edit',
    title:  'Enter Edit Mode',
    text:   'Press Tab to edit the selected box’s vertices, edges and faces.',
    keys:   Object.freeze(['Tab']),
    anchor: 'canvas',
    done:   (f) => f.mode === 'edit',
  }),
  Object.freeze({
    id:     'extrude',
    title:  'Extrude a face',
    text:   'Click a face, drag to pull it out, then click to confirm.',
    keys:   Object.freeze([]),
    anchor: 'canvas',
    done:   (f) => f.lastPhase === 'push' && f.lastLabel === 'Face Extrude',
  }),
])

/** Facts validation — anything off-shape means "derive nothing" (#11). */
function isTourFacts(f) {
  return !!f && typeof f === 'object' &&
    Number.isFinite(f.solidCount) && f.solidCount >= 0 &&
    typeof f.hasSelection === 'boolean' &&
    typeof f.mode === 'string' && f.mode.length > 0 &&
    (f.lastLabel === null || typeof f.lastLabel === 'string') &&
    (f.lastPhase === null || f.lastPhase === 'push' ||
     f.lastPhase === 'undo' || f.lastPhase === 'redo')
}

/** First step at or after `from` whose `done(facts)` is false; -1 if none. */
function firstOpenIndex(facts, from = 0) {
  for (let i = Math.max(from, 0); i < TOUR_STEPS.length; i++) {
    if (!TOUR_STEPS[i].done(facts)) return i
  }
  return -1
}

/**
 * Start the tour from a facts snapshot: the first step the user has not
 * already satisfied becomes the open quest (a returning power user whose
 * facts satisfy everything gets no tour at all — nothing left to teach).
 *
 * @param {TourFacts} facts
 * @returns {TourState|null} `null` for malformed facts or a fully-satisfied trail
 */
export function startTour(facts) {
  if (!isTourFacts(facts)) return null
  const i = firstOpenIndex(facts)
  if (i === -1) return null
  return { status: 'active', step: TOUR_STEPS[i].id }
}

/**
 * FSM transition: advance the open quest when its `done` predicate holds
 * against the new facts, skipping any following steps the same facts already
 * satisfy; `{status:'done'}` after the last. Anything that cannot honestly
 * advance returns the SAME state reference (the caller can identity-compare
 * to skip a store write); a corrupt state (unknown step id) degrades to
 * `null` — no hint beats a wrong hint (#11).
 *
 * @param {TourState|null} state
 * @param {TourFacts} facts
 * @returns {TourState|null}
 */
export function nextTourState(state, facts) {
  if (!state || state.status !== 'active') return state
  if (!isTourFacts(facts)) return state
  const cur = TOUR_STEPS.findIndex(s => s.id === state.step)
  if (cur === -1) return null
  if (!TOUR_STEPS[cur].done(facts)) return state
  const nxt = firstOpenIndex(facts, cur + 1)
  if (nxt === -1) return { status: 'done' }
  return { status: 'active', step: TOUR_STEPS[nxt].id }
}

/**
 * Rendering projection of the open quest: the step descriptor plus its
 * 1-based position in the trail. `null` when there is nothing to render
 * (inactive, done — the done banner is the card's own literal).
 *
 * @param {TourState|null} state
 * @returns {{id:string, title:string, text:string, keys:readonly string[],
 *            anchor:string, index:number, total:number}|null}
 */
export function tourStepDescriptor(state) {
  if (!state || state.status !== 'active') return null
  const i = TOUR_STEPS.findIndex(s => s.id === state.step)
  if (i === -1) return null
  const { id, title, text, keys, anchor } = TOUR_STEPS[i]
  return { id, title, text, keys, anchor, index: i + 1, total: TOUR_STEPS.length }
}

/**
 * The affordance anchor the open quest points at, or `null`. Chrome controls
 * consult this (Outliner "+ Add" — Tier A breathing glow) so the card and the
 * pulsed control derive from ONE state (§1.1).
 *
 * @param {TourState|null} state
 * @returns {string|null}
 */
export function tourAnchor(state) {
  return tourStepDescriptor(state)?.anchor ?? null
}

/**
 * Whether the tour surface (card + anchor pulse) should render right now.
 * An active overlay suppresses the tour WITHOUT mutating its state — the
 * quest resumes where it was when the overlay closes. Shared by TourCard and
 * every anchor consumer so the two cannot disagree (§1.1).
 *
 * @param {TourState|null} state
 * @param {{contextActive?:boolean, demoActive?:boolean, galleryOpen?:boolean}} [overlays]
 * @returns {boolean}
 */
export function tourVisible(state, overlays = {}) {
  if (!state || (state.status !== 'active' && state.status !== 'done')) return false
  return !(overlays.contextActive || overlays.demoActive || overlays.galleryOpen || overlays.homeOpen)
}
