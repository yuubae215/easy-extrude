/**
 * ZoneOwnershipController — reads which zones overlap and who owns them, and
 * puts the conflicts on screen (ADR-170 O2 / D2 / S3).
 *
 * Two sources, joined here and nowhere else:
 *
 *   the live plates (the scene) — where the zones are now. The document's layout
 *       does not follow a drag, so an overlap is read from what is on screen.
 *   the owners (the document)   — `owners[]`, read through `zoneOwnerOf`. A zone
 *       the document has no ref for, or a scene with no document, is UNDECLARED.
 *
 *   → the 3D plates: `meshView.setOwnerConflict(bool)` — this controller is the
 *     flag's only writer (原則 #4)
 *   → the zone's N-panel section: `panelFor(zoneId)` (pure — ZoneOwnershipMath)
 *
 * Refreshed on events, never polled (原則 #5): the caller schedules `refresh()`
 * on the document edge, on a committed operation (the command stack's landing —
 * a drag, an undo) and on scene lifecycle; bursts fold into one microtask.
 *
 * Holds no rule of its own: overlap and its reading are `domain/zone.js`, the
 * owner's value is `context/Ownership.js`, the sentences are the view math.
 *
 * @module controller/ZoneOwnershipController
 */
import { isZone, zoneOverlaps } from '../domain/zone.js'
import { zoneOwnerOf, zoneOwnerKind } from '../context/Ownership.js'
import { conflictedZoneIds, zonePanel } from '../view/ZoneOwnershipMath.js'

export class ZoneOwnershipController {
  /**
   * @param {{
   *   objects: () => Iterable<any>,
   *   ctxService: {getDoc: () => object|null, refForSceneId: (id: string) => string|null},
   *   speaker: () => string|null,
   * }} deps
   */
  constructor({ objects, ctxService, speaker }) {
    this._objects = objects
    this._ctx = ctxService
    this._speaker = speaker
    /** @type {Array<{a:any, b:any, kind:string}>} */
    this._pairs = []
    /** @type {Set<string>} zones whose plate was lit at the last refresh */
    this._lit = new Set()
    this._pending = false
  }

  /** Fold a burst of events into one refresh. */
  schedule() {
    if (this._pending) return
    this._pending = true
    queueMicrotask(() => {
      this._pending = false
      this.refresh()
    })
  }

  _ownerOf(zone) {
    const doc = this._ctx.getDoc?.() ?? null
    const ref = doc ? this._ctx.refForSceneId?.(zone.id) ?? null : null
    return zoneOwnerKind(ref ? zoneOwnerOf(doc, ref) : undefined)
  }

  _zones() { return [...this._objects()].filter(isZone) }

  /** Re-read overlaps and owners; light exactly the conflicted plates. */
  refresh() {
    const zones = this._zones()
    this._pairs = zoneOverlaps({ zones, ownerOf: (z) => this._ownerOf(z) })
    const lit = conflictedZoneIds(this._pairs)
    // Every plate is told each time — a re-projected zone comes back with a new
    // view under the same id, and remembering "already lit" would skip it.
    for (const z of zones) z.meshView?.setOwnerConflict?.(lit.has(z.id))
    this._lit = lit
  }

  /** The zones currently lit as in conflict (read by tests and e2e). */
  get conflicted() { return new Set(this._lit) }

  /**
   * The panel model for a selected zone — read fresh, so the section never
   * waits on a scheduled refresh (原則 #23).
   * @param {string} zoneId
   */
  panelFor(zoneId) {
    this.refresh()
    const zone = this._zones().find(z => z.id === zoneId)
    if (!zone) return null
    const doc = this._ctx.getDoc?.() ?? null
    return zonePanel({
      zone,
      owner: this._ownerOf(zone),
      pairs: this._pairs,
      hasDocument: doc !== null,
      zoneRef: doc ? this._ctx.refForSceneId?.(zone.id) ?? null : null,
      speaker: this._speaker(),
    })
  }
}
