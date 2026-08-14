/**
 * GraspSubjectOwnership — 「この探索は誰についてか」を述べる場所の個数 (ADR-130)。
 *
 * ## 数えるのは「偽の阻止文」であって、在る文ではない
 *
 * 今日までの欠陥は、画面に文が**足りない**ことではなく、**出てはいけない場面で
 * 出る**ことだった。把持探索が開いているのに「ロボットを選べ」と出る — しかも
 * その探索は主語を持っており、Run は通る。だから数えるべきは在る文の個数ではなく、
 * **探索が生きている間に出うる阻止文の個数**で、これは 0 でなければならない。
 *
 * 在る文を辿る検査は定義上これを見ない (文は正しく実装され、正しく表示されている
 * — 間違っているのは*問いのほう*である)。原則 #31 が名指しする形で、ADR-102 の
 * 「母集団を持たない表」と同じく、母集団は**画面に出た文**ではなく
 * **手順が通る選択の全種類**から導出する。
 *
 * ## 母集団は「歩き方」から導出する — 目で見た画面からではない
 *
 * ユーザーの手順 (`docs/dogfooding/ux-scenarios.md`) は、掴む対象を選ぶために
 * 選択をロボットから**必ず**外す。よって母集団は `DECLARED_NPANEL_KINDS` +
 * 「選択なし」であり、そのすべてで探索が生きている間の kind が `LIVE` である
 * ことを問う。1 種類だけ試す検査は、手順が実際に通る種類を外しうる。
 *
 * @see docs/adr/ADR-130-a-search-owns-its-subject-the-selection-does-not.md
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { collectSources, stripCommentsFlat, relPath, repoPath } from './census/sources.js'
import { assertCoversPopulation, assertDeclarationsExist } from './census/partition.js'
import {
  graspEntryFor, graspEntryRow,
  GRASP_ENTRY_KIND, DECLARED_GRASP_ENTRY_KINDS, DECLARED_NPANEL_KINDS,
} from './view/EntityScopeChecks.js'
import { Robot, robotForFrameId } from './domain/robotFrames.js'

/**
 * 探索が生きている間に手順が通しうる選択の全種類。**手書きの一覧ではない** —
 * 母集団は `DECLARED_NPANEL_KINDS` (実体種の宣言表) から導出し、そこに
 * 「選択なし」を足す。手で並べると、5 種目が生まれた日にこの検査だけが
 * 4 種のままになる (ADR-102 の `place-list`)。
 *
 * 「選択なし」を含むのが要点 — ビューポートの空きをクリックするのは通常の操作で、
 * そこが今日 `NO_SELECTION` の阻止文を出していた。
 */
const SELECTION_SHAPES = {
  none: null,
  ...Object.fromEntries(DECLARED_NPANEL_KINDS.map(type => [type, { type, robotRole: null }])),
  // `frame` は宣言されたロールで枝が分かれる唯一の種 — 両方を通す。
  'frame:base': { type: 'frame', robotRole: 'base' },
  'frame:tcp':  { type: 'frame', robotRole: 'tcp' },
}

test('選択の母集団が実体種の宣言表を覆っている — 手書きの写しでない', () => {
  // `SELECTION_SHAPES` が古びていないことを、表の側ではなく**母集団の側**から問う。
  assertCoversPopulation({
    what:       '探索中に通りうる選択',
    population: ['none', ...DECLARED_NPANEL_KINDS],
    declared:   Object.keys(SELECTION_SHAPES).filter(k => !k.includes(':')),
    howDerived: "DECLARED_NPANEL_KINDS (ENTITY_SCOPE_BY_KIND の種) + 'none' (選択なし)",
    onNew:      '実体種が増えたら SELECTION_SHAPES も自動で覆う — 覆えていないなら ' +
                '導出が壊れている (手書きへ退化した)',
  })
})

test('探索が生きている間、阻止文は 0 個 — 選択の種類によらず', () => {
  const blocked = Object.entries(SELECTION_SHAPES).filter(([, sel]) => {
    const entry = graspEntryFor(sel, {
      robotCardinality: 'single', liveSearch: true, subjectLabel: 'robot_base',
    })
    return entry.kind !== GRASP_ENTRY_KIND.LIVE || entry.reason !== null
  }).map(([key]) => key)
  assert.deepEqual(blocked, [],
    '\n探索が開いているのに阻止理由を返した選択がある。\n' +
    '  掴む対象を選ぶには選択をロボットから外すしかないので、これは手順が\n' +
    '  自分のゲートを踏む形である (ADR-130 D3)。主語は context.robots が持つ。\n')
})

test('入口の kind の母集団が宣言表を覆っている — kind ごとに描き方が在る', () => {
  assertCoversPopulation({
    what:       '把持入口の kind',
    population: Object.values(GRASP_ENTRY_KIND),
    declared:   DECLARED_GRASP_ENTRY_KINDS,
    howDerived: 'GRASP_ENTRY_KIND の値 (union の全枝)',
    onNew:      'EntityScopeChecks.js の GRASP_ENTRY_ROW_BY_KIND に行を足すこと — ' +
                '描き方の無い kind は画面で「押せない」に潰れる (原則 #31)',
  })
})

test('未宣言の kind では throw する — 描画が fall-through しない', () => {
  assert.throws(() => graspEntryRow({ kind: 'something-new' }), /未宣言の入口の kind/)
})

test('探索が生きていて主語が未宣言なら、そう述べる — 選択のせいにしない', () => {
  const entry = graspEntryFor({ type: 'generic' }, {
    robotCardinality: 'multi', liveSearch: true, subjectLabel: null,
  })
  const row = graspEntryRow(entry)
  assert.equal(entry.kind, GRASP_ENTRY_KIND.LIVE)
  assert.match(row.caption, /no subject yet/,
    '主語未宣言は「まだ言っていない」であって「選択が悪い」ではない (原則 #31)')
})

test('探索が生きていないときは、従来どおり選択が入口を決める', () => {
  // ADR-110 / ADR-105 の判断は変わらない — 変えたのは「生きている間」だけである。
  const open = graspEntryFor({ type: 'frame', robotRole: 'base' }, { robotCardinality: 'single' })
  assert.equal(open.kind, GRASP_ENTRY_KIND.OPEN)
  const blocked = graspEntryFor({ type: 'generic' }, { robotCardinality: 'single' })
  assert.equal(blocked.kind, GRASP_ENTRY_KIND.BLOCKED)
  assert.ok(blocked.reason?.length > 0, '阻止には理由が要る (原則 #11)')
  // 実体種の宣言表は依然として全種を覆っている (この ADR は母集団を変えない)。
  assert.ok(DECLARED_NPANEL_KINDS.length >= 4)
})

// ── 同一性: どのロボットの frame か (ADR-130 D2) ──────────────────────────────

test('base と tcp は同じロボットを指す — 選択がどちらでも主語は 1 つ', () => {
  const robots = [
    new Robot({ id: 'b1', name: 'robot_base' },   { id: 't1', name: 'tcp' }),
    new Robot({ id: 'b2', name: 'robot_base_2' }, { id: 't2', name: 'tcp_2' }),
  ]
  assert.equal(robotForFrameId(robots, 'b2')?.id, 'b2')
  assert.equal(robotForFrameId(robots, 't2')?.id, 'b2', 'tcp を選ぶのはそのロボットを選ぶこと')
  assert.equal(robotForFrameId(robots, 'nope'), null)
  assert.equal(robotForFrameId(robots, null), null, '選択なしはロボットではない (0 は状態)')
  assert.equal(robotForFrameId([], 'b1'), null, '0 台のときは誰でもない')
})

// ── 主語を書く入口の個数 (原則 #1 / ADR-097 の形) ─────────────────────────────

/**
 * `_selectedRobotId` に**代入する**箇所の宣言。数えるのは在る経路ではなく、
 * *宣言されていない* 経路である — 3 つ目の書き手が生まれた日に落ちる。
 */
const DECLARED_SUBJECT_WRITERS = [
  { key: 'constructor',              why: '初期値 = 未宣言 (0 は既定値ではなく状態 — 原則 #31)' },
  { key: 'selectRobot',              why: 'パネルの pick (ユーザーが明示的に選ぶ verb)' },
  { key: 'refreshRobots',            why: '解決できなくなった選択を落とす (ロボットが消えたとき)' },
  { key: '_adoptSelectionAsSubject', why: '入口が選択を主語として採る (ADR-130 D2)' },
]

/** `GraspController` のソース (両方の検査が同じ 1 本を読む)。 */
const graspControllerSource = () =>
  stripCommentsFlat(readFileSync(repoPath('src/controller/GraspController.js'), 'utf8'))

test('探索の主語を書く入口は宣言された 4 つだけ', () => {
  const assignments = [...graspControllerSource().matchAll(/this\._selectedRobotId\s*=/g)].length
  assert.equal(assignments, DECLARED_SUBJECT_WRITERS.length,
    '\n`_selectedRobotId` への代入の個数が宣言と合わない。\n' +
    `  宣言: ${DECLARED_SUBJECT_WRITERS.map(d => `${d.key} (${d.why})`).join(' / ')}\n` +
    '  主語の書き手が増えると、画面が言う主語と Run が読む主語がまた割れる (原則 #1 / #4)。\n')
})

test('宣言された書き手はすべて実在する — 消えた入口が緑を出さない', () => {
  // 逆向き (ADR-102): 個数が合っていても、宣言のほうが古びていれば「4 つ在る」の
  // 中身は別物になりうる。名前で実在を問うと、入口を消したのに宣言を残した日に落ちる。
  const src = graspControllerSource()
  assertDeclarationsExist({
    what:         '探索の主語を書く入口',
    declarations: DECLARED_SUBJECT_WRITERS,
    exists:       key => new RegExp(`\\b${key}\\s*\\(`).test(src),
    onStale:      '入口を消したなら宣言も消すこと — 空回りする規則は緑を出し続ける',
  })
})

test('入口の可用性を読む側は、選択だけを源にしていない', () => {
  // 描く側が `context.grasp` を読まなくなったら、この ADR の判断は静かに戻る
  // (欄を読まないことは、欄が無いことと同じに見える — 原則 #31)。
  const jsx = readFileSync(repoPath('src/components/NPanel/EntityChecks.jsx'), 'utf8')
  assert.match(jsx, /context\.grasp/,
    'EntityChecks が「探索が生きているか」を読んでいない — 読まなければ選択が唯一の源に戻る')
  assert.match(jsx, /graspEntryRow/,
    '描き方が宣言表を通っていない — `available` の 2 分岐へ潰し直されている')
})

test('graspEntryFor の呼び手は 1 つ — 入口の判定が第二の源を持たない', () => {
  // 定義そのもの (`export function graspEntryFor(`) は呼びではない。
  const callers = collectSources()
    .filter(abs => /(?<!function\s)graspEntryFor\s*\(/.test(stripCommentsFlat(readFileSync(abs, 'utf8'))))
    .map(relPath)
  assert.deepEqual(callers, ['src/components/NPanel/EntityChecks.jsx'],
    '\n入口の判定を呼ぶ場所が増えている。判定が散ると、片方だけが探索の生死を\n' +
    '  読む状態が生まれ、同じ画面で矛盾する 2 つの答えが出る (§1.1)。\n')
})
