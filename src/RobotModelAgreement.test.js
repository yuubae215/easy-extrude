/**
 * RobotModelAgreement.test.js — 「この repo で『どの腕か』を語っている宣言のうち、
 * 出荷している 1 台と食い違っている個数」を機械に数えさせる (ADR-141 / 原則 #31)
 *
 * ## 数えるべきは *在る宣言* ではなく *一致していない宣言* である
 *
 * ADR-141 以前、「どの腕か」を語る源は 5 つあり、どれも互いを見ていなかった:
 * 描く URDF (UR5e) · `REACH_PRESETS` の 3 本 (うち 2 本は存在しない腕) ·
 * 文書の `f_robot.attrs.reach` · バックエンド受け入れフィクスチャ。
 * **どれも単体では正しく読める** — 食い違いは、2 つを同じ視野に入れたときだけ
 * 見える。そして 2 つを同じ視野に入れる場所は、この検査が書かれるまで repo の
 * どこにも無かった (§1.1 の違反は「値が違う」ことではなく「著者が複数いる」こと)。
 *
 * ## 母集団
 *
 * `examples/*.json` を走査して **reach を語っている宣言を全部拾う** (在る宣言を
 * 辿るのではなく、*語っている* ものを列挙して 1 台と突き合わせる)。新しい
 * example が 1.3 m の腕を宣言した日に、表へ足すのを忘れても母集団に入る。
 *
 * ## 宣言された除外 (原則 #29 — 対象外は「宣言」であって沈黙ではない)
 *
 * `templates/` は**フロントの examples ではない** — CLAUDE.md が明示的に分けて
 * いるとおり、バックエンドレイヤ付属の受け入れフィクスチャ
 * (`core/tests/test_templates.py` が消費) である。あそこの `reachMin 0.4 /
 * reachMax 0.95` は「画面に描かれている腕」ではなく、ソルバを特定の包絡で試す
 * ための**意図的に別の腕**なので、統一の対象にしない。*しないこと*を宣言して
 * 数える — 宣言の無い不一致は「誰も考えなかった不一致」と区別がつかない。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT, readFileSync } from './census/sources.js'
import {
  ROBOT_MODELS, SHIPPED_ROBOT_MODEL_ID, robotModelById,
} from './domain/robotModel.js'

/** 統一の対象にしないもの、と理由。 */
const DECLARED_EXCLUSIONS = Object.freeze({
  'templates/': 'backend acceptance fixtures — deliberately a different envelope (CLAUDE.md: examples とは別物)',
})

const MM_PER_M = 1000

/** `examples/*.json` が語っている reach 宣言を全部拾う。 */
function declaredReaches() {
  const dir = join(REPO_ROOT, 'examples')
  const out = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue
    const doc = JSON.parse(readFileSync(join(dir, name), 'utf8'))
    for (const fact of doc.given ?? []) {
      const reach = fact?.attrs?.reach
      if (!reach || typeof reach.value !== 'number') continue
      out.push({ file: `examples/${name}`, ref: fact.ref, ...reach })
    }
  }
  return out
}

test('母集団が空でない — 走査が壊れたら「不一致 0 件」ではなく落ちる', () => {
  // 空の母集団は「全件一致」と区別できない (ADR-115)。
  const found = declaredReaches()
  assert.ok(found.length >= 2,
    `examples から reach 宣言を ${found.length} 件しか拾えなかった — 走査が壊れている`)
})

test('サンプルシーンが語る腕は、Add が挿す腕と同じ 1 台である', () => {
  const shipped = robotModelById(SHIPPED_ROBOT_MODEL_ID)
  const expectedMM = shipped.reach.reachMax * MM_PER_M

  const disagreeing = []
  for (const decl of declaredReaches()) {
    // 単位は宣言されている (mm / m)。既定で埋めない — 単位の無い数は比較できない。
    const mm = decl.unit === 'mm' ? decl.value
      : decl.unit === 'm' ? decl.value * MM_PER_M
      : null
    if (mm === null) {
      disagreeing.push(`${decl.file} :: ${decl.ref} — reach に単位が宣言されていない (${decl.unit})`)
      continue
    }
    if (Math.abs(mm - expectedMM) > 1) {
      disagreeing.push(
        `${decl.file} :: ${decl.ref} — ${mm} mm は出荷している ${shipped.label} の ` +
        `${expectedMM} mm ではない`)
    }
  }

  assert.deepEqual(disagreeing, [],
    '画面に描かれる腕と、文書が語る腕が違う:\n' + disagreeing.join('\n'))
})

test('統一しないものは宣言されている（沈黙ではない）', () => {
  // 除外が 0 件になったらこの行を消す。*在る* ことではなく *宣言されている* ことを問う。
  assert.ok(Object.keys(DECLARED_EXCLUSIONS).length > 0)
  for (const [path, reason] of Object.entries(DECLARED_EXCLUSIONS)) {
    assert.ok(reason.length > 20, `${path} の除外に理由が書かれていない`)
  }
})

test('出荷モデルの基数は 1 — 2 台目が来たら「どの腕か」は実体の属性になる', () => {
  // ADR-141 は `SHIPPED_ROBOT_MODEL_ID` を定数にしている。それが正当なのは
  // 出荷モデルがちょうど 1 つだからで、2 つ目が入った瞬間にこの検査が落ちて
  // 「ロボット実体ごとに model を持たせる」判断を強制する。基数が 1 から N へ
  // 動くことは状態であり、状態に見えない (原則 #31)。
  assert.equal(Object.keys(ROBOT_MODELS).length, 1,
    '出荷モデルが複数になった — model はロースタではなくロボット実体の属性に移すこと')
})
