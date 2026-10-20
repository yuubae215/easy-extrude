/**
 * The realistic arm is drawn from meshes DERIVED from the Collada sources
 * (ADR-166 M8). The .dae files are the source; `visual_lod/` is written only by
 * `scripts/simplify-robot-meshes.mjs`. This asks the machine what a reviewer
 * cannot see: that every source has its derived file, that each derived file
 * was made from the source as it is today (SHA-256), and that the derivation
 * still pays for itself (the triangle budget it was adopted for).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'
import { lodMeshUrl, restoreFlatGeometry, restorePhongMaterial } from './robotMeshLod.js'

const MESHES = fileURLToPath(new URL('../../public/robot/ur5e_visual/meshes/ur5e/', import.meta.url))
const manifest = JSON.parse(readFileSync(MESHES + 'visual_lod/manifest.json', 'utf8'))
const sources = readdirSync(MESHES + 'visual').filter(f => f.endsWith('.dae')).sort()

test('every Collada source has a derived mesh made from it as it is today', () => {
  assert.deepEqual(Object.keys(manifest.meshes).sort(), sources, 'one derived entry per source, no more')
  for (const f of sources) {
    const entry = manifest.meshes[f]
    const sha = createHash('sha256').update(readFileSync(MESHES + 'visual/' + f)).digest('hex')
    assert.equal(entry.sourceSha256, sha, `${f} changed since it was derived — run node scripts/simplify-robot-meshes.mjs`)
    assert.ok(existsSync(MESHES + 'visual_lod/' + entry.lod), `${entry.lod} is missing`)
  }
})

test('the derivation still pays for itself — under a third of the triangles', () => {
  let source = 0, lod = 0
  for (const e of Object.values(manifest.meshes)) { source += e.triangles.source; lod += e.triangles.lod }
  assert.ok(lod < source / 3, `${lod} of ${source} triangles`)
  assert.ok(manifest.lod.error > 0 && manifest.lod.error <= 0.0002, 'the bound the before/after pictures were judged at (0.2 mm)')
})

test('the arm\'s Collada visuals map to their derived meshes; anything else loads as before', () => {
  assert.equal(lodMeshUrl('/easy-extrude/robot/ur5e_visual/meshes/ur5e/visual/upperarm.dae'),
    '/easy-extrude/robot/ur5e_visual/meshes/ur5e/visual_lod/upperarm.glb')
  for (const f of sources) {
    const url = lodMeshUrl(`/x/meshes/ur5e/visual/${f}`)
    assert.ok(url && existsSync(MESHES + 'visual_lod/' + url.split('/').pop()), `${f} → an existing file`)
  }
  assert.equal(lodMeshUrl('/x/meshes/ur5e/collision/base.stl'), null)
  assert.equal(lodMeshUrl('/x/skeleton_arm.urdf'), null)
})

test('the geometry comes back flat-shaded like the source: each vertex normal is its face normal', () => {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1], 3))
  g.setIndex([0, 1, 2, 0, 3, 1])
  const flat = restoreFlatGeometry(g)
  assert.equal(flat.index, null)
  assert.equal(flat.attributes.position.count, 6)
  const n = flat.attributes.normal
  for (let t = 0; t < 2; t++) {
    const a = new THREE.Vector3().fromBufferAttribute(n, 3 * t)
    for (let k = 1; k < 3; k++) assert.ok(a.distanceTo(new THREE.Vector3().fromBufferAttribute(n, 3 * t + k)) < 1e-9)
  }
  assert.ok(g.index, 'the source geometry is not changed (原則 #6)')
})

test('the material comes back as the Phong the Collada declared', () => {
  const m = new THREE.MeshStandardMaterial({ name: 'URBlue' })
  m.userData = { phong: { color: 0x7dadcc, specular: 0x080808, shininess: 30, emissive: 0, opacity: 1, transparent: false, side: THREE.FrontSide, flatShading: false } }
  const p = restorePhongMaterial(m)
  assert.ok(p.isMeshPhongMaterial)
  assert.equal(p.color.getHex(), 0x7dadcc)
  assert.equal(p.specular.getHex(), 0x080808)
  assert.equal(p.shininess, 30)
  assert.equal(p.name, 'URBlue')
  const bare = new THREE.MeshStandardMaterial()
  assert.equal(restorePhongMaterial(bare), bare, 'no extras → drawn as it came, not dropped')
})
