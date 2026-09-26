/**
 * ADR-152 D6 — every declaration can be checked in 3D, and that is counted.
 *
 * The census half: the population is the SCHEMA (every field of `graspSpec`,
 * `graspStrategy` and the tcp `hand`), not the table — a table measured against
 * itself is a place-list (ADR-102). The count of schema fields with no row in
 * `CONFIRMATION_BY_FIELD` must be 0, and the table may not keep rows for fields
 * the schema no longer has (a retired field that still "has a picture" is the
 * rot 原則 #32 is about).
 *
 * The geometry half: the pictures are drawn from the RESOLVED values the wire is
 * built from — the region outline encloses exactly the samples that are sent,
 * the finger sections stand `maxOpening` apart, the preview's fingertip is the
 * TCP — and a picture exists for every row that names one.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  CONFIRMATION_BY_FIELD, confirmationFor, declarationPicture, faceRegionCorners,
} from './GraspDeclarationMath.js'
import { resolveGraspTargets, faceRegionSamples } from '../domain/graspTargets.js'
import { DEFAULT_HAND_BY_KIND } from '../domain/robotHand.js'

const schema = JSON.parse(readFileSync(new URL('../../schema/layout-1.0.schema.json', import.meta.url), 'utf8'))

/** Leaf-ish field paths of an object schema (one level into `approach`). */
function fieldsOf(prefix, def) {
  const out = []
  for (const [k, v] of Object.entries(def.properties ?? {})) {
    if (k === 'approach') out.push(...fieldsOf(`${prefix}.approach`, v))
    else out.push(`${prefix}.${k}`)
  }
  return out
}
function handDef() {
  let found = null
  const walk = (o) => {
    if (!o || typeof o !== 'object' || found) return
    if (o.properties?.hand && o.properties?.mountedOn) { found = o.properties.hand; return }
    for (const v of Object.values(o)) walk(v)
  }
  walk(schema)
  return found
}

const population = [
  ...fieldsOf('graspSpec', schema.$defs.graspSpec),
  ...fieldsOf('graspStrategy', schema.$defs.graspStrategy),
  ...fieldsOf('hand', handDef()),
]

test('宣言の欄のうち確認の絵を持たないものは 0 個 (母集団はスキーマ)', () => {
  assert.ok(population.length >= 15, `the population came out suspiciously small: ${population}`)
  const missing = population.filter(f => !(f in CONFIRMATION_BY_FIELD))
  assert.deepEqual(missing, [], 'a declared field with no picture — add a CONFIRMATION_BY_FIELD row')
})

test('表はスキーマに無い欄の行を持たない — 退役した欄の絵は残さない', () => {
  const stale = Object.keys(CONFIRMATION_BY_FIELD).filter(f => !population.includes(f))
  assert.deepEqual(stale, [])
})

test('未登録の欄は throw する — 絵を忘れた欄は黙って通らない', () => {
  assert.throws(() => confirmationFor('graspSpec.priority'), /no confirming picture/)
  assert.equal(confirmationFor('graspSpec.closing').picture, 'contact')
})

// ── geometry: drawn from what is sent ────────────────────────────────────────

const [target] = resolveGraspTargets([{
  ref: 'box', type: 'Solid', name: 'Box',
  position: { x: 500, y: 0, z: 30 }, dimensions: { x: 100, y: 40, z: 60 },
  rotation: { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 },
  graspFeature: {
    kind: 'specs',
    specs: [
      { name: 'pinch', hand: 'parallelJaw', approach: { from: '+z', region: { uMin: 0.2, uMax: 0.8, vMin: 0.1, vMax: 0.9 }, tiltTolerance: 0.2 }, closing: 'y', depth: 20 },
      { name: 'suck', hand: 'suction', approach: { from: '+z' } },
    ],
  },
}])
const [pinch, suck] = target.feature.specs
const JAW = DEFAULT_HAND_BY_KIND.parallelJaw
const CUP = DEFAULT_HAND_BY_KIND.suction

test('領域の輪郭は送られるサンプルをすべて囲む (回転した物体でも)', () => {
  const corners = faceRegionCorners(target, '+z', pinch.approach.region)
  const xs = corners.map(c => c[0]), ys = corners.map(c => c[1])
  for (const s of faceRegionSamples(target, '+z', pinch.approach.region)) {
    assert.ok(s.point[0] >= Math.min(...xs) - 1e-9 && s.point[0] <= Math.max(...xs) + 1e-9)
    assert.ok(s.point[1] >= Math.min(...ys) - 1e-9 && s.point[1] <= Math.max(...ys) + 1e-9)
    assert.ok(Math.abs(s.point[2] - corners[0][2]) < 1e-9, 'on the face')
  }
})

test('面ラベルは 6 個、世界向きの語つき — z まわり 90° で +x は left', () => {
  const pic = declarationPicture({ target, spec: pinch, specs: [pinch, suck], hand: JAW, toolLengthMm: 150 })
  assert.equal(pic.faceLabels.length, 6)
  assert.equal(pic.faceLabels.find(l => l.face === '+x').text, '+x · left')
  assert.equal(pic.otherApproaches.length, 1, 'the other spec is drawn faintly, not as a second arrow')
})

test('指定した仕様の絵: 矢印は外から領域中心へ、円錐は許容傾き、接触面 2 枚、深さ面', () => {
  const f = declarationPicture({ target, spec: pinch, specs: [pinch, suck], hand: JAW, toolLengthMm: 150 }).focused
  assert.ok(f.arrow.from[2] > f.arrow.to[2], 'the hand comes DOWN onto +z')
  assert.equal(f.cone.halfAngle, 0.2)
  assert.equal(f.contact.length, 2)
  // Depth plane is 20 mm under the top face (z = 60).
  for (const c of f.depthPlane) assert.ok(Math.abs(c[2] - 40) < 1e-9)
})

test('爪の断面は内面間 = maxOpening で、閉じ軸 (局所 y → 世界 -x) の上に並ぶ', () => {
  const f = declarationPicture({ target, spec: pinch, hand: JAW, toolLengthMm: 150 }).focused
  const [a, b] = f.fingers
  const centerOf = (r) => r.reduce((s, p) => s.map((v, i) => v + p[i] / 4), [0, 0, 0])
  const ca = centerOf(a.section), cb = centerOf(b.section)
  const gap = Math.hypot(ca[0] - cb[0], ca[1] - cb[1], ca[2] - cb[2]) - JAW.fingers.thickness
  assert.ok(Math.abs(gap - JAW.maxOpening) < 1e-9)
  assert.ok(Math.abs(ca[1] - cb[1]) < 1e-9, 'local y turned 90° about Z is world x — the fingers straddle world x')
  assert.ok(a.clearance && b.clearance, 'fingerClearance has its band')
})

test('手のプレビューは腕と同じ部品で、爪先が TCP (深さ面の中心) に来る', () => {
  const f = declarationPicture({ target, spec: pinch, hand: JAW, toolLengthMm: 150 }).focused
  const fingers = f.preview.filter(p => p.part === 'finger')
  assert.equal(fingers.length, 2)
  const tipZ = Math.min(...fingers.map(p => p.center[2] - p.size[2] / 2))
  assert.ok(Math.abs(tipZ - 40) < 1e-9, `fingertips at z=${tipZ}, the depth plane is at 40`)
})

test('吸引の仕様はカップの円とシール円錐を、ジョーの絵を描かずに出す', () => {
  const f = declarationPicture({ target, spec: suck, hand: CUP, toolLengthMm: 150 }).focused
  assert.equal(f.cup.radius, CUP.cupDiameter / 2)
  assert.equal(f.cup.sealHalfAngle, CUP.sealTiltTolerance)
  assert.equal(f.fingers, null)
  assert.equal(f.contact, null)
  assert.ok(f.preview.some(p => p.part === 'cup'))
})

test('手と合わない仕様には手の絵を出さない — 使えない手を描かない', () => {
  const f = declarationPicture({ target, spec: suck, hand: JAW, toolLengthMm: 150 }).focused
  assert.equal(f.preview, null)
  assert.equal(f.cup, null)
})

test('表が絵を名指す行は、代表の宣言で実際にその絵が出る', () => {
  const jawPic = declarationPicture({ target, spec: pinch, specs: [pinch, suck], hand: JAW, toolLengthMm: 150, hoverFace: '+x' })
  const cupPic = declarationPicture({ target, spec: suck, specs: [pinch, suck], hand: CUP, toolLengthMm: 150 })
  const has = (pic, key) => (key in pic ? pic[key] : pic.focused?.[key]) != null
  for (const [field, row] of Object.entries(CONFIRMATION_BY_FIELD)) {
    if (row.picture === 'panel') continue
    assert.ok(has(jawPic, row.picture) || has(cupPic, row.picture), `${field} → ${row.picture} is never drawn`)
  }
  assert.equal(jawPic.hover.length, 4, 'the hovered face is painted')
})
