/**
 * PosePolicyOwnership.test.js — 「pose を書く入口を列挙して、方針を通さない入口が
 * 0 個であること」を機械に問わせる (ADR-097 / ADR-101 / ADR-102 / 原則 #31 / 原則 #1)
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
 * ## 母集団は手で並べない (ADR-102 — この検査自身への同じ問い)
 *
 * ADR-098 と ADR-101 は「検査は**名指しした**メソッドの本体にしか当たらない。
 * 8 つ目が増えたら表に足すまで数えられない」と自分で書いて出荷した。表が
 * 古びても検査は緑を出し続けるので、古びたことに誰も気づかない — 原則 #31 が
 * 名指しする失敗の形が、原則 #31 の道具の側で起きていた。
 *
 * ADR-102 でこの非対称を閉じた。いま母集団は **`applyPreviewTranslation` からの
 * 呼び出し閉包**として**コードから導出される**:
 *
 *   - pose 決定に参加するメソッドが 1 本足されれば、その日から母集団に入る
 *   - 呼ばれなくなれば母集団から出る (宣言だけが残れば逆向き検査が落とす)
 *   - 手で並べた表は「発見の結果」ではなく **「分類の宣言」** になり、
 *     未分類の個数を 0 に保つことが検査になる
 *
 * 初回の実行が実際に 1 件見つけた: `highestSurfaceAt()` が
 * `!(o instanceof MeasureLine)` で**支える側**を種で門番していた。ADR-098 は
 * 載る側の門を 2 枚外したが、その鏡像は誰の表にも載っていなかった (宣言表へ移した
 * = `SUPPORT_SURFACE_BY_KIND`)。「8 つ目」は増えたのではなく最初から表の外に在った。
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
import { readFileSync, readdirSync } from 'node:fs'
import {
  REPO_ROOT, repoPath, relPath,
  collectSources, stripComments, methodsOf, extractMethodBody, callClosure,
} from './census/sources.js'
import { assertCoversPopulation, assertDeclarationsExist } from './census/partition.js'
import { join } from 'node:path'

/** 方針を適用する唯一の入口を持つモジュール。 */
const POSE_ENTRY = 'src/service/SceneService.js'
/** pose 決定の呼び出し閉包を張る入口メソッド (母集団の根)。 */
const POSE_DECISION_ROOT = 'applyPreviewTranslation'

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
 * **実体種による分岐の形** — `instanceof <ドメイン実体クラス>`。
 *
 * クラス名は `src/domain/` の `export class` から**導出**する。手で並べると
 * 新しい実体クラスが増えた日に検査だけが古い語彙で回り続ける (§1.1)。
 * `instanceof Set` のような JS の慣用形は母集団に入らない — 種の分岐ではないため。
 */
function domainEntityClasses() {
  const names = new Set()
  for (const entry of readdirSync(join(REPO_ROOT, 'src', 'domain'))) {
    if (!entry.endsWith('.js') || entry.endsWith('.test.js')) continue
    const src = readFileSync(join(REPO_ROOT, 'src', 'domain', entry), 'utf8')
    for (const m of src.matchAll(/^export class ([A-Z][\w$]*)/gm)) names.add(m[1])
  }
  assert.ok(names.size >= 8, `src/domain/ の実体クラスが見つからない (${names.size})`)
  return new RegExp(`\\binstanceof\\s+(?:${[...names].join('|')})\\b`)
}

/** 描画済みの状態を答えるアクセサ (query 専用 — pose を決める側が読んではならない)。 */
const LIVE_PROBES = [
  { match: /this\._bottomZOf\s*\(/,          use: 'this._segmentStartBottomZ(obj, startCorners)' },
  { match: /this\._footprintSamplesOf\s*\(/, use: 'this._destinationSamples(obj, startCorners, delta)' },
  { match: /this\.worldPoseOf\s*\(/,         use: 'セグメント開始スナップショット + 要求 delta から導く' },
  { match: /this\._worldPoseCache\b/,        use: 'セグメント開始スナップショット + 要求 delta から導く' },
]

/**
 * **支持プローブ** = 宣言表 (`SUPPORT_PROBE_BY_KIND` / `SUPPORT_SURFACE_BY_KIND`) を
 * 引くメソッド。「この種の底はどこか」「この種は面を差し出すか」に答える側。
 *
 * この表は**発見の結果ではなく分類の宣言**である (ADR-102)。母集団は下の
 * `probeConsumers()` がコードから導出し、この表との差が 0 であることを両方向に
 * 問う — 8 つ目が足されればここに載っていない側で落ちる。
 *
 * 旧版 (ADR-098) はここに 7 行を手で並べていた。実測すると 1 行は宣言表を
 * 引いていない別物 (`_applyStackAssist` — プローブを *呼ぶ* 側) で、逆に
 * `highestSurfaceAt` が漏れていた。手で並べた表は、書いた日の理解の写しでしかない。
 */
const PROBE_METHODS = [
  '_footprintSamplesOf',
  '_bottomZOf',
  '_segmentStartBottomZ',
  '_destinationSamples',
  '_probeGeometryOf',
  '_snapshotGeometryOf',
  'highestSurfaceAt',
]

/**
 * **pose を計算するメソッド** — 次の pose を決める側 (ADR-101)。
 *
 * ADR-102 以降、この表は*規則が当たる母集団*ではない (母集団は下の閉包)。
 * 「名前で読みたい writer」を人向けに残したもので、閉包の中に実在することだけを
 * 逆向きに問う — 閉包から外れたらここも直す。
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
 */
const POSE_COMPUTING_METHODS = [
  { key: 'applyPreviewTranslation', why: '唯一の並進入口。方針を当てて delta を配る' },
  { key: '_policyDelta',            why: '方針 (床・支持・床下) を当てて delta を補正する純粋寄りの段' },
  { key: '_applyStackAssist',       why: '座らせる補助。入口の一部であって独立した計算ではない (ADR-101)' },
  { key: '_applyEntityDelta',       why: 'pose を実際に書く ABI' },
]

/**
 * **種分岐が在ってよい閉包メンバ**と、その宣言された理由。
 *
 * 「例外が在ること」ではなく「例外が数えられていること」が要点。母集団は閉包 ∩
 * 種分岐なので、宣言の無い分岐が 1 つでも増えれば落ちる。
 */
const DECLARED_TYPE_DISPATCH = [
  {
    key: '_applyEntityDelta',
    why: 'pose を**どう書くか** (CF は parent-local delta / Solid は _position スナップショット / それ以外は corners) の ABI であって、どの方針が当たるかではない。方針は呼ばれる前に _policyDelta が決めている。この 1 箇所に集めたからこそ、補助 (_applyStackAssist) が種の門を持たずに同じ ABI を使える (ADR-098)',
  },
  {
    key: '_getParentWorldQuat',
    why: '**親の pose がどこに保存されているか**の分岐 (CF 親はキャッシュ / Solid 親は orientation)。配置方針の問いではなく格納形式の問いで、答えは実体の定義そのものに属する。ADR-102 の閉包検査が初めてここを母集団に入れた — ADR-101 の表は writer 4 本で止まっており、その 1 hop 内側は誰も数えていなかった',
  },
  {
    key: '_getParentWorldPos',
    why: '同上 (位置側)。Solid 親では corners の平均ではなく _position を読む — 平均は毎フレーム FP 誤差を溜める (原則 #24)',
  },
]

/**
 * **live プローブを読んでよい閉包メンバ**と、その宣言された理由。
 *
 * ADR-101 は「pose を決める側は描画済みの状態を読まない」を writer 4 本に課したが、
 * 閉包で数えると 2 本が残っていた。**残ってよい**ものなので消さずに宣言する
 * (原則 #24 の閉路は *自分の出力* が入力に戻ることで成立する — 他人の pose を
 * 読むのは閉路ではない)。宣言することで、前提が崩れた日に議論の場所ができる。
 */
const DECLARED_LIVE_PROBE_READERS = [
  {
    key: '_getParentWorldQuat',
    why: '読むのは**親**の world pose であって自分の出力ではないので、原則 #24 の閉路を作らない。'
       + 'ドラッグ中に親が動かない限りキャッシュは古くとも一定で、要求から pose への写像は関数のまま。'
       + '親子がまとめて動くジェスチャが実装されたらこの前提は崩れる — '
       + 'docs/gsn/adr-101-pose-writers-derive-from-request.gsn の assumption '
       + 'SnapshotLiftingHoldsForNestedFrames が同じ前提を名指ししており、その回収先は appliedDeltas',
  },
  {
    key: '_getParentWorldPos',
    why: '同上 (位置側)。Solid 親の枝はキャッシュを引かず _position を読むので、そもそも rAF 周期に依存しない',
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
 *
 * 同じ理由で、種分岐の母集団を「SceneService の全メソッド」には広げない — 実測
 * 126 本中 37 本が `instanceof` を含み、その大半は配置と無関係 (保存/読込・
 * 祖先探索・IFC クラス設定)。母集団は **pose 決定の閉包 11 本**に絞る。
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

const isDomainDefinition = rel => rel.startsWith('src/domain/')

/** SceneService のメソッド表 (毎回読み直す — 検査は実状態を読む)。 */
const serviceMethods = () => methodsOf(readFileSync(repoPath(POSE_ENTRY), 'utf8'))

/** pose 決定に参加するメソッド = 入口からの呼び出し閉包 (母集団の導出)。 */
function poseDecisionClosure() {
  const methods = serviceMethods()
  const closure = callClosure(methods, POSE_DECISION_ROOT)
  assert.ok(closure.size >= 8,
    `pose 決定の閉包が ${closure.size} 本しかない — 入口名 (${POSE_DECISION_ROOT}) か閉包の導出が壊れている`)
  return { methods, closure }
}

/** 支持プローブ = 宣言表を引くメソッド (母集団の導出)。 */
function probeConsumers(methods) {
  const CONSULTS = /supportProbeOf\s*\(|footprintSamplesFor\s*\(|bottomZFor\s*\(|probeNeedsWorldOrigin\s*\(|providesSupportSurface\s*\(/
  return [...methods.values()].filter(m => m.body.some(l => CONSULTS.test(l))).map(m => m.name)
}

test('pose を書く入口のうち、方針を適用していないものは 0 個 (ADR-097 / 原則 #31)', () => {
  const files = collectSources()
  assert.ok(files.length > 50, `src/ の走査に失敗している (${files.length} files)`)

  /** @type {string[]} */
  const violations = []

  for (const rule of POSE_WRITE_RULES) {
    const owners = new Set(rule.owners)
    for (const abs of files) {
      const rel = relPath(abs)
      if (owners.has(rel)) continue
      // メソッド定義そのものが在る場所は呼び手ではない。
      if (isDomainDefinition(rel) && rule.owners.length > 0) continue
      stripComments(readFileSync(abs, 'utf8')).forEach((line, i) => {
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
  const svc = readFileSync(repoPath(POSE_ENTRY), 'utf8')
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

test('支持プローブの表は、宣言表を引くメソッドの集合と一致する (ADR-102 / 原則 #31)', () => {
  // 母集団は**コードから導出**する。手で並べた表との差が 0 であることを両方向に
  // 問うので、8 つ目のプローブは載っていない側で落ちる。
  const { methods } = poseDecisionClosure()
  assertCoversPopulation({
    what: '支持プローブ (宣言表 SUPPORT_PROBE_BY_KIND / SUPPORT_SURFACE_BY_KIND を引くメソッド)',
    population: probeConsumers(methods),
    declared: PROBE_METHODS,
    howDerived: `${POSE_ENTRY} のメソッドのうち supportProbeOf / footprintSamplesFor / bottomZFor / probeNeedsWorldOrigin / providesSupportSurface を引くもの`,
    onNew: 'PROBE_METHODS に名前を足す (足したものは下の「種分岐 0 個」検査の対象になる)',
  })
})

test('支持プローブの中に実体種の分岐は 0 個 (ADR-098 / 原則 #31)', () => {
  const { methods } = poseDecisionClosure()
  const KIND_DISPATCH = domainEntityClasses()
  const violations = []

  for (const name of probeConsumers(methods)) {
    const m = methods.get(name)
    m.body.forEach((line, i) => {
      if (!KIND_DISPATCH.test(line)) return
      violations.push(
        `${POSE_ENTRY}:${m.start + i + 1}  (${name})\n` +
        '      支持プローブが実体種で分岐している。\n' +
        '      → supportProbeOf(entity) / providesSupportSurface(entity) で宣言を引く\n' +
        '      なぜ: 「この種の底はどこか」「この種は面を差し出すか」は方針表と同じ問いであり、' +
        '別の場所で答えると第二の源になる。種を足したとき方針表は throw するのに、' +
        'プローブは黙って「支持なし」を返す (ADR-098 §Decision 2 / ADR-102 §Decision 2)',
      )
    })
  }

  assert.deepEqual(violations, [], `\n${violations.join('\n\n')}\n`)
})

test('pose 決定の閉包に、宣言されていない種分岐は 0 個 (ADR-102 / 原則 #31)', () => {
  // 母集団 = 入口からの呼び出し閉包 ∩ 実体種の分岐。旧版はここを手書きの
  // 4 メソッドに絞っており、1 hop 内側 (_getParentWorldPos/Quat) を数えていなかった。
  const { methods, closure } = poseDecisionClosure()
  const KIND_DISPATCH = domainEntityClasses()
  const population = [...closure].filter(n => methods.get(n).body.some(l => KIND_DISPATCH.test(l)))

  assertCoversPopulation({
    what: 'pose 決定の閉包における実体種の分岐',
    population,
    declared: [],
    excluded: DECLARED_TYPE_DISPATCH,
    howDerived: `${POSE_ENTRY} の ${POSE_DECISION_ROOT}() から this._x() 辺を辿った閉包のうち、instanceof <ドメイン実体クラス> を含むもの`,
    onNew: '種で分岐せず placementOf / supportProbeOf / providesSupportSurface の宣言を引くこと。'
         + '格納形式の分岐など正当な理由があるなら DECLARED_TYPE_DISPATCH に理由付きで宣言する',
  })
})

test('pose 決定の閉包が「描画済みの状態」を読む箇所は、宣言されたもの以外 0 個 (ADR-101 / ADR-102 / 原則 #24)', () => {
  const { methods, closure } = poseDecisionClosure()
  const population = [...closure].filter(n =>
    methods.get(n).body.some(l => LIVE_PROBES.some(p => p.match.test(l))))

  assertCoversPopulation({
    what: 'pose 決定の閉包における live プローブの読み',
    population,
    declared: [],
    excluded: DECLARED_LIVE_PROBE_READERS,
    howDerived: `${POSE_ENTRY} の ${POSE_DECISION_ROOT}() からの閉包のうち、`
              + LIVE_PROBES.map(p => String(p.match)).join(' / ') + ' のいずれかを含むもの',
    onNew: 'セグメント開始のスナップショット + 要求 delta から導くこと '
         + `(${LIVE_PROBES.map(p => p.use).join(' / ')})。`
         + '自分の出力が入力に戻らない読み (親の pose 等) なら DECLARED_LIVE_PROBE_READERS に理由付きで宣言する',
  })
})

test('名指しした writer は、いまも pose 決定の閉包の中に在る (逆向き)', () => {
  // ADR-102 以降、規則が当たる母集団は閉包そのもの。この表は人が名前で読むための
  // ものなので、閉包から外れた (= 入口から呼ばれなくなった) ら落とす。
  const { closure } = poseDecisionClosure()
  assertDeclarationsExist({
    what: 'pose を計算する writer',
    declarations: POSE_COMPUTING_METHODS,
    exists: key => closure.has(key),
    onStale: `${POSE_DECISION_ROOT}() から到達しなくなっている — 表から消すか、経路を確認すること`,
  })
})

test('スナップショット由来のプローブが実在し、補助がそれを引いている (規則が空回りしていない)', () => {
  // 「禁じられた形が 0 個」だけでは、経路ごと消えても通ってしまう (原則 #31)。
  // 正しい入力が実際に引かれていることを逆向きに固定する。
  const lines = stripComments(readFileSync(repoPath(POSE_ENTRY), 'utf8'))
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

test('プローブの宣言表は placement.js にあり、サービスはそれを引いている', () => {
  // 規則が空回りしていないこと — 宣言側と消費側の両方が実在するかを問う。
  const decl = readFileSync(repoPath('src/domain/placement.js'), 'utf8')
  for (const needle of [
    'SUPPORT_PROBE_BY_KIND', 'supportProbeFor', 'supportProbeOf',
    'footprintSamplesFor', 'bottomZFor', 'stackAssistApplies',
    'SUPPORT_SURFACE_BY_KIND', 'providesSupportSurfaceFor', 'providesSupportSurface',
  ]) {
    assert.ok(decl.includes(needle), `placement.js に ${needle} が無い`)
  }
  assert.ok(/throw new Error\(\s*\n?\s*`\[placement\] no declared support probe/.test(decl),
    'supportProbeFor() の throw が消えている — 未宣言の種が黙って「支持なし」に落ちる')
  assert.ok(/throw new Error\(\s*\n?\s*`\[placement\] no declared support surface/.test(decl),
    'providesSupportSurfaceFor() の throw が消えている — 未宣言の種の上に何も載らないことが黙って決まる')

  const svc = readFileSync(repoPath(POSE_ENTRY), 'utf8')
  for (const needle of [
    'supportProbeOf(', 'footprintSamplesFor(', 'bottomZFor(', 'stackAssistApplies(',
    'providesSupportSurface(',
  ]) {
    assert.ok(svc.includes(needle), `${POSE_ENTRY} が ${needle} を引いていない`)
  }
})

test('方針の分類器 (placementOf) は 1 モジュールにしか無い', () => {
  const decl = readFileSync(repoPath('src/domain/placement.js'), 'utf8')
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
  assertDeclarationsExist({
    what: 'pose 書き込みの例外',
    declarations: DECLARED_EXCEPTIONS.map(ex => ({ key: ex.file, why: ex.why, match: ex.match })),
    exists: (key) => {
      const ex = DECLARED_EXCEPTIONS.find(e => e.file === key)
      return stripComments(readFileSync(repoPath(key), 'utf8')).some(l => ex.match.test(l))
    },
    onStale: '宣言を削るか、経路を確認すること',
  })
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
    const lines = stripComments(readFileSync(repoPath(rel), 'utf8'))
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
  const owner = readFileSync(repoPath('src/controller/dragPlaneNormal.js'), 'utf8')
  assert.ok(owner.includes('dragPlaneNormalFor('), 'dragPlaneNormal.js が純粋な決定を呼んでいない')
})
