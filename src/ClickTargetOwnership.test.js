/**
 * ClickTargetOwnership.test.js — 「クリックの優先順位を決める場所を数えて、
 * 所有者の外にある個数が 0 であること」を機械に問わせる (ADR-140 / 原則 #31 / 原則 #1)
 *
 * ## 数えるべきは *在る経路* ではなく *規則を持つ経路の外* である
 *
 * ADR-140 が閉じた欠陥は、規則が 3 箇所に**写しで**書かれていたことだった
 * (`_onPointerDown` · `contextmenu` · `_onDblClick`)。3 つは既にドリフトしており、
 * double-click の写しは CF-descendant 例外も annotation フォールバックも持って
 * いなかった。**どの写しも単体では正しく読める**ので、実装を読んでも見えない —
 * 見えるのは「同じ問いに答える場所が何個あるか」を数えたときだけである
 * (ADR-097 / ADR-099 と同じ構図)。
 *
 * ## 母集団は手で並べない (ADR-102)
 *
 * 数える対象の名前 (`hitAnyObject` / `hitAnyCoordinateFrame` / `hitRobotStage` /
 * `hitAnyAnnotation`) は**手で並べない** — `HitTestService` の `hit*` メソッド
 * 定義から構文で導出する。5 つ目のヒットテストが足された日に、表へ足すのを
 * 忘れても母集団に入る。人の記憶が母集団の権威でなくなることが要点。
 *
 * ## 何を違反とみなすか
 *
 * 1 本のヒットテストを呼ぶこと自体は違反ではない (hover が body を温める・
 * リンク先を拾う、など「優先順位を決めていない」用途がある)。違反は
 * **同じ関数本体で 2 本以上を突き合わせること** — それが手書きの優先順位の署名で
 * あり、ADR-140 以前の 3 箇所はすべてこの形をしていた。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  REPO_ROOT, repoPath, relPath,
  collectSources, stripComments, methodsOf, readFileSync,
} from './census/sources.js'

/** 決定の唯一の所有者。ここだけが 2 本以上を突き合わせてよい。 */
const OWNER = 'src/controller/HitTestService.js'

/** 純粋な決定そのもの (所有者が委譲する先)。 */
const RULE = 'src/domain/clickTarget.js'

/**
 * 所有者の中で、複数のヒットテストを突き合わせることが宣言されたメソッド。
 *
 * `resolveClickTarget` — ADR-140 の唯一の決定点。
 * `hitAnyEntityForLink` — リンク先選び。**別の問い**である (source を除外した
 *   うえでの「繋ぐ相手」であって「クリックが何を意味したか」ではない) ので
 *   統合しない。統合しないことを**宣言**して数える — 宣言の無い 2 本目は
 *   「誰も考えなかった 2 本目」と区別がつかない (原則 #31)。
 */
const DECLARED_MULTI_HIT_METHODS = Object.freeze(['resolveClickTarget', 'hitAnyEntityForLink'])

/**
 * 母集団: **`resolveClickTarget` が実際に突き合わせているヒットテスト** の名前を、
 * その本体から構文で導出する。
 *
 * 「`HitTestService` の `hit*` を全部」ではない — `hitFace` / `hitActiveSolid` は
 * *候補を出す* 問いではなく、数えると無関係な正当形を巻き込む (初版はこれで
 * `_onPointerDown` を誤検知した)。5 つ目の候補が決定点に足された日には、この表に
 * 足すのを忘れても母集団に入る。
 */
function hitTestNames() {
  const lines = stripComments(readFileSync(repoPath(OWNER), 'utf8'))
  const start = lines.findIndex(l => /^ {2}resolveClickTarget\s*\(/.test(l))
  assert.notEqual(start, -1, `${OWNER} に resolveClickTarget が無い`)
  let end = start + 1
  while (end < lines.length && lines[end].trimEnd() !== '  }') end++
  const body = lines.slice(start, end).join('\n')
  return [...new Set([...body.matchAll(/this\.(hit[A-Za-z0-9_$]*)\s*\(/g)].map(m => m[1]))]
}

test('母集団が空でない — 導出が壊れたら「違反 0 件」ではなく落ちる', () => {
  // 空の母集団は「全件 OK」と区別できない。境界を決定できないこと自体を fail に
  // する (ADR-115 と同じ形)。
  const names = hitTestNames()
  assert.ok(names.length >= 4,
    `HitTestService から hit* メソッドを ${names.length} 本しか導出できなかった`)
  for (const expected of ['hitAnyObject', 'hitAnyCoordinateFrame', 'hitRobotStage', 'hitAnyAnnotation']) {
    assert.ok(names.includes(expected), `${expected} が母集団に入っていない`)
  }
})

test('所有者の外に、優先順位を決めている場所は 0 個', () => {
  const names = hitTestNames()
  const offenders = []

  for (const abs of collectSources()) {
    const rel = relPath(abs)
    if (rel === OWNER || rel === RULE) continue
    const source = readFileSync(abs, 'utf8')
    if (!names.some(n => source.includes(`${n}(`))) continue

    for (const [method, { body }] of methodsOf(source)) {
      const text = body.join('\n')
      const used = names.filter(n => new RegExp(`\\.${n}\\s*\\(`).test(text))
      if (used.length >= 2) offenders.push(`${rel} :: ${method}() — ${used.join(' + ')}`)
    }
  }

  assert.deepEqual(offenders, [],
    '手書きの優先順位が所有者の外にある。HitTestService.resolveClickTarget() を呼ぶこと:\n' +
    offenders.join('\n'))
})

test('所有者の中でも、突き合わせるメソッドは宣言されたものだけ', () => {
  const names = hitTestNames()
  const source = readFileSync(repoPath(OWNER), 'utf8')
  const found = []

  for (const [method, { body }] of methodsOf(source)) {
    const text = body.join('\n')
    const used = names.filter(n => n !== method && new RegExp(`this\\.${n}\\s*\\(`).test(text))
    if (used.length >= 2) found.push(method)
  }

  assert.deepEqual(found.sort(), [...DECLARED_MULTI_HIT_METHODS].sort(),
    '宣言されていない突き合わせが所有者の中にある (または宣言が実在しない)')
})

test('退役した形が戻っていない — 退役の腐敗は違反を見逃すのではなく緑を出す', () => {
  // ADR-103: `DS_PENDING` が廃止後も 3 リリース enum に残ったように、消したはずの
  // 形は「もう無いから検査しない」と決めた瞬間から静かに復活できる。
  const appController = stripComments(
    readFileSync(repoPath('src/controller/AppController.js'), 'utf8')).join('\n')

  // `robot-last-resort`: ロボットを「他に何も当たらなかったとき」だけ見る形。
  assert.doesNotMatch(appController, /if\s*\(\s*!\s*result\s*\)[\s\S]{0,80}hitRobotStage/,
    'ロボットが最後の手段に戻っている (ADR-140 が消した形)')

  // `per-handler-chain`: ハンドラの中で CF と Solid を手で突き合わせる形。
  assert.doesNotMatch(appController, /isCfDescendantOf\s*\([\s\S]{0,120}hitAnyObject/,
    'ハンドラ内に手書きの CF/Solid 突き合わせが戻っている')
})

test('クリックで選択する 3 つのジェスチャが、同じ 1 つの入口を通る', () => {
  // 「入口を数える」のではなく「**通っていない**ジェスチャを数える」— 通っている
  // ものを辿る読み方では、次に足されるジェスチャは定義上出てこない。
  const lines = stripComments(
    readFileSync(repoPath('src/controller/AppController.js'), 'utf8'))
  const text = lines.join('\n')
  const calls = [...text.matchAll(/resolveClickTarget\s*\(/g)].length
  assert.ok(calls >= 4,
    `resolveClickTarget の呼び出しが ${calls} 箇所しかない ` +
    '(pointerdown / contextmenu / dblclick / hover の 4 つが通るはず)')
})

test('repo ルートが解決できている（検査そのものの前提）', () => {
  assert.ok(REPO_ROOT.length > 0)
})
