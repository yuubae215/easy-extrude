// @ts-nocheck
/**
 * robotMeshLod (view) — draw the realistic arm from the meshes derived by
 * `scripts/simplify-robot-meshes.mjs` instead of Universal Robots' Collada
 * visuals (ADR-166 M8).
 *
 * The .dae files stay the source; `visual_lod/*.glb` are derived from them
 * (29% of the triangles, 1/19 of the bytes), and `RobotMeshLod.test.js`
 * re-hashes the sources against the manifest so the two can not drift.
 *
 * A derived file carries only what the source's look needs and nothing it can
 * rebuild: positions + index (the source is flat-shaded, so its normals are the
 * face normals) and the Collada's Phong values in the material's `extras`
 * (glTF itself only speaks PBR). These functions put back the SAME geometry
 * form and the SAME material the Collada path drew — closed-form, no search.
 *
 * Pure except for the THREE objects they build; no fetch, no DOM — `node --test`
 * runs them.
 */
import * as THREE from 'three'

/**
 * The derived mesh for a source mesh URL, or null when the URL is not one of
 * the arm's Collada visuals (anything else loads as before).
 * @param {string} path a URL URDFLoader resolved from `package://…`
 * @returns {string|null}
 */
export function lodMeshUrl(path) {
  const m = /^(.*\/meshes\/ur5e\/)visual\/([^/]+)\.dae$/i.exec(path)
  return m ? `${m[1]}visual_lod/${m[2]}.glb` : null
}

/**
 * The flat-shaded triangle soup the source had: every triangle its own three
 * vertices, every vertex normal its triangle's face normal. Returns a new
 * geometry (原則 #6).
 * @param {THREE.BufferGeometry} indexed positions + index (the derived form)
 * @returns {THREE.BufferGeometry}
 */
export function restoreFlatGeometry(indexed) {
  const flat = indexed.index ? indexed.toNonIndexed() : indexed.clone()
  flat.deleteAttribute('normal')
  flat.computeVertexNormals()   // non-indexed → each vertex gets its face's normal
  return flat
}

/**
 * The Phong material the Collada declared, from the derived material's
 * `extras` (GLTFLoader puts them in `userData`). A material without them is
 * returned as is — a derived file that lost its extras draws, visibly wrong,
 * rather than not at all (原則 #11).
 * @param {THREE.Material} material
 * @returns {THREE.Material}
 */
export function restorePhongMaterial(material) {
  const p = material.userData?.phong
  if (!p) return material
  return new THREE.MeshPhongMaterial({
    name: material.name,
    color: p.color, specular: p.specular, shininess: p.shininess, emissive: p.emissive,
    opacity: p.opacity, transparent: p.transparent, side: p.side, flatShading: p.flatShading,
  })
}

/**
 * Put the source's form back on every mesh of a loaded derived scene, in place
 * (the scene was just loaded and is not shared yet).
 * @param {THREE.Object3D} scene
 * @returns {THREE.Object3D}
 */
export function restoreLodScene(scene) {
  scene.traverse(o => {
    if (!o.isMesh) return
    const g = o.geometry, m = o.material
    o.geometry = restoreFlatGeometry(g)
    o.material = restorePhongMaterial(m)
    g.dispose()
    if (o.material !== m) m.dispose()
  })
  return scene
}
