/**
 * The one stage light is the ONLY light (ADR-166 M6) — counted at the source.
 *
 * Before M6 the motion identity said "exactly one light" while the scene was
 * lit by three: a white ambient and a white key in SceneView, and the warm rim
 * in SceneStage. The floor said one light and the bodies another, and nothing
 * counted lights, so the declaration stayed green while it was false
 * (原則 #31 — what is counted is what is declared, not what is there).
 * The population is derived from the source: every `new THREE.…Light(` in src/.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = fileURLToPath(new URL('.', import.meta.url))

function sources(dir) {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return name === 'engine' ? [] : sources(p)
    return /\.(js|jsx)$/.test(name) && !/\.test\.js$/.test(name) ? [p] : []
  })
}

const files = sources(SRC).map(p => [relative(SRC, p).replaceAll('\\', '/'), readFileSync(p, 'utf8')])

test('every light in the scene is the stage light — key + fill, in SceneStage only', () => {
  const lights = files.flatMap(([f, src]) =>
    [...src.matchAll(/new THREE\.(\w*Light)\(/g)].map(m => `${f}: ${m[1]}`))
  assert.deepEqual(lights.sort(), [
    'view/SceneStage.js: DirectionalLight',
    'view/SceneStage.js: HemisphereLight',
  ])
})

test('who decides that a mesh casts a shadow is a declared list — bodies, the arm, the light', () => {
  // Overlays (frames, gizmos, light sprites, labels) must not cast: a shadow
  // claims the thing is a solid in the room.
  const writers = files.filter(([, src]) => /\.castShadow\s*=/.test(src)).map(([f]) => f).sort()
  assert.deepEqual(writers, ['view/MeshView.js', 'view/RobotStage.js', 'view/SceneStage.js'])
})
