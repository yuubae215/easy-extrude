/**
 * SearchGeometryOwnership.test.js — 「探索は何について解いているか」の源と、
 * 退役した破壊経路の**個数**を機械に問わせる (ADR-132 / 原則 #31 / #1)
 *
 * ADR-132 が閉じた欠陥は 3 つとも *在るもの* を辿っても見えない形をしていた:
 *
 *  1. **源の食い違い** — ロボットは live scene、掴む対象は文書。どちらも自分の源から
 *     正しく解決されるので、片方ずつ読む限り欠陥は無い。並べたときにしか現れない。
 *
 *  2. **消費者が 0 人の機械** — `decompileLayout` (ADR-055) は作られ、fixpoint law まで
 *     テストされ、**生産経路から一度も呼ばれていなかった**。「機構は在る」と「読む機械が
 *     在る」は別の事実で、後者が無いあいだ検査は緑ですらなく**不在**だった (ADR-115 と同型)。
 *     だからここは「呼ばれている個数 ≥ 1」を問う — 0 に戻った日に落ちる。
 *
 *  3. **退役した破壊動詞** — `quickStartExample` / `ensureRobotFrames({seed:true})` は
 *     使わなくなっただけでは消えない。ADR-103 が名指しした形 (`DS_PENDING` が廃止後も
 *     3 リリース enum に残った) で、**退役の腐敗は違反を見逃すのではなく緑を出す**。
 *     消したこと自体を数える。
 *
 * 数え方の規律: 母集団は「今日の呼び出し箇所」ではなく**語彙**から取る。退役した名前を
 * 列挙して個数 0 を問うので、誰かが同じ名前を書き戻した瞬間に落ちる。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC_ROOT  = fileURLToPath(new URL('.', import.meta.url))
const REPO_ROOT = join(SRC_ROOT, '..')

/**
 * 退役した形 (ADR-132)。**「使っていない」ではなく「語彙から消えている」**ことを問う。
 * 各行は「何を消したか」と「なぜ戻してはいけないか」を持つ — 理由の無い禁止は、
 * 次の人が正当な理由で破る。
 */
const RETIRED_SHAPES = Object.freeze([
  {
    pattern: /quickStartExample/,
    what:    'ContextController.quickStartExample',
    why:     'ユーザーが選んでいない文書ロード = 無断のシーン全消し。入口が「速い開始」を'
           + '求めたときに grep で見つかる場所に在ってはならない (ADR-132 D4)',
  },
  {
    pattern: /ensureRobotFrames\s*\(\s*\{[^}]*seed/,
    what:    'ensureRobotFrames({ seed: … })',
    why:     '基数 1 を基数 0 として提示するロボットを boot が作る経路。ADR-090 が 0 台を'
           + '一級市民にした後、ここだけが反対を言い続けていた (ADR-132 D5)',
  },
  {
    pattern: /GRASP_QUICKSTART_TEMPLATE_ID/,
    what:    'GRASP_QUICKSTART_TEMPLATE_ID',
    why:     '入口が既定で読み込む文書の id。定数が残っていれば経路は復元できる',
  },
])

/** 探索の幾何を決めてよい唯一の解決点 (§1.1)。 */
const RESOLUTION_OWNER = 'src/domain/searchGeometry.js'

function collectSources(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'engine') continue
    const abs = join(dir, entry)
    if (statSync(abs).isDirectory()) { collectSources(abs, out); continue }
    if (!/\.jsx?$/.test(entry)) continue
    if (entry.endsWith('.test.js')) continue
    out.push(abs)
  }
  return out
}

/** コメントを潰す (散文中の言及・退役の記録で発火させない)。行番号は保存する。 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map(line => line.replace(/\/\/.*$/, ''))
}

/** 生産コード (テストを除く src/) の行を [{rel, line, text}] で返す。 */
function productionLines() {
  const out = []
  for (const abs of collectSources(SRC_ROOT)) {
    const rel = relative(REPO_ROOT, abs).split(sep).join('/')
    stripComments(readFileSync(abs, 'utf8')).forEach((line, i) => {
      out.push({ rel, line: i + 1, text: line })
    })
  }
  return out
}

test('退役した破壊経路はコードから消えている — 使われていないだけでは足りない (ADR-132 / #31)', () => {
  const lines = productionLines()
  assert.ok(lines.length > 1000, `src/ の走査が対象を失っている (${lines.length} 行)`)

  for (const shape of RETIRED_SHAPES) {
    const hits = lines.filter(l => shape.pattern.test(l.text))
    assert.deepEqual(
      hits.map(h => `${h.rel}:${h.line}`), [],
      `${shape.what} は退役済み。理由: ${shape.why}\n` +
      `見つかった箇所: ${hits.map(h => `${h.rel}:${h.line}  ${h.text.trim()}`).join(' | ')}\n` +
      '退役の腐敗は違反を*見逃す*のではなく **緑を出す** (ADR-103) ので、消したこと自体を数える。',
    )
  }
})

test('scene → Layout DSL の逆写像には消費者が居る — 機構が在るだけでは緑ですらない (ADR-115 と同型)', () => {
  // ADR-055 から ADR-132 までのあいだ、この数は 0 だった。0 に戻ったら
  // 「探索はいま画面に在るものについて解く」という主張が静かに空洞化する。
  const callers = productionLines().filter(l => /decompileLayout\s*\(/.test(l.text))
  assert.ok(
    callers.length >= 1,
    'decompileLayout を production から呼ぶ箇所が 0 件。ADR-055 の φ⁻¹ は「作ったが誰も読まない機械」に戻っている\n' +
    '(探索の幾何は live scene から来る — ADR-132 D1)',
  )
})

test('探索の幾何の源を決めるのは 1 箇所だけ (§1.1 / 原則 #1)', () => {
  // `resolveSearchLayout` の**定義**は 1 つ。呼び手は何人でもよいが、
  // 「シーンと文書のどちらが幾何を持つか」を各所で書き直すことは許さない。
  const definitions = productionLines().filter(l => /export function resolveSearchLayout/.test(l.text))
  assert.deepEqual(
    definitions.map(d => d.rel), [RESOLUTION_OWNER],
    '源の規則は 1 箇所。規則を持つ経路と持たない経路が並ぶと、欠陥は必ず持たないほうに住む (ADR-097)',
  )

  // 逆向き — 呼び手が居ないなら規則は空回りしている (非空虚性)。
  const callers = productionLines().filter(
    l => /resolveSearchLayout\s*\(/.test(l.text) && l.rel !== RESOLUTION_OWNER,
  )
  assert.ok(callers.length >= 1, 'resolveSearchLayout の呼び手が 0 件 — 規則が誰にも適用されていない')
})
