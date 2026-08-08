// prepare-commit-msg.test.mjs — 主経路を**実際に走らせて**確かめる (ADR-116)
//
// ## なぜ純粋関数のテストだけでは足りないか
//
// ADR-115 の計数 (`check-commit-trailers.mjs`) は「トレーラが在るか」を数える。
// ところが書き手は 2 つあり (主経路 = この git hook / 予備経路 = PostToolUse の
// amend)、**予備が覆っている限り被覆率は 100% のまま**である。つまり主経路が
// 死んでも計数は緑を出す — 数えているのは結果であって、経路ではない。
//
// 実際に踏んだ (2026-08-08、ADR-116 の実装当日):
//   PreToolUse がマーカーを書く `node -e '…' <module-path>` は、モジュールのパスを
//   **argv で**渡していた。commit-meta.mjs の `isMain` 判定は
//   `import.meta.url === file://${process.argv[1]}` なので、これが真になり
//   「ライブラリとして import した」つもりの呼び出しで **CLI が起動して usage を吐き**、
//   マーカーは一度も書かれなかった。主経路は最初から一度も動いていないのに、
//   予備経路が全部拾っていたので**トレーラは付いていた**。
//
// 気づけたのは「SHA が変わりました」という予備経路の副作用の告知が毎回出ていたから
// であって、検査ではなかった。だから経路そのものを走らせる層がここに要る。
//
// 規律: 一時ディレクトリの中だけで完結させる (このリポジトリの .git を触らない)。

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const HOOK = join(ROOT, '.githooks', 'prepare-commit-msg')
const META = join(ROOT, 'scripts', 'commit-meta.mjs')

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'pcm-'))
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
  git('init', '-q')
  git('config', 'user.email', 'c@example.com')
  git('config', 'user.name', 'Claude')
  git('config', 'core.hooksPath', '.githooks')
  mkdirSync(join(dir, '.githooks'), { recursive: true })
  mkdirSync(join(dir, 'scripts'), { recursive: true })
  mkdirSync(join(dir, 'src'), { recursive: true })
  copyFileSync(HOOK, join(dir, '.githooks', 'prepare-commit-msg'))
  execFileSync('chmod', ['+x', join(dir, '.githooks', 'prepare-commit-msg')])
  copyFileSync(META, join(dir, 'scripts', 'commit-meta.mjs'))
  writeFileSync(join(dir, 'transcript.jsonl'),
    '{"type":"assistant","message":{"model":"claude-opus-5"},"effort":"high"}\n')
  // 足場 (hook 自身・commit-meta・transcript) を先にコミットしておく。これをやらないと
  // 各テストの `git add -A` が足場まで拾い、Task-Class が足場のレイヤで汚れる
  // ("feat/front" を期待した所に "feat/build+front+governance+root" が出る)。
  // マーカーを置かないのでこのコミットは刻まれない = 人間のコミットと同じ扱い。
  git('add', '-A')
  git('commit', '-q', '-m', 'chore: scaffold')
  return { dir, git }
}

/** PreToolUse がやることと同じ = マーカーを置く。書式の正本は commit-meta.mjs。 */
function putMarker(dir, { amend = false, ageSec = 0 } = {}) {
  const gitDir = execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: dir, encoding: 'utf8' }).trim()
  const out = execFileSync(process.execPath, ['-e', `
    import(process.env.CT_META).then((m) => process.stdout.write(m.buildCommitContext({
      transcript: process.env.CT_TRANSCRIPT,
      amend: process.env.CT_AMEND === "1",
      nowSec: Date.now() / 1000 - Number(process.env.CT_AGE),
    })));
  `], {
    encoding: 'utf8',
    env: {
      ...process.env,
      CT_META: join(dir, 'scripts', 'commit-meta.mjs'),
      CT_TRANSCRIPT: join(dir, 'transcript.jsonl'),
      CT_AMEND: amend ? '1' : '0',
      CT_AGE: String(ageSec),
    },
  })
  writeFileSync(join(gitDir, 'claude-commit-context'), out)
  return join(gitDir, 'claude-commit-context')
}

const trailer = (git, key) =>
  git('log', '-1', `--format=%(trailers:key=${key},valueonly,separator=%x2c)`).trim()

test('主経路: マーカーがあればコミット生成時に刻まれる', () => {
  const { dir, git } = makeRepo()
  try {
    writeFileSync(join(dir, 'src', 'a.js'), 'x')
    git('add', '-A')
    putMarker(dir)
    git('commit', '-q', '-m', 'feat(x): first')
    assert.equal(trailer(git, 'Model-Effort'), 'claude-opus-5/high')
    assert.equal(trailer(git, 'Task-Class'), 'feat/front')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('主経路: commit と push を連鎖しても刻まれる (ADR-115 が数えた穴)', () => {
  // これがこの ADR の存在理由。予備経路 (amend) はこの形で必ず失敗する。
  const { dir, git } = makeRepo()
  const remote = mkdtempSync(join(tmpdir(), 'pcm-remote-'))
  try {
    execFileSync('git', ['init', '-q', '--bare', remote])
    git('remote', 'add', 'origin', remote)
    writeFileSync(join(dir, 'src', 'a.js'), 'x')
    git('add', '-A'); putMarker(dir); git('commit', '-q', '-m', 'feat(x): init')
    git('push', '-q', '-u', 'origin', 'HEAD')

    writeFileSync(join(dir, 'src', 'a.js'), 'y')
    putMarker(dir)
    // 1 コマンドに連鎖させる — commit の直後に push が走る。
    execFileSync('sh', ['-c', 'git commit -qam "feat(x): chained" && git push -q origin HEAD'], { cwd: dir })
    assert.equal(trailer(git, 'Model-Effort'), 'claude-opus-5/high',
      '連鎖しても刻めていない — 主経路が死んでいる (予備経路はこの形を救えない)')
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(remote, { recursive: true, force: true })
  }
})

test('人間のコミット (マーカー無し) には刻まない — 帰属', () => {
  const { dir, git } = makeRepo()
  try {
    writeFileSync(join(dir, 'src', 'a.js'), 'x')
    git('add', '-A')
    git('commit', '-q', '-m', 'fix(x): by a human')
    assert.equal(trailer(git, 'Model-Effort'), '')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('古いマーカーは使わない (鮮度が帰属の判別)', () => {
  const { dir, git } = makeRepo()
  try {
    writeFileSync(join(dir, 'src', 'a.js'), 'x')
    git('add', '-A')
    putMarker(dir, { ageSec: 600 })
    git('commit', '-q', '-m', 'fix(x): stale marker')
    assert.equal(trailer(git, 'Model-Effort'), '')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('マーカーは使い切り — 刻んだら消える', () => {
  const { dir, git } = makeRepo()
  try {
    writeFileSync(join(dir, 'src', 'a.js'), 'x')
    git('add', '-A')
    const marker = putMarker(dir)
    git('commit', '-q', '-m', 'feat(x): first')
    assert.equal(existsSync(marker), false)

    writeFileSync(join(dir, 'src', 'a.js'), 'y')
    git('commit', '-qam', 'feat(x): second')
    assert.equal(trailer(git, 'Model-Effort'), '',
      '2 本目は主経路では刻まれない (予備経路が拾う — ADR-116 の宣言された残り穴)')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('--amend の Task-Class は「出来上がるコミット全体」— 基準は HEAD^', () => {
  const { dir, git } = makeRepo()
  try {
    mkdirSync(join(dir, 'docs'), { recursive: true })
    writeFileSync(join(dir, 'src', 'a.js'), 'x')
    writeFileSync(join(dir, 'docs', 'x.md'), 'doc')
    git('add', '-A'); putMarker(dir); git('commit', '-q', '-m', 'feat(x): two layers')
    assert.equal(trailer(git, 'Task-Class'), 'feat/docs+front')

    putMarker(dir, { amend: true })
    git('commit', '-q', '--amend', '--no-edit')
    assert.equal(trailer(git, 'Task-Class'), 'feat/docs+front',
      'amend の diff 基準が HEAD になっていると feat/none に化ける')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('負の対照: amend を宣言しないと基準がずれて none になる', () => {
  // 「正しい」を主張するテストは、間違いが本当に落ちることを示して初めて意味を持つ。
  const { dir, git } = makeRepo()
  try {
    writeFileSync(join(dir, 'src', 'a.js'), 'x')
    git('add', '-A'); putMarker(dir); git('commit', '-q', '-m', 'feat(x): one')
    putMarker(dir, { amend: false })          // ← 誤った宣言
    git('commit', '-q', '--amend', '--no-edit')
    assert.equal(trailer(git, 'Task-Class'), 'feat/none')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('マージコミットには刻まない (変更集合を持たない)', () => {
  const { dir, git } = makeRepo()
  try {
    writeFileSync(join(dir, 'src', 'a.js'), 'x')
    git('add', '-A'); putMarker(dir); git('commit', '-q', '-m', 'feat(x): base')
    git('checkout', '-q', '-b', 'side')
    writeFileSync(join(dir, 'src', 'b.js'), 'y')
    git('add', '-A'); putMarker(dir); git('commit', '-q', '-m', 'feat(x): side')
    git('checkout', '-q', '-')
    writeFileSync(join(dir, 'src', 'c.js'), 'z')
    git('add', '-A'); putMarker(dir); git('commit', '-q', '-m', 'feat(x): main')
    putMarker(dir)
    git('merge', '-q', '--no-ff', '-m', 'merge: side', 'side')
    assert.equal(trailer(git, 'Model-Effort'), '')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
