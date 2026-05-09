/**
 * Lightweight Moore-Mealy hybrid FSM.
 *
 * Matches the JSON notation used in docs/STATE_TRANSITIONS.md §Formal FSM Specification:
 *   - States are plain strings (use constants from src/core/editorStates.js)
 *   - Each transition: { from, on, to, guard?, action? }
 *   - guard: () => boolean — optional; transition is blocked when it returns false
 *   - action: () => void  — called exactly once when the transition fires (Mealy edge action)
 *   - Guard precedence: first matching transition in the array fires
 */
export class StateMachine {
  #state
  #transitions

  /** @param {string} initial @param {Array<{from,on,to,guard?,action?}>} transitions */
  constructor(initial, transitions) {
    this.#state = initial
    this.#transitions = transitions
  }

  /** Current state name. */
  get state() { return this.#state }

  /** Returns true when the current state equals s. */
  is(s) { return this.#state === s }

  /**
   * Send an event. Finds the first transition whose `from` matches the current state,
   * `on` matches the event, and whose guard (if present) returns true.
   * Calls action (if any), then updates state.
   * @returns {boolean} true if a transition fired, false if none matched.
   */
  send(event) {
    const t = this.#transitions.find(
      t => t.from === this.#state && t.on === event && (!t.guard || t.guard())
    )
    if (!t) return false
    t.action?.()
    this.#state = t.to
    return true
  }

  /**
   * Dry-run: returns true if send(event) would fire at least one transition
   * from the current state (guard evaluated).
   */
  can(event) {
    return this.#transitions.some(
      t => t.from === this.#state && t.on === event && (!t.guard || t.guard())
    )
  }
}
