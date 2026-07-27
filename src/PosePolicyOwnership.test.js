/**
 * PosePolicyOwnership.test.js — 「pose を書く入口を列挙して、方針を通さない入口が
 * 0 個であること」を機械に問わせる (ADR-097 / 原則 #31 / 原則 #1)
 *
 * ## なぜ *在るもの* を辿る検査では足りないのか
 *
 * ADR-097 が消した欠陥は、規則が**書かれていない経路**から生まれていた:
 *
 *   - stack snap は自由 Grab に在って軸拘束に無かった (`stackMode && axis !== 'z'`)
 *   - Solid に在って非 Solid に無かった (`instanceof Solid` の早期 return)
 *   - ドラッグ中の注釈に在って `mounts` の毎フレーム追従に無かった
 *   - クイックドラッグには実体種の分岐が**そもそも存在しなかった**
 *   - N パネルの数値入力 (`onLocationChange`) は `obj.move()` を直接呼んでいた
 *
 * 「今日ある経路」を辿る検査は、次に足される経路を必ず素通りする — 規則の不在は
 * 検査対象のノードを持たないからである (原則 #31)。だから検査は
 * **「pose を書ける形」を列挙して、所有者の外にある個数を数える**形でなければ
 * ならない。ADR-090 (0 台のロボット) / ADR-093 (N 個の lockstep) と同じ構図の 3 例目。
 *
 * ## 規則を足すとき
 *
 * POSE_WRITE_RULES に 1 エントリ足す。`match` は *呼び出しの形* に当たるものに保つ
 * (コメントと散文は除去してから当てるので、説明文では発火しない)。
 *
 * 対象外: `*.test.js` (stub の move は書き手ではない)、`src/domain/` (メソッドの
 * 定義そのものが在る場所)。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC_ROOT  = fileURLToPath(new URL('.', import.meta.url))
const REPO_ROOT = join(SRC_ROOT, '..')

/** 方針を適用する唯一の入口を持つモジュール。 */
const POSE_ENTRY = 'src/service/SceneService.js'

/**
 * @typedef {object} PoseWriteRule
 * @property {string}   name    人が読む規則名
 * @property {string[]} owners  この書き込みを書いてよい場所 (repo 相対)。空 = どこにも無いこと
 * @property {RegExp}   match   pose を書く呼び出しの形
 * @property {string}   use     違反時に案内する正しい経路
 * @property {string}   why     なぜ入口が 1 つでなければならないか
 */

/** @type {PoseWriteRule[]} */
const POSE_WRITE_RULES = [
  {
    name: '並進の書き込み (entity.move)',
    owners: [POSE_ENTRY],
    match: /\.move\s*\(/,
    use: 'SceneService.applyPreviewTranslation(startCorners, startPositions, delta, opts) — 要求された delta を渡す',
    why: '方針 (床・支持・床下の宣言) は入口が適用する。ハンドラが直接 move すると、その経路だけ床が無い状態が生まれる — 症状 1〜5 はすべてこの形だった (ADR-097 §Decision 3)',
  },
  {
    name: '退役した床作りの補助 (_applyStackSnap)',
    owners: [],
    match: /_applyStackSnap/,
    use: 'applyPreviewTranslation(..., { stackAssist: true, activeId }) — 補助は入口のオプション',
    why: 'クイックドラッグが他ハンドラの private メソッドへ手を伸ばして呼んでいたこと自体が、唯一の権威ある入口が無いことの最も直接的な現れだった (PHILOSOPHY #1)',
  },
  {
    name: '退役した実体種による配置分岐 (_isMapObject / _mapObjectPlateDelta)',
    owners: [],
    match: /_isMapObject|_mapObjectPlateDelta/,
    use: "placementOf(entity) — 方針は種ごとに宣言され、src/domain/placement.js が唯一の分類器",
    why: '「マップオブジェクトだけ特別」は一般規則の一事例であって例外ではない。特別扱いを残すと、次の種がまた特別扱いとして足される (ADR-097 §Decision 1 / §1.1)',
  },
]

/**
 * **支持プローブの種分岐** (ADR-098) — 「この種の底はどこか」に答える行。
 *
 * ADR-097 は「`instanceof` の連鎖が在ってよい唯一の場所は `placementKindOf()`」と
 * 決めたが、`SceneService` の 4 メソッド (`_footprintSamplesOf` / `_bottomZOf` /
 * `_segmentStartBottomZ` / `_destinationSamples`) は `instanceof CoordinateFrame` で
 * **方針表と同じ問いに別の場所で答え続けていた** — 規則が在るのに問われていな
 * かった箇所である。非対称が欠陥の形だった: 種を足したとき方針表は throw して
 * 気づかせるが、プローブは黙って `corners = []` → `null` を返して「支持なし」に
 * 見せる (原則 #31 — 不在は検査対象のノードを持たない)。
 *
 * 検査の単位が**メソッド本体**なのは、ファイル全体では広すぎ (SceneService には
 * 配置と無関係な正当な `instanceof` が多数在る)、1 行では狭すぎる (分岐は
 * 複数行に散る) ため。名指ししたメソッドの中に種分岐が 0 個であることを問う。
 */
const PROBE_METHODS = [
  { file: 'src/service/SceneService.js', method: '_footprintSamplesOf' },
  { file: 'src/service/SceneService.js', method: '_bottomZOf' },
  { file: 'src/service/SceneService.js', method: '_segmentStartBottomZ' },
  { file: 'src/service/SceneService.js', method: '_destinationSamples' },
  { file: 'src/service/SceneService.js', method: '_probeGeometryOf' },
  { file: 'src/service/SceneService.js', method: '_snapshotGeometryOf' },
  { file: 'src/service/SceneService.js', method: '_applyStackAssist' },
]

/**
 * **pose を計算するメソッド** — 次の pose を決める側 (ADR-101)。
 *
 * ここに並ぶメソッドは `LIVE_PROBES` を読んではならない。live プローブは
 * *描画されている状態* を答える (frame 由来の実体は `_worldPoseCache` を引き、
 * このキャッシュは rAF ごとにしか再計算されない) ので、pose を書いている最中に
 * 読むと **自分の前フレームの出力**が入力に戻る (原則 #24 の閉路)。
 *
 * この罠が種によって見え方を変えるのが厄介だった: corners で測る実体
 * (Solid) は `_applyEntityDelta` が同期的に corners を書くので live 読みでも
 * たまたま新鮮で、原点で測る実体 (robot_base / CF) だけが 1 フレーム遅れる。
 * 同じコードがキューブでは安定しロボットでは 2 周期で振動した — ADR-098 が
 * 「種ではなく方針」で閉じたはずの非対称が、**幾何の鮮度**という別の軸で
 * 残っていた形である。
 *
 * 検査が *在るもの* (今日の呼び出し) ではなく **禁じられた形の個数**を数えるのは
 * 原則 #31 と同じ理由 — 次に足される writer は今日のリストに載っていない。
 */
const POSE_COMPUTING_METHODS = [
  { file: 'src/service/SceneService.js', method: 'applyPreviewTranslation' },
  { file: 'src/service/SceneService.js', method: '_policyDelta' },
  { file: 'src/service/SceneService.js', method: '_applyStackAssist' },
  { file: 'src/service/SceneService.js', method: '_applyEntityDelta' },
]

/** 描画済みの状態を答えるアクセサ (query 専用 — writer が読んではならない)。 */
const LIVE_PROBES = [
  { match: /this\._bottomZOf\s*\(/,          use: 'this._segmentStartBottomZ(obj, startCorners)' },
  { match: /this\._footprintSamplesOf\s*\(/, use: 'this._destinationSamples(obj, startCorners, delta)' },
  { match: /this\.worldPoseOf\s*\(/,         use: 'セグメント開始スナップショット + 要求 delta から導く' },
  { match: /this\._worldPoseCache\b/,        use: 'セグメント開始スナップショット + 要求 delta から導く' },
]

/**
 * 種分岐が**在ってよい**メソッドと、その宣言された理由。
 *
 * 「例外が在ること」ではなく「例外が数えられていること」が要点 —
 * `DECLARED_EXCEPTIONS` と同じ規律を分岐側にも当てる。
 */
const DECLARED_TYPE_DISPATCH = [
  {
    file: 'src/service/SceneService.js',
    method: '_applyEntityDelta',
    why: 'pose を**どう書くか** (CF は parent-local delta / Solid は _position スナップショット / それ以外は corners) の ABI であって、どの方針が当たるかではない。方針は呼ばれる前に _policyDelta が決めている。この 1 箇所に集めたからこそ、補助 (_applyStackAssist) が種の門を持たずに同じ ABI を使える (ADR-098)',
  },
]

/**
 * **足さなかった規則と、その理由** (原則 #20 — 広域スキャンは注意を薄める)
 *
 * 「注釈 3 種を `instanceof` で並べる分岐」を分類の再導出として落とす規則を書き、
 * 外した。実測で 8 箇所に当たり、そのすべてが**配置とは無関係な正当な分岐**
 * だったため — ヒットテストの優先順位、N パネルの欄の出し分け、ツールバーの
 * 有効/無効。これらを落とす規則は「無視される規則」になり、無視される規則は
 * 規則が無いより悪い (希釈 — 憲法 Q3)。
 *
 * 分類の再導出が**害になる**のは pose を書くときだけであり、それは上の規則 1 が
 * 既に塞いでいる: 入口の外では誰も pose を書けないので、そこにある分類の写しは
 * 配置に影響しない。塞ぐべき穴は「分類の複製」ではなく「入口の複製」だった。
 */

/**
 * 例外として pose を書いてよい場所と、その**宣言された理由**。
 *
 * 「例外が在ること」ではなく「例外が数えられていること」が要点 — 宣言されていない
 * 例外は 0 個でなければならない。
 */
const DECLARED_EXCEPTIONS = [
  {
    file: 'src/command/MoveCommand.js',
    match: /setWorldCorners\s*\(/,
    why: 'undo/redo は「以前に方針を通った pose」へ戻すだけで、新しい pose を要求していない。再 clamp すると undo が非対称になり、宣言された床下が undo で浮く',
  },
  {
    file: 'src/controller/handler/GrabOperationHandler.js',
    match: /setWorldCorners\s*\(/,
    why: 'grab cancel のスナップショット復元。同上 — 復元であって要求ではない',
  },
  {
    file: 'src/command/SolidRotateCommand.js',
    match: /restorePose\s*\(/,
    why: '回転の undo。ADR-097 の方針は並進にのみ課される (回転で床を割る問題は観測されておらず、予防的に広げない — §5 過剰モデリング禁止)',
  },
  {
    file: 'src/controller/handler/RotationHandler.js',
    match: /restorePose\s*\(/,
    why: '回転 cancel の復元。同上',
  },
]

/** src/ 配下の .js を列挙 (テストと生成物を除く)。 */
function collectSources(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'engine') continue   // engine/ は生成物 (wasm glue)
    const abs = join(dir, entry)
    if (statSync(abs).isDirectory()) { collectSources(abs, out); continue }
    if (!/\.jsx?$/.test(entry)) continue
    if (entry.endsWith('.test.js')) continue
    out.push(abs)
  }
  return out
}

/** コメントを潰す (散文中の言及で発火させない)。行番号は保存する。 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map(line => line.replace(/\/\/.*$/, ''))
}

const isDomainDefinition = rel => rel.startsWith(`src${sep}domain${sep}`)

/**
 * クラスメソッド 1 本の本体を切り出す (インデント 2 の `name(` から インデント 2 の
 * `}` まで)。検査の単位をファイルより狭く・行より広く取るための道具。
 * @param {string[]} lines  stripComments 済みの行 (行番号は保存されている)
 * @param {string} method
 * @returns {{start: number, body: string[]}|null}
 */
function extractMethodBody(lines, method) {
  const head = new RegExp(`^ {2}${method}\\s*\\(`)
  const start = lines.findIndex(l => head.test(l))
  if (start === -1) return null
  let end = start + 1
  while (end < lines.length && lines[end].trimEnd() !== '  }') end++
  return { start, body: lines.slice(start, Math.min(end + 1, lines.length)) }
}

test('pose を書く入口のうち、方針を適用していないものは 0 個 (ADR-097 / 原則 #31)', () => {
  const files = collectSources(SRC_ROOT)
  assert.ok(files.length > 50, `src/ の走査に失敗している (${files.length} files)`)

  /** @type {string[]} */
  const violations = []

  for (const rule of POSE_WRITE_RULES) {
    const owners = new Set(rule.owners.map(p => p.split('/').join(sep)))
    for (const abs of files) {
      const rel = relative(REPO_ROOT, abs)
      if (owners.has(rel)) continue
      // メソッド定義そのものが在る場所は呼び手ではない。
      if (isDomainDefinition(rel) && rule.owners.length > 0) continue
      const lines = stripComments(readFileSync(abs, 'utf8'))
      lines.forEach((line, i) => {
        if (!rule.match.test(line)) return
        violations.push(
          `${rel}:${i + 1}\n` +
          `      規則「${rule.name}」に反する pose 書き込みがここにある。\n` +
          `      → ${rule.use}\n` +
          `      なぜ: ${rule.why}\n` +
          `      所有: ${rule.owners.length ? rule.owners.join(', ') : '(どこにも無いこと — 退役した経路)'}`,
        )
      })
    }
  }

  assert.deepEqual(violations, [], `\n${violations.join('\n\n')}\n`)
})

test('入口は実在し、実際に方針を適用している (規則が空回りしていない)', () => {
  // 対象が 0 個になったことは、規則が守られていることと区別がつかない
  // (原則 #31 の同型) — 所有者側が消えたら落とす。
  const svc = readFileSync(join(REPO_ROOT, POSE_ENTRY), 'utf8')
  for (const needle of [
    'applyPreviewTranslation(',   // 唯一の並進入口
    '_policyDelta(',              // その中で方針を当てる場所
    'resolvePlacementDelta(',     // 純粋な決定
    'supportOf(',                 // 支持の導出
    'setBelowGradeIntent(',       // 床下の宣言
    '_applyStackAssist(',         // 吸収した補助
  ]) {
    assert.ok(svc.includes(needle), `${POSE_ENTRY} に ${needle} が無い — 入口の所有者が失われている`)
  }
  // 入口の本体が方針を通ることを、順序も含めて固定する。
  const entry = svc.slice(svc.indexOf('applyPreviewTranslation(segStartCorners'))
  const body  = entry.slice(0, entry.indexOf('_applyStackAssist(segStartCorners'))
  assert.ok(/_policyDelta\(obj,/.test(body),
    'applyPreviewTranslation が _policyDelta を通らずに move している')
})

test('支持プローブの中に実体種の分岐は 0 個 (ADR-098 / 原則 #31)', () => {
  const violations = []
  const missing    = []

  for (const { file, method } of PROBE_METHODS) {
    const lines = stripComments(readFileSync(join(REPO_ROOT, file.split('/').join(sep)), 'utf8'))
    const found = extractMethodBody(lines, method)
    if (!found) {
      // 対象が消えたことは規則が守られていることと区別がつかない (原則 #31 の同型)。
      missing.push(`${file}: ${method}() が実在しない — 表から外すか、名前を追うこと`)
      continue
    }
    found.body.forEach((line, i) => {
      if (!/\binstanceof\b/.test(line)) return
      violations.push(
        `${file}:${found.start + i + 1}  (${method})\n` +
        '      支持プローブが実体種で分岐している。\n' +
        '      → supportProbeOf(entity) で宣言を引き、footprintSamplesFor / bottomZFor へ幾何を渡す\n' +
        '      なぜ: 「この種の底はどこか」は方針表と同じ問いであり、別の場所で答えると第二の源になる。' +
        '種を足したとき方針表は throw するのに、プローブは黙って「支持なし」を返す (ADR-098 §Decision 2)',
      )
    })
  }

  assert.deepEqual(missing, [], `\n${missing.join('\n')}\n`)
  assert.deepEqual(violations, [], `\n${violations.join('\n\n')}\n`)
})

test('pose を計算する側が「描画済みの状態」を読む箇所は 0 個 (ADR-101 / 原則 #24)', () => {
  const violations = []
  const missing    = []

  for (const { file, method } of POSE_COMPUTING_METHODS) {
    const lines = stripComments(readFileSync(join(REPO_ROOT, file.split('/').join(sep)), 'utf8'))
    const found = extractMethodBody(lines, method)
    if (!found) {
      // 対象が消えたことは規則が守られていることと区別がつかない (原則 #31 の同型)。
      missing.push(`${file}: ${method}() が実在しない — 表から外すか、名前を追うこと`)
      continue
    }
    found.body.forEach((line, i) => {
      for (const probe of LIVE_PROBES) {
        if (!probe.match.test(line)) continue
        violations.push(
          `${file}:${found.start + i + 1}  (${method})\n` +
          '      次の pose を決める計算が、いま描画されている pose を読んでいる。\n' +
          `      → ${probe.use}\n` +
          '      なぜ: live プローブは frame 由来の実体で _worldPoseCache を引き、' +
          'このキャッシュは rAF ごとにしか更新されない。ドラッグ中に読むと自分の' +
          '前フレームの出力が入力に戻り、載る→戻る の 2 周期で振動する (ADR-101)',
        )
      }
    })
  }

  assert.deepEqual(missing, [], `\n${missing.join('\n')}\n`)
  assert.deepEqual(violations, [], `\n${violations.join('\n\n')}\n`)
})

test('スナップショット由来のプローブが実在し、補助がそれを引いている (規則が空回りしていない)', () => {
  // 「禁じられた形が 0 個」だけでは、経路ごと消えても通ってしまう (原則 #31)。
  // 正しい入力が実際に引かれていることを逆向きに固定する。
  const lines = stripComments(readFileSync(join(REPO_ROOT, POSE_ENTRY), 'utf8'))
  const assist = extractMethodBody(lines, '_applyStackAssist')
  assert.ok(assist, '_applyStackAssist() が実在しない')
  const body = assist.body.join('\n')
  assert.match(body, /_segmentStartBottomZ\s*\(/,
    '補助がセグメント開始の底を引いていない — 入力が要求の関数でなくなっている')
  assert.match(body, /_destinationSamples\s*\(/,
    '補助が行き先の足跡を引いていない — 入力が要求の関数でなくなっている')
  assert.match(body, /appliedDeltas\s*\.\s*get\s*\(/,
    '補助が入口の適用済み delta を受け取っていない — 方針の結果を測り直している')
})

test('宣言されていない種分岐の例外は 0 個 (pose の書き込み ABI だけが例外)', () => {
  // 例外が在ること自体は正常 (CF と Solid では pose の書き方そのものが違う)。
  // 問題は「数えられていない例外」なので、宣言された場所に宣言された形が実在するかを
  // 逆向きに検査する。
  const missing = []
  for (const ex of DECLARED_TYPE_DISPATCH) {
    const lines = stripComments(readFileSync(join(REPO_ROOT, ex.file.split('/').join(sep)), 'utf8'))
    const found = extractMethodBody(lines, ex.method)
    if (!found || !found.body.some(l => /\binstanceof\b/.test(l))) {
      missing.push(
        `${ex.file}: 宣言された種分岐 ${ex.method}() が実在しない (宣言を削るか、経路を確認する)\n` +
        `      理由: ${ex.why}`,
      )
    }
  }
  assert.deepEqual(missing, [], `\n${missing.join('\n\n')}\n`)
})

test('プローブの宣言表は placement.js にあり、サービスはそれを引いている', () => {
  // 規則が空回りしていないこと — 宣言側と消費側の両方が実在するかを問う。
  const decl = readFileSync(join(REPO_ROOT, 'src/domain/placement.js'), 'utf8')
  for (const needle of [
    'SUPPORT_PROBE_BY_KIND', 'supportProbeFor', 'supportProbeOf',
    'footprintSamplesFor', 'bottomZFor', 'stackAssistApplies',
  ]) {
    assert.ok(decl.includes(needle), `placement.js に ${needle} が無い`)
  }
  assert.ok(/throw new Error\(\s*\n?\s*`\[placement\] no declared support probe/.test(decl),
    'supportProbeFor() の throw が消えている — 未宣言の種が黙って「支持なし」に落ちる')

  const svc = readFileSync(join(REPO_ROOT, POSE_ENTRY), 'utf8')
  for (const needle of ['supportProbeOf(', 'footprintSamplesFor(', 'bottomZFor(', 'stackAssistApplies(']) {
    assert.ok(svc.includes(needle), `${POSE_ENTRY} が ${needle} を引いていない`)
  }
})

test('方針の分類器 (placementOf) は 1 モジュールにしか無い', () => {
  const decl = readFileSync(join(REPO_ROOT, 'src/domain/placement.js'), 'utf8')
  for (const needle of ['PLACEMENT_BY_KIND', 'placementKindOf', 'placementFor', 'placementOf']) {
    assert.ok(decl.includes(needle), `placement.js に ${needle} が無い`)
  }
  // 「未宣言の種は throw」を消すと、ADR-096/097 が繰り返し閉じている
  // 「誰も選んでいない既定」が黙って戻る。
  assert.ok(/throw new Error\(\s*\n?\s*`\[placement\] no declared placement policy/.test(decl),
    'placementFor() の throw が消えている — 未宣言の種が黙って既定に落ちる')
})

test('宣言されていない pose 書き込みの例外は 0 個', () => {
  // 例外が在ること自体は正常 (undo は復元であって要求ではない)。問題は
  // 「数えられていない例外」なので、宣言された場所に宣言された形が実在するかを
  // 逆向きに検査する — 例外が消えたなら宣言も消すべきで、増えたならここへ足す。
  const missing = []
  for (const ex of DECLARED_EXCEPTIONS) {
    const abs = join(REPO_ROOT, ex.file.split('/').join(sep))
    const lines = stripComments(readFileSync(abs, 'utf8'))
    if (!lines.some(l => ex.match.test(l))) {
      missing.push(`${ex.file}: 宣言された例外 ${ex.match} が実在しない (宣言を削るか、経路を確認する)\n      理由: ${ex.why}`)
    }
  }
  assert.deepEqual(missing, [], `\n${missing.join('\n\n')}\n`)
})

test('ドラッグ平面の法線は 1 箇所からしか来ない (ADR-097 §Decision 5)', () => {
  // 3 実装が別々の規則を持っていたのが症状 4 の機構的な原因。平面を書く行が
  // 方針の解決を経ているかを、書く瞬間に問う。
  const sites = [
    'src/controller/handler/GrabOperationHandler.js',
    'src/controller/AppController.js',
  ]
  const violations = []
  for (const rel of sites) {
    const lines = stripComments(readFileSync(join(REPO_ROOT, rel.split('/').join(sep)), 'utf8'))
    lines.forEach((line, i) => {
      if (!/(?:s\.dragPlane|this\._objDragPlane)\.setFromNormalAndCoplanarPoint\s*\(/.test(line)) return
      const window = lines.slice(i, i + 4).join('\n')
      if (!window.includes('resolveDragPlaneNormal')) {
        violations.push(
          `${rel}:${i + 1}\n` +
          '      ドラッグ平面が方針を経ずに作られている。\n' +
          "      → resolveDragPlaneNormal(entity, { camera, scene, service })  — src/controller/dragPlaneNormal.js\n" +
          '      なぜ: 接地した実体をカメラ正対面で動かすと Z が入り、補助がそれを引き戻す — 入力と結果が二重にねじれる (ADR-097 症状 4)',
        )
      }
    })
  }
  assert.deepEqual(violations, [], `\n${violations.join('\n\n')}\n`)

  // 平面を選ぶ規則そのものは純粋関数に在り、grounded がカメラを読まないことは
  // src/domain/placement.test.js が固定している。
  const owner = readFileSync(join(REPO_ROOT, 'src/controller/dragPlaneNormal.js'), 'utf8')
  assert.ok(owner.includes('dragPlaneNormalFor('), 'dragPlaneNormal.js が純粋な決定を呼んでいない')
})
