/**
 * EventEmitter - minimal publish/subscribe utility.
 *
 * Intentionally tiny: no wildcard events, no async dispatch.
 * Sufficient for in-process domain-event wiring inside easy-extrude.
 */
export class EventEmitter {
  constructor() {
    /** @type {Map<string, Function[]>} */
    this._listeners = new Map()
  }

  /**
   * Subscribe to an event.
   * @param {string}   event
   * @param {Function} listener
   * @returns {this}
   */
  on(event, listener) {
    if (!this._listeners.has(event)) this._listeners.set(event, [])
    this._listeners.get(event).push(listener)
    return this
  }

  /**
   * Unsubscribe a previously registered listener.
   * @param {string}   event
   * @param {Function} listener
   * @returns {this}
   */
  off(event, listener) {
    const list = this._listeners.get(event)
    if (!list) return this
    const idx = list.indexOf(listener)
    if (idx !== -1) list.splice(idx, 1)
    return this
  }

  /**
   * Emit an event, calling all registered listeners synchronously.
   * @param {string} event
   * @param {...*}   args
   */
  emit(event, ...args) {
    const list = this._listeners.get(event)
    if (list) list.slice().forEach(fn => fn(...args))
  }
}
