/**
 * fixedJointFollowers — which objects a move carries along through fixed joints.
 *
 * Pure (no THREE, no DOM): the THREE-free `node --test` lane exercises the rule.
 *
 * A fixed joint (`jointType: 'fixed'`, not a `mounts`) drives its SOURCE frame's
 * world pose from its TARGET frame every animation frame; the source frame's root
 * Solid follows (SceneService `_updateFixedJointFrames`). So moving the root of a
 * target moves the root of the source too — transitively (a bin carries its
 * workpieces; a pedestal carries the robot on it).
 *
 * Why it is named (ADR-162 D3): a confirmed move of a document-owned object is a
 * declaration written to the document (ADR-129 D1). Writing only the selection
 * left every carried object at its old written pose, and the regeneration that
 * follows the write put it back there — the bin moved and its workpieces did not.
 *
 * @module domain/fixedJointFollowers
 */

/**
 * True when a link drives its source frame's pose from its target — the one
 * reading of "this link carries" (SceneService `_reactivateLiveLinks` uses it too).
 * @param {{jointType?: string|null, semanticType?: string|null}} link
 * @returns {boolean}
 */
export function drivesSourcePose(link) {
  return link?.jointType === 'fixed' && link?.semanticType !== 'mounts'
}

/**
 * The root objects carried along when `movedIds` move, NOT including the moved
 * ones themselves.
 *
 * @param {Array<{id: string, parentId?: string|null, isFrame: boolean}>} objects
 * @param {Array<{sourceId: string, targetId: string, jointType?: string|null, semanticType?: string|null}>} links
 * @param {Iterable<string>} movedIds
 * @returns {Set<string>}
 */
export function fixedJointFollowers(objects, links, movedIds) {
  const byId = new Map(objects.map(o => [o.id, o]))
  const rootOf = id => {
    let node = byId.get(id)
    const seen = new Set()
    while (node?.isFrame && !seen.has(node.id)) {
      seen.add(node.id)
      node = byId.get(node.parentId)
    }
    return node && !node.isFrame ? node.id : null
  }
  const driving = links.filter(drivesSourcePose)
    .map(l => ({ from: rootOf(l.targetId), to: rootOf(l.sourceId) }))
    .filter(e => e.from && e.to && e.from !== e.to)

  const moving = new Set(movedIds)
  const carried = new Set()
  let grew = true
  while (grew) {
    grew = false
    for (const { from, to } of driving) {
      if (moving.has(from) && !moving.has(to)) {
        moving.add(to)
        carried.add(to)
        grew = true
      }
    }
  }
  return carried
}
