/**
 * The stub must be ABSENT from a normal build (ADR-117).
 *
 * ## Why this is a check and not a comment
 *
 * "It's behind a build-time flag, so it tree-shakes" is a claim about a bundler's
 * behaviour, and bundler behaviour changes with configuration, plugin order and
 * version. The failure mode if the claim quietly stops holding is the bad one:
 * the production site keeps working, so nothing looks wrong, while a module whose
 * entire job is to fabricate grasp answers rides along in the shipped bundle —
 * one flag flip or one stray import away from serving fiction on the real
 * deployment. Nobody would notice by using the app.
 *
 * So the claim is measured against `dist/`, not asserted in prose (原則 #19 Q3:
 * the deliverable is a check, not a sentence in a document).
 *
 * ## Skipped, not failed, when there is no build
 *
 * This needs `dist/` to exist and is therefore a CI/after-build check rather than
 * a unit test. It reports its own inapplicability instead of passing quietly —
 * "no dist, so nothing was examined" and "examined and clean" must not look
 * alike (ADR-115).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(HERE, '../../dist')

/** Every emitted JS file in `dist/`, recursively. */
function bundleFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...bundleFiles(full))
    else if (entry.endsWith('.js')) out.push(full)
  }
  return out
}

/**
 * Strings that only the stub's own source contains. Kept distinctive enough that
 * an ordinary word in unrelated code cannot raise a false alarm, and specific
 * enough that the stub cannot be present without at least one of them.
 */
const STUB_FINGERPRINTS = [
  'graspStub: unknown scenario',
  'x-grasp-stub',
  'has no grasp-stub handler',
]

test('通常ビルドの dist/ に grasp スタブが含まれていない', (t) => {
  if (!existsSync(DIST)) {
    t.skip('dist/ が無い — `pnpm build` の後に走らせる検査 (CI では build ステップの後)')
    return
  }
  const files = bundleFiles(DIST)
  assert.ok(files.length > 0, 'dist/ に JS が 1 つも無い — ビルドが壊れている可能性')

  const offenders = []
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    for (const needle of STUB_FINGERPRINTS) {
      if (source.includes(needle)) offenders.push(`${file}: ${needle}`)
    }
  }
  assert.deepEqual(offenders, [],
    'grasp スタブが通常ビルドに混入している。VITE_GRASP_STUB のガードが静的に解決されて ' +
    'いないか、mocks/ が src/ から直接 import されている:\n' + offenders.join('\n'))
})

test('スタブの指紋そのものが実在する — 検査が空振りしていないこと', () => {
  // 指紋が古くなって「どのファイルにも無い」状態になると、上の検査は
  // 何も探さずに緑を出す。母集団が空であることを検査対象にする (ADR-115)。
  const sources = ['scenarios.js', 'transport.js']
    .map(f => readFileSync(resolve(HERE, f), 'utf8'))
    .join('\n')
  for (const needle of STUB_FINGERPRINTS) {
    assert.ok(sources.includes(needle),
      `指紋 "${needle}" はもうスタブの中に無い。dist 検査が空振りするので更新すること`)
  }
})
