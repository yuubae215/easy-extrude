/**
 * selectionAcrossProjection — which entities to re-select after a document edit
 * re-projected the scene (ADR-164 D1).
 *
 * A doc edit clears and rebuilds the projected scene. The ids usually come back
 * unchanged, but the clear drops the ACTIVE entity — the N panel's subject — so
 * declaring an object's mass on its own panel used to deselect it and leave the
 * panel showing the value from before the edit. Some edits also change ids:
 * ADR-159's adoption re-creates a screen object under its compiled id, and its
 * undo brings the original id back. Across all three the identity that survives
 * is the layout REF (ADR-129 — a declaration outlives the instance).
 *
 * Pure: the caller supplies the three readings; nothing here touches the scene.
 *
 * @param {{members: {id:string, ref:string|null}[], activeId: string|null}} kept
 *        the selection as captured before the projection
 * @param {{ exists: (id:string) => boolean,
 *           idForDocRef: (ref:string) => string|null,
 *           idForSceneRef: (ref:string) => string|null }} read
 * @returns {{ids: string[], activeId: string|null}|null} null = nothing to restore
 */
export function selectionAfterProjection(kept, read) {
  if (!kept || kept.members.length === 0) return null
  const now = (m) => {
    if (read.exists(m.id)) return m.id
    if (!m.ref) return null
    const id = read.idForDocRef(m.ref) ?? read.idForSceneRef(m.ref)
    return id && read.exists(id) ? id : null
  }
  const ids = [...new Set(kept.members.map(now).filter(Boolean))]
  if (ids.length === 0) return null
  const active = kept.members.find(m => m.id === kept.activeId)
  const activeNow = active ? now(active) : null
  return { ids, activeId: ids.includes(activeNow) ? activeNow : ids[0] }
}
