/**
 * SetCameraCommand — records a change to a vision camera (ADR-164 D3) for
 * undo/redo: its declaration (`camera` — the field of view), and optionally its
 * world pose ("copy the current view" moves the camera AND sets its fov as ONE
 * act, so one undo puts both back). Every write goes through the scene's single
 * writers (`setFrameCamera` / `setCameraWorldPose` — 原則 #1). `before` /
 * `after` are snapshots the command owns.
 *
 * @param {string} frameId
 * @param {{camera: object|null, pose?: {position: object, rotation: object}}} before
 * @param {{camera: object|null, pose?: {position: object, rotation: object}}} after
 * @param {import('../service/SceneService.js').SceneService} sceneService
 * @param {string} [label]
 * @returns {{label: string, execute(): void, undo(): void}}
 */
export function createSetCameraCommand(frameId, before, after, sceneService, label = 'Set camera') {
  const snap = (v) => (v == null ? null : JSON.parse(JSON.stringify(v)))
  const b = snap(before)
  const a = snap(after)
  const apply = (s) => {
    if (s?.pose) sceneService.setCameraWorldPose(frameId, s.pose)
    sceneService.setFrameCamera(frameId, s?.camera ?? null)
  }
  return {
    label,
    execute() { apply(a) },
    undo()    { apply(b) },
  }
}
