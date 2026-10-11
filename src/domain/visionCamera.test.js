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
  selectCamera, wireCameraOf, cameraPoseFromViewport, frustumCorners, quaternionFromBasis,
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

test('declaration: fov absent is declared-without-cone, never a default; bad fov is malformed', () => {
  assert.deepEqual(cameraDeclarationOf({ camera: {} }), { state: CAMERA_STATE.DECLARED, fovHalfAngle: null, errors: [] })
  assert.equal(cameraDeclarationOf({ camera: { fovHalfAngle: 0.4 } }).fovHalfAngle, 0.4)
  for (const bad of [0, -1, Math.PI / 2, 'wide', NaN]) {
    const d = cameraDeclarationOf({ camera: { fovHalfAngle: bad } })
    assert.equal(d.state, CAMERA_STATE.MALFORMED, `fov ${bad}`)
    assert.equal(d.errors.length, 1)
  }
  assert.equal(cameraDeclarationOf({ name: 'frame' }), null)
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

test('wire: position mm → m, viewAxis = rotation · optical +Z, fov only when declared', () => {
  const decl = cameraDeclarationOf({ camera: { fovHalfAngle: 0.5 } })
  const w = wireCameraOf({ position: { x: 1000, y: -500, z: 1200 }, quaternion: IDENT }, decl)
  assert.deepEqual(w, { position: [1, -0.5, 1.2], viewAxis: [0, 0, 1], fovHalfAngle: 0.5 })
  const noFov = wireCameraOf({ position: { x: 0, y: 0, z: 0 }, quaternion: IDENT }, cameraDeclarationOf({ camera: {} }))
  assert.equal('fovHalfAngle' in noFov, false)
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
  const pose = cameraPoseFromViewport({ position: { x: 0, y: 0, z: 1000 }, matrixWorldElements: e, fovDeg: 50 })
  const sight = rotateVec3(CAMERA_VIEW_AXIS_LOCAL, pose.quaternion)
  closeVec([sight.x, sight.y, sight.z], [0, 0, -1])
  const down = rotateVec3({ x: 0, y: 1, z: 0 }, pose.quaternion)
  closeVec([down.x, down.y, down.z], [0, -1, 0])
  close(pose.fovHalfAngle, Math.round((25 * Math.PI / 180) * 1e4) / 1e4)
  // round trip into the wire: looking down, metres
  const w = wireCameraOf(pose, cameraDeclarationOf({ camera: { fovHalfAngle: pose.fovHalfAngle } }))
  closeVec(w.viewAxis, [0, 0, -1])
  closeVec(w.position, [0, 0, 1])
})

test('copy current view: an orthographic viewport has no fov — null, never guessed', () => {
  const e = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  assert.equal(cameraPoseFromViewport({ position: { x: 0, y: 0, z: 0 }, matrixWorldElements: e, fovDeg: null }).fovHalfAngle, null)
  assert.equal(cameraPoseFromViewport({ position: null, matrixWorldElements: e, fovDeg: 50 }), null)
})

test('frustum: the square whose inscribed cone is the judged cone (side planes at ±fovHalfAngle)', () => {
  const c = frustumCorners(Math.PI / 4, 100)
  assert.equal(c.length, 4)
  for (const p of c) { close(Math.abs(p.x), 100); close(Math.abs(p.y), 100); close(p.z, 100) }
  // A point on the cone's rim along +X is on the frustum's side plane, inside its square.
  close(Math.atan2(c[1].x, c[1].z), Math.PI / 4)
  assert.equal(frustumCorners(0), null)
  assert.equal(frustumCorners(Math.PI / 2), null)
})

test('seed: a new camera looks straight down from overhead, and the second does not spawn in the first', () => {
  const s0 = cameraSeedPose(0)
  const sight = rotateVec3(CAMERA_VIEW_AXIS_LOCAL, s0.rotation)
  closeVec([sight.x, sight.y, sight.z], [0, 0, -1])
  assert.notDeepEqual(cameraSeedPose(1).position, s0.position)
  assert.equal(nextCameraName([{ name: 'camera' }]), 'camera_2')
})
