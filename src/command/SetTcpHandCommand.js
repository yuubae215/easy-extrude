/**
 * SetTcpHandCommand — records a change to what a robot grasps with (its tcp's
 * `hand`, ADR-152 D3) for undo/redo. Both directions go through the one writer,
 * `SceneService.setTcpHand` (原則 #1). `before` / `after` are snapshots the
 * command owns — `null` is UNDECLARED, restored as such (never as a default).
 *
 * @param {string} frameId  the tcp frame
 * @param {object|null} before
 * @param {object|null} after
 * @param {import('../service/SceneService.js').SceneService} sceneService
 * @returns {{label: string, execute(): void, undo(): void}}
 */
export function createSetTcpHandCommand(frameId, before, after, sceneService) {
  const snap = (h) => (h == null ? null : JSON.parse(JSON.stringify(h)))
  const b = snap(before)
  const a = snap(after)
  return {
    label: a == null ? 'Clear hand' : 'Set hand',
    execute() { sceneService.setTcpHand(frameId, a) },
    undo()    { sceneService.setTcpHand(frameId, b) },
  }
}
