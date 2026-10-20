#!/usr/bin/env node
/**
 * simplify-robot-meshes — derive the realistic arm's drawn meshes from Universal
 * Robots' Collada visuals, with fewer triangles (ADR-166 M8).
 *
 * The UR5e visuals are 122k triangles / 9 MB of Collada. Measured (M7): with the
 * pixel cost removed, hiding the arm takes a software-GL frame from 13.7 to
 * 59.8 fps — the arm's triangles are the frame. Most of them are tessellation
 * of flat and gently curved faces that no viewer distance resolves.
 *
 * The .dae files stay the SOURCE (§1.1). This script is the only writer of
 * `visual_lod/` and its manifest; `src/view/RobotMeshLod.test.js` re-hashes the
 * sources and fails when a .dae changed without re-running it — the derived
 * files can not drift silently (the cross-language derivation pattern).
 *
 * The source is FLAT-shaded: every triangle's three normals are its face
 * normal (measured: 100% of 122k triangles). So the normals carry nothing the
 * positions do not, and they are what keeps every vertex apart (6 copies per
 * position). Per mesh: weld by position, simplify with meshoptimizer against an
 * ABSOLUTE geometric error in metres with open borders locked (a part's edge
 * meets the next part — moving it opens a gap), drop unused vertices, store
 * positions + index only. The runtime rebuilds the face normals the source had
 * (`realisticRobotAsset` — unindex + face normals), so shading and the
 * shadow's normal bias work exactly as they did. The Phong values the Collada
 * declares travel in the material's `extras`, so the runtime rebuilds the SAME
 * material (glTF itself only speaks PBR).
 *
 *   pnpm build:robot-lod          # regenerate (= node scripts/simplify-robot-meshes.mjs)
 *
 * Offline, once, at authoring time — never on a viewer's device (CLAUDE.md
 * §AI 向けガード axis 2: a search/iteration does not run in `src/`).
 */
import { DOMParser } from '@xmldom/xmldom'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'
import { MeshoptSimplifier } from 'meshoptimizer'

globalThis.DOMParser = DOMParser
// GLTFExporter reads its binary through FileReader (browser API); Node has Blob.
globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(b => { this.result = b; this.onloadend?.() }) }
  readAsDataURL(blob) {
    blob.arrayBuffer().then(b => {
      this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(b).toString('base64')}`
      this.onloadend?.()
    })
  }
}

const { ColladaLoader } = await import('three/addons/loaders/ColladaLoader.js')
const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js')
const { mergeVertices } = await import('three/addons/utils/BufferGeometryUtils.js')
const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js')

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SRC = join(ROOT, 'public/robot/ur5e_visual/meshes/ur5e/visual')
const OUT = join(ROOT, 'public/robot/ur5e_visual/meshes/ur5e/visual_lod')

/**
 * How far (metres, in the robot's frame) a simplified surface may move from
 * the source. Chosen by comparing renders (ADR-166 M8). The Collada vertex data
 * is in MILLIMETRES under a 0.001 node scale, so the bound is converted per
 * mesh through its world scale — given in vertex units as-is it would be a
 * thousand times tighter (the first attempt removed 2% of the triangles).
 */
export const LOD = Object.freeze({ error: Number(process.env.LOD_ERROR ?? 0.0002) })

const sha256 = buf => createHash('sha256').update(buf).digest('hex')
const triangles = g => (g.index ? g.index.count : g.attributes.position.count) / 3

function simplifyGeometry(source, errorInVertexUnits) {
  const shape = new THREE.BufferGeometry().setAttribute('position', source.attributes.position)
  const g = mergeVertices(shape, 1e-7)
  const pos = g.attributes.position.array
  const index = new Uint32Array(g.index.array)
  const [kept] = MeshoptSimplifier.simplify(index, pos, 3, 0, errorInVertexUnits, ['LockBorder', 'ErrorAbsolute'])
  // Keep only the vertices the kept triangles use (in first-use order).
  const remap = new Map(), p = []
  const out = new Uint32Array(kept.length)
  for (let i = 0; i < kept.length; i++) {
    const v = kept[i]
    let r = remap.get(v)
    if (r === undefined) {
      r = remap.size
      remap.set(v, r)
      p.push(pos[3 * v], pos[3 * v + 1], pos[3 * v + 2])
    }
    out[i] = r
  }
  const lod = new THREE.BufferGeometry()
  lod.setAttribute('position', new THREE.Float32BufferAttribute(p, 3))
  lod.setIndex(new THREE.BufferAttribute(remap.size > 65535 ? out : new Uint16Array(out), 1))
  return lod
}

/** The Phong values the runtime rebuilds the material from (`realisticRobotAsset`). */
function phongExtras(m) {
  return {
    phong: {
      color: m.color.getHex(), specular: m.specular.getHex(), shininess: m.shininess,
      emissive: m.emissive.getHex(), opacity: m.opacity, transparent: m.transparent,
      side: m.side, flatShading: !!m.flatShading,
    },
  }
}

/**
 * Load the written file back and ask that each mesh sits where its source sat:
 * world bounds within the error bound (+ float slack). A derived file that
 * moved a part is refused here, not discovered in a screenshot.
 */
async function roundTrip(glb, sources, file) {
  const gltf = await new GLTFLoader().parseAsync(glb, '')
  gltf.scene.updateMatrixWorld(true)
  const loaded = []
  gltf.scene.traverse(o => { if (o.isMesh) loaded.push(o) })
  if (loaded.length !== sources.length) throw new Error(`${file}: ${loaded.length} meshes written, ${sources.length} in the source`)
  const tol = LOD.error * 2 + 1e-6
  loaded.forEach((o, i) => {
    const a = new THREE.Box3().setFromObject(sources[i]), b = new THREE.Box3().setFromObject(o)
    const d = Math.max(a.min.distanceTo(b.min), a.max.distanceTo(b.max))
    if (!(d <= tol)) throw new Error(`${file}: mesh ${i} moved ${(d * 1000).toFixed(3)} mm (bound ${(tol * 1000).toFixed(3)} mm)`)
  })
}

async function main() {
  await MeshoptSimplifier.ready
  mkdirSync(OUT, { recursive: true })
  const manifest = { generator: 'scripts/simplify-robot-meshes.mjs', lod: LOD, meshes: {} }
  for (const file of readdirSync(SRC).filter(f => f.endsWith('.dae')).sort()) {
    const raw = readFileSync(join(SRC, file))
    const dae = new ColladaLoader().parse(raw.toString('utf8'), '')
    let before = 0, after = 0
    // URDFLoader resets the loaded root's position and rotation (it drops the
    // Z-up turn ColladaLoader adds — a URDF is already Z-up), so the frame the
    // arm is drawn in is the root with those reset. Bake in THAT frame.
    dae.scene.position.set(0, 0, 0)
    dae.scene.quaternion.identity()
    dae.scene.updateMatrixWorld(true)
    // Flat: every mesh directly under one root, carrying its whole transform
    // from the Collada root (the Z-up turn, the millimetre scale, its node
    // placement). The nested Collada nodes did not survive the exporter (the
    // first render had the parts scattered), and the drawn result only needs
    // where each mesh is — `roundTrip` checks exactly that.
    const root = new THREE.Group()
    const sources = []
    dae.scene.traverse(o => { if (o.isMesh) sources.push(o) })
    for (const o of sources) {
      before += triangles(o.geometry)
      const scale = o.getWorldScale(new THREE.Vector3())
      const geometry = simplifyGeometry(o.geometry, LOD.error / Math.max(scale.x, scale.y, scale.z))
      after += triangles(geometry)
      const m = Array.isArray(o.material) ? o.material[0] : o.material
      const lodMat = new THREE.MeshStandardMaterial({ name: m.name, color: m.color })
      lodMat.userData = phongExtras(m)
      const mesh = new THREE.Mesh(geometry, lodMat)
      mesh.name = o.name
      o.matrixWorld.decompose(mesh.position, mesh.quaternion, mesh.scale)
      root.add(mesh)
    }
    const glb = await new GLTFExporter().parseAsync(root, { binary: true })
    await roundTrip(glb, sources, file)
    const name = basename(file, '.dae') + '.glb'
    writeFileSync(join(OUT, name), Buffer.from(glb))
    manifest.meshes[file] = { lod: name, sourceSha256: sha256(raw), triangles: { source: before, lod: after } }
    console.log(`${file}: ${before} → ${after} triangles (${(100 * after / before).toFixed(1)}%), ${(glb.byteLength / 1024).toFixed(0)} KB`)
  }
  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
}

await main()
