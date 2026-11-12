/**
 * visionCamera.test.js — the camera as a scene entity (ADR-164 D3).
 *
 * Evidence for: identity is one predicate; 0 / 1 / N select like the robot
 * picker; the wire's viewAxis is DERIVED from the frame's rotation along optical
 * +Z (checked with the SAME pose turned +90° and −90°, so a sign error cannot
 * pass by symmetry); "copy the current view" lands the optical frame on the
 * viewport's line of sight; the drawn square frustum inscribes the judged cone.
 *
 * Run with:  node --test src/domain/visionCamera.test.js
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isCameraFrame, cameraDeclarationOf, CAMERA_STATE, resolveCameras, cameraCardinality,
  selectCamera, wireCameraOf, cameraPoseFromViewport, frustumCorners, quaternionFromBasis, withFieldOfView, requestAsksVisibility,
  cameraSeedPose, nextCameraName, CAMERA_VIEW_AXIS_LOCAL,
} from './visionCamera.js'
import { rotateVec3 } from './rotateVec3.js'

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`)
const closeVec = (a, b, eps = 1e-4) => a.forEach((v, i) => close(v, b[i], eps))
const IDENT = { x: 0, y: 0, z: 0, w: 1 }
const aboutX = (rad) => ({ x: Math.sin(rad / 2), y: 0, z: 0, w: Math.cos(rad / 2) })

test('identity: a frame is a camera iff it carries a camera declaration object', () => {
  assert.equal(isCameraFrame({ camera: {} }), true)
  assert.equal(isCameraFrame({ camera: { fovHalfAngle: 0.5 } }), true)
  assert.equal(isCameraFrame({ camera: null }), false)
  assert.equal(isCameraFrame({}), false)
  assert.equal(isCameraFrame({ camera: [] }), false)
  assert.equal(isCameraFrame(null), false)
})

test('declaration: fov absent is declared-without-gate, never a default; bad fov is malformed', () => {
  assert.deepEqual(cameraDeclarationOf({ camera: {} }), { state: CAMERA_STATE.DECLARED, fov: null, errors: [] })
  assert.deepEqual(cameraDeclarationOf({ camera: { fovHalfAngles: { horizontal: 0.5, vertical: 0.3 } } }).fov, { horizontal: 0.5, vertical: 0.3 })
  for (const bad of [0, -1, Math.PI / 2, 'wide', NaN]) {
    for (const camera of [{ fovHalfAngle: bad }, { fovHalfAngles: { horizontal: bad, vertical: 0.3 } }, { fovHalfAngles: { horizontal: 0.3, vertical: bad } }]) {
      const d = cameraDeclarationOf({ camera })
      assert.equal(d.state, CAMERA_STATE.MALFORMED, `fov ${JSON.stringify(camera)}`)
      assert.equal(d.errors.length, 1)
    }
  }
  assert.equal(cameraDeclarationOf({ camera: { fovHalfAngles: { horizontal: 0.3 } } }).state, CAMERA_STATE.MALFORMED)
  assert.equal(cameraDeclarationOf({ name: 'frame' }), null)
})

test('declaration: the pre-ADR-171 single half angle reads as the square it was drawn as', () => {
  assert.deepEqual(cameraDeclarationOf({ camera: { fovHalfAngle: 0.4 } }).fov, { horizontal: 0.4, vertical: 0.4 })
})

test('declaration: both forms on one camera is malformed — two answers to one question', () => {
  const d = cameraDeclarationOf({ camera: { fovHalfAngle: 0.4, fovHalfAngles: { horizontal: 0.5, vertical: 0.3 } } })
  assert.equal(d.state, CAMERA_STATE.MALFORMED)
  assert.equal(d.fov, null)
})

test('writer shape: always the two-angle form, the old key dropped, other keys kept', () => {
  assert.deepEqual(withFieldOfView({ fovHalfAngle: 0.4, note: 'x' }, { horizontal: 0.5, vertical: 0.3 }), { note: 'x', fovHalfAngles: { horizontal: 0.5, vertical: 0.3 } })
  assert.deepEqual(withFieldOfView({ fovHalfAngles: { horizontal: 0.5, vertical: 0.3 } }, null), {})
  assert.deepEqual(withFieldOfView(null, null), {})
})

test('roster: 0 / 1 / N — implicit single, explicit pick for N, never first-wins', () => {
  const a = { id: 'a', name: 'cam A', camera: {} }
  const b = { id: 'b', name: 'cam B', camera: {} }
  const plain = { id: 'p', name: 'frame' }
  assert.equal(cameraCardinality(resolveCameras([plain])), 'none')
  assert.equal(selectCamera(resolveCameras([plain]), null), null)
  const one = resolveCameras([plain, a])
  assert.equal(cameraCardinality(one), 'single')
  assert.equal(selectCamera(one, null).id, 'a')
  const two = resolveCameras([a, plain, b])
  assert.equal(cameraCardinality(two), 'multi')
  assert.equal(selectCamera(two, null), null)
  assert.equal(selectCamera(two, 'b').id, 'b')
  assert.equal(selectCamera(two, 'gone'), null)
})

test('wire: position mm → m, viewAxis = rotation · optical +Z; the rectangle and imageUp only with a declared fov', () => {
  const decl = cameraDeclarationOf({ camera: { fovHalfAngles: { horizontal: 0.5, vertical: 0.3 } } })
  const w = wireCameraOf({ position: { x: 1000, y: -500, z: 1200 }, quaternion: IDENT }, decl)
  assert.deepEqual(w, { position: [1, -0.5, 1.2], viewAxis: [0, 0, 1], fovHalfAngles: { horizontal: 0.5, vertical: 0.3 }, imageUp: [0, -1, 0] })
  const noFov = wireCameraOf({ position: { x: 0, y: 0, z: 0 }, quaternion: IDENT }, cameraDeclarationOf({ camera: {} }))
  assert.deepEqual(Object.keys(noFov).sort(), ['position', 'viewAxis'])
})

test('wire: never the cone — an old one-number camera is sent as the square that is drawn', () => {
  const w = wireCameraOf({ position: { x: 0, y: 0, z: 0 }, quaternion: IDENT }, cameraDeclarationOf({ camera: { fovHalfAngle: 0.4 } }))
  assert.equal('fovHalfAngle' in w, false)
  assert.deepEqual(w.fovHalfAngles, { horizontal: 0.4, vertical: 0.4 })
})

test('wire: rolling the camera about its line of sight turns imageUp, not viewAxis', () => {
  const aboutZ = (rad) => ({ x: 0, y: 0, z: Math.sin(rad / 2), w: Math.cos(rad / 2) })
  const decl = cameraDeclarationOf({ camera: { fovHalfAngles: { horizontal: 0.5, vertical: 0.3 } } })
  const w0 = wireCameraOf({ position: { x: 0, y: 0, z: 0 }, quaternion: IDENT }, decl)
  const w90 = wireCameraOf({ position: { x: 0, y: 0, z: 0 }, quaternion: aboutZ(Math.PI / 2) }, decl)
  closeVec(w90.viewAxis, w0.viewAxis)
  closeVec(w90.imageUp, [1, 0, 0])   // R_z(+90°)·(0,−1,0) = (1,0,0)
})

test('wire: the same pose turned +90° and −90° about X looks in OPPOSITE directions (sign cannot pass by symmetry)', () => {
  const decl = cameraDeclarationOf({ camera: {} })
  const plus  = wireCameraOf({ position: { x: 0, y: 0, z: 0 }, quaternion: aboutX(+Math.PI / 2) }, decl)
  const minus = wireCameraOf({ position: { x: 0, y: 0, z: 0 }, quaternion: aboutX(-Math.PI / 2) }, decl)
  // R_x(+90°)·(0,0,1) = (0,−1,0); R_x(−90°)·(0,0,1) = (0,+1,0)
  closeVec(plus.viewAxis,  [0, -1, 0])
  closeVec(minus.viewAxis, [0,  1, 0])
})

test('wire: malformed declaration or unresolved pose ships nothing', () => {
  assert.equal(wireCameraOf({ position: { x: 0, y: 0, z: 0 }, quaternion: IDENT }, cameraDeclarationOf({ camera: { fovHalfAngle: 9 } })), null)
  assert.equal(wireCameraOf(null, cameraDeclarationOf({ camera: {} })), null)
})

test('quaternionFromBasis reproduces the basis it was given (all four Shepperd branches)', () => {
  const bases = [
    [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }],
    [{ x: 1, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: -1 }],
    [{ x: -1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: -1 }],
    [{ x: -1, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: 1 }],
    [{ x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }],
  ]
  for (const [xa, ya, za] of bases) {
    const q = quaternionFromBasis(xa, ya, za)
    for (const [local, want] of [[{ x: 1, y: 0, z: 0 }, xa], [{ x: 0, y: 1, z: 0 }, ya], [{ x: 0, y: 0, z: 1 }, za]]) {
      const got = rotateVec3(local, q)
      closeVec([got.x, got.y, got.z], [want.x, want.y, want.z])
    }
  }
})

test('copy current view: optical +Z = the viewport line of sight (three −Z), optical +Y = three −Y', () => {
  // A THREE camera at (0,0,1000) looking at the origin with up +Y: identity rotation.
  const e = [1, 0, 0, 0,  0, 1, 0, 0,  0, 0, 1, 0,  0, 0, 1000, 1]
  const pose = cameraPoseFromViewport({ position: { x: 0, y: 0, z: 1000 }, matrixWorldElements: e, fovDeg: 50, aspect: 2 })
  const sight = rotateVec3(CAMERA_VIEW_AXIS_LOCAL, pose.quaternion)
  closeVec([sight.x, sight.y, sight.z], [0, 0, -1])
  const down = rotateVec3({ x: 0, y: 1, z: 0 }, pose.quaternion)
  closeVec([down.x, down.y, down.z], [0, -1, 0])
  // vertical = half of THREE's vertical fov; horizontal follows from the aspect.
  close(pose.fov.vertical, Math.round((25 * Math.PI / 180) * 1e4) / 1e4)
  close(pose.fov.horizontal, Math.atan(2 * Math.tan(25 * Math.PI / 180)), 1e-4)
  // round trip into the wire: looking down, metres
  const w = wireCameraOf(pose, cameraDeclarationOf({ camera: withFieldOfView(null, pose.fov) }))
  closeVec(w.viewAxis, [0, 0, -1])
  closeVec(w.position, [0, 0, 1])
})

test('copy current view: an orthographic viewport has no fov — null, never guessed', () => {
  const e = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  assert.equal(cameraPoseFromViewport({ position: { x: 0, y: 0, z: 0 }, matrixWorldElements: e, fovDeg: null }).fov, null)
  // perspective but the aspect is unreadable: no rectangle, never a guessed square
  assert.equal(cameraPoseFromViewport({ position: { x: 0, y: 0, z: 0 }, matrixWorldElements: e, fovDeg: 50 }).fov, null)
  assert.equal(cameraPoseFromViewport({ position: null, matrixWorldElements: e, fovDeg: 50 }), null)
})

test('frustum: a rectangle — side planes at ±horizontal and ±vertical', () => {
  const c = frustumCorners({ horizontal: Math.PI / 4, vertical: Math.atan(0.5) }, 100)
  assert.equal(c.length, 4)
  for (const p of c) { close(Math.abs(p.x), 100); close(Math.abs(p.y), 50); close(p.z, 100) }
  // image order: top-left first (image-up is optical −Y)
  assert.deepEqual([Math.sign(c[0].x), Math.sign(c[0].y)], [-1, -1])
  assert.deepEqual([Math.sign(c[2].x), Math.sign(c[2].y)], [1, 1])
  assert.equal(frustumCorners({ horizontal: 0, vertical: 0.3 }), null)
  assert.equal(frustumCorners({ horizontal: 0.3, vertical: Math.PI / 2 }), null)
  assert.equal(frustumCorners(null), null)
})

test('seed: a new camera looks straight down from overhead, and the second does not spawn in the first', () => {
  const s0 = cameraSeedPose(0)
  const sight = rotateVec3(CAMERA_VIEW_AXIS_LOCAL, s0.rotation)
  closeVec([sight.x, sight.y, sight.z], [0, 0, -1])
  assert.notDeepEqual(cameraSeedPose(1).position, s0.position)
  assert.equal(nextCameraName([{ name: 'camera' }]), 'camera_2')
})

test('wire: a request asks "can it be seen" exactly when it carries a camera object', () => {
  assert.equal(requestAsksVisibility({ camera: { position: [0, 0, 1] } }), true)
  assert.equal(requestAsksVisibility({}), false)
  assert.equal(requestAsksVisibility({ camera: null }), false)
  assert.equal(requestAsksVisibility(null), false)
})
