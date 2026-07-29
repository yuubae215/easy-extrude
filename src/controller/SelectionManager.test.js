/**
 * SelectionManager.test.js — 選択の唯一の入口 (ADR-099) と文脈可視性 (ADR-096)。
 *
 * ここで問うのは 4 つ。
 *
 * 1. **根の張り方** (この file が生まれた ADR-084/085 の回帰): CF の木は
 *    geometry Solid に根を持つ場合 (ADR-037) と、親のない root CF に根を持つ
 *    場合 (ロボット TF 木 robot_base → tcp) の両方がある。旧実装は前者を仮定して
 *    親なし root で打ち切っていたので、ロボットを選んでも何も出なかった。
 *
 * 2. **この manager が所有するもの** (ADR-096): `contextual` **軸**だけを書く。
 *    よって assert は `SceneService.setContextualFrames()` へ渡す map に対して
 *    行い、mesh view の状態は見ない。合成そのものは `VisibilityAxes.test.js` の
 *    担当で、症状 4 のテストだけが本物の `composeVisibility` で両端を繋ぐ。
 *
 * 3. **窓が部分集合を書けないこと** (ADR-099 §2 — この ADR の本体)。欠陥は
 *    「選択とは何か」が窓ごとの手続きだったことなので、テストも 1 つの verb を
 *    呼んだ後に **3 つの書き込み先 (ハイライト / リンク強調 / パネル) が
 *    選択集合と一致している**ことを問う。1 つでもずれたら、それが次の症状になる。
 *
 * 4. **基数 0·1·N** (原則 #31)。0 個の選択は正当な状態であり、N 個は 1 個の
 *    繰り返しではない — 文脈の主張は**和**であって最後の 1 個ではない
 *    (旧実装は per-entity に丸ごと置換していたので、5 個選ぶと最後の 1 個の
 *    フレームしか出なかった)。
 *
 * Run with:  node --test src/controller/SelectionManager.test.js
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { SelectionManager } from './SelectionManager.js'
import { CoordinateFrame } from '../domain/CoordinateFrame.js'
import {
  CONTEXTUAL, VISIBILITY_KIND, composeVisibility, defaultExplicit,
} from '../view/VisibilityAxes.js'

/** Records what a mesh view was told, so a "subset write" is visible. */
function makeMeshView() {
  return {
    selected: false,
    ghost: false,
    setObjectSelected(v) { this.selected = v },
    showParentAxesGhost() { this.ghost = true },
    hideParentAxesGhost() { this.ghost = false },
  }
}

/** Minimal CoordinateFrame stub: real prototype (for instanceof). */
function makeFrame(id, parentId) {
  const f = Object.create(CoordinateFrame.prototype)
  return Object.assign(f, { id, parentId, meshView: makeMeshView() })
}

/** A plain (non-CoordinateFrame) geometry object stub. */
function makeSolid(id) {
  return { id, parentId: null, meshView: makeMeshView() }
}

/** Fake scene backed by a Map; children resolved by parentId scan. */
function makeScene(objs) {
  const byId = new Map(objs.map(o => [o.id, o]))
  return {
    activeId: null,
    selectionMode: 'object',
    objects: byId,
    getObject: id => byId.get(id) ?? null,
    getChildren: pid => objs.filter(o => o.parentId === pid),
    isLinkEndpoint: () => false,
  }
}

/**
 * Stands in for AppController. Records the three places a selection is written
 * to, so the test can ask that they agree — the defect ADR-099 removes is
 * precisely that they could not.
 */
function makeCtrl(objs) {
  const contextual = new Map()
  const ctrl = {
    _scene: makeScene(objs),
    linkHighlight: new Set(),
    panelSelection: new Set(),
    modeCalls: [],
    pulses: 0,
    _service: {
      setContextualFrames(frames) {
        contextual.clear()
        for (const [id, mode] of frames) contextual.set(id, mode)
      },
      setActiveObject(id) { ctrl._scene.activeId = id },
      updateLinkSelectionHighlight(ids) { ctrl.linkHighlight = new Set(ids) },
    },
    _linkNetworkView: { setSelection(ids) { ctrl.panelSelection = new Set(ids) } },
    _motion: { spawn() { ctrl.pulses++; return null } },
    _sceneView: { scene: {} },
    setMode(mode) { ctrl.modeCalls.push(mode); ctrl._scene.selectionMode = mode },
    _geometryAncestorCentroid: () => null,
    _refreshObjectModeStatus() {},
    _updateNPanel() {},
    _updateMobileToolbar() {},
    _syncContextProvenance() {},
    contextual,
  }
  return ctrl
}

/** The invariant ADR-099 §2 exists to make true: every window writes all of it. */
function assertNoSubsetWritten(mgr, ctrl, msg) {
  const ids = [...mgr.ids].sort()
  assert.deepEqual([...ctrl.linkHighlight].sort(), ids, `${msg}: リンク強調が選択集合とずれている`)
  assert.deepEqual([...ctrl.panelSelection].sort(), ids, `${msg}: パネルが選択集合とずれている`)
  const highlighted = [...ctrl._scene.objects.values()]
    .filter(o => o.meshView.selected).map(o => o.id).sort()
  assert.deepEqual(highlighted, ids, `${msg}: 可視ハイライトが選択集合とずれている`)
  assert.equal(mgr.count > 0, ids.length > 0, `${msg}: 基数と集合が食い違っている`)
}

// ── 1. Rooting ───────────────────────────────────────────────────────────────

test('geometry-rooted tree: selecting a child frame claims the whole tree', () => {
  const ctrl = makeCtrl([makeSolid('solid'), makeFrame('origin', 'solid'), makeFrame('child', 'origin')])
  const mgr = new SelectionManager(ctrl)

  mgr.selectOnly('child')

  assert.deepEqual([...ctrl.contextual.keys()].sort(), ['child', 'origin'])
  assert.equal(ctrl.contextual.get('child'),  CONTEXTUAL.FULL,   '選択された当人はフル')
  assert.equal(ctrl.contextual.get('origin'), CONTEXTUAL.DIMMED, '同じ木の他フレームは薄字')
})

test('robot tree: selecting robot_base (world-parented root) claims the whole TF tree', () => {
  const ctrl = makeCtrl([makeFrame('base', null), makeFrame('tcp', 'base')])
  const mgr = new SelectionManager(ctrl)

  mgr.selectOnly('base')

  assert.equal(ctrl.contextual.get('base'), CONTEXTUAL.FULL, '根フレーム自身がタップの手応え')
  assert.equal(ctrl.contextual.get('tcp'),  CONTEXTUAL.DIMMED)
})

test('robot tree: selecting a user frame added under robot_base claims it', () => {
  const ctrl = makeCtrl([makeFrame('base', null), makeFrame('tcp', 'base'), makeFrame('user', 'base')])
  const mgr = new SelectionManager(ctrl)

  mgr.selectOnly('user')

  assert.equal(ctrl.contextual.get('user'), CONTEXTUAL.FULL,
    '親のない根で打ち切ると、ロボットに足したフレームが選んでも出ない (ADR-084/085 の回帰)')
  assert.equal(ctrl.contextual.get('base'), CONTEXTUAL.DIMMED)
  assert.equal(ctrl.contextual.get('tcp'),  CONTEXTUAL.DIMMED)
})

test('a geometry selection claims its whole frame tree — 当人 FULL・連鎖 DIMMED', () => {
  const ctrl = makeCtrl([makeSolid('solid'), makeFrame('origin', 'solid'), makeFrame('child', 'origin')])
  const mgr = new SelectionManager(ctrl)

  mgr.selectOnly('solid')

  // 到達 (どの id が現れるか) は ADR-087 のまま — 狭めたのは強度だけ。
  assert.deepEqual([...ctrl.contextual.keys()].sort(), ['child', 'origin', 'solid'])
  assert.equal(ctrl.contextual.get('solid'),  CONTEXTUAL.FULL,
    '選ばれた当人がフル — Solid の手応えは自身のメッシュであってフレームではない')
  assert.equal(ctrl.contextual.get('origin'), CONTEXTUAL.DIMMED, '連鎖は薄字')
  assert.equal(ctrl.contextual.get('child'),  CONTEXTUAL.DIMMED, '連鎖は薄字')
})

// ── 2. The claim is replaced wholesale ───────────────────────────────────────

test('releasing the claim replaces the whole map — no stale ids survive', () => {
  const ctrl = makeCtrl([makeFrame('base', null), makeFrame('tcp', 'base')])
  const mgr = new SelectionManager(ctrl)

  mgr.selectOnly('tcp')
  assert.equal(ctrl.contextual.size, 2)
  mgr.clearSelection()
  assert.equal(ctrl.contextual.size, 0,
    '主張は丸ごと置き換わる — 個別の取り消しを積み上げないので「1 つ消し忘れた」が書けない')
})

test('switching selection replaces the claim rather than accumulating it', () => {
  const ctrl = makeCtrl([
    makeSolid('solid'), makeFrame('origin', 'solid'), makeFrame('base', null), makeFrame('tcp', 'base'),
  ])
  const mgr = new SelectionManager(ctrl)

  mgr.selectOnly('solid')
  mgr.selectOnly('tcp')

  assert.deepEqual([...ctrl.contextual.keys()].sort(), ['base', 'tcp'],
    '前の選択の主張が残ると、選択を変えるたび画面に軸が溜まる')
})

// ── 症状 4: the eye survives a selection change ──────────────────────────────

test('明示表示した CF は選択が別実体へ移っても描かれ続ける (症状 4 — 合成まで通す)', () => {
  const ctrl = makeCtrl([makeSolid('solid'), makeFrame('origin', 'solid'), makeFrame('base', null)])
  const mgr = new SelectionManager(ctrl)

  assert.equal(defaultExplicit(VISIBILITY_KIND.COORDINATE_FRAME), false,
    '既定は伏せる — 開いているのはユーザーがそう言ったからである')

  // 別の実体 (Solid) を選択 → 文脈軸は base を主張しない。
  mgr.selectOnly('solid')
  assert.equal(ctrl.contextual.has('base'), false)

  const composed = composeVisibility({
    explicit:   true,                                  // ユーザーが base の eye を開いた
    contextual: ctrl.contextual.get('base') ?? null,
  })
  assert.deepEqual(composed, { visible: true, dimmed: false },
    '文脈が手放しても explicit が支える — 旧 hideFrameChain は eye を読まずに消していた')
})

test('文脈だけで出ているフレームは、文脈が消えれば消える (対称性)', () => {
  const ctrl = makeCtrl([makeSolid('solid'), makeFrame('origin', 'solid')])
  const mgr = new SelectionManager(ctrl)
  const explicit = defaultExplicit(VISIBILITY_KIND.COORDINATE_FRAME)

  mgr.selectOnly('solid')
  assert.equal(
    composeVisibility({ explicit, contextual: ctrl.contextual.get('origin') ?? null }).visible,
    true)

  mgr.clearSelection()
  assert.equal(
    composeVisibility({ explicit, contextual: ctrl.contextual.get('origin') ?? null }).visible,
    false)
})

// ── ADR-099 G2: 選択は沈黙できない ───────────────────────────────────────────

test('eye を閉じた実体を選ぶと、選択中だけ現れる (G2 — 原則 #11)', () => {
  // 力学 3: 選択の主張の宛先が「frame chain」だけだと、explicit で消してある
  // 当人は誰も見せろと言わない。当人を FULL で主張するのが本 ADR の決定。
  const ctrl = makeCtrl([makeFrame('base', null), makeFrame('tcp', 'base')])
  const mgr = new SelectionManager(ctrl)
  const explicit = false            // ユーザーが eye を閉じた / 既定で伏せてある

  const silent = composeVisibility({ explicit, contextual: ctrl.contextual.get('tcp') ?? null })
  assert.equal(silent.visible, false, '前提: 選択前は描かれていない')

  mgr.selectOnly('tcp')
  assert.equal(
    composeVisibility({ explicit, contextual: ctrl.contextual.get('tcp') ?? null }).visible,
    true, '選べたのに画面が沈黙する = 入力を消費して何も起きない (原則 #11)')

  mgr.clearSelection()
  assert.equal(
    composeVisibility({ explicit, contextual: ctrl.contextual.get('tcp') ?? null }).visible,
    false, '選択を外せば eye の宣言どおりに戻る — 選択は explicit 軸を書き換えない')
})

test('geometry も同じ — 伏せた Solid をパネルから選べば見える', () => {
  const ctrl = makeCtrl([makeSolid('solid')])
  const mgr = new SelectionManager(ctrl)

  mgr.selectOnly('solid')
  assert.equal(ctrl.contextual.get('solid'), CONTEXTUAL.FULL,
    '主張の宛先を CF に限ると、実体の種によって「選択が見えるか」が変わる')
})

// ── ADR-099 §2: 窓は部分集合を書けない ───────────────────────────────────────

test('どの verb を通っても 3 つの書き込み先が選択集合と一致する', () => {
  const ctrl = makeCtrl([makeSolid('a'), makeSolid('b'), makeSolid('c'), makeFrame('fa', 'a')])
  const mgr = new SelectionManager(ctrl)

  mgr.selectOnly('a');                                assertNoSubsetWritten(mgr, ctrl, 'selectOnly')
  mgr.selectMany(['a', 'b', 'c'], { activeId: 'b' }); assertNoSubsetWritten(mgr, ctrl, 'selectMany')
  mgr.activateWithinSelection('c');                   assertNoSubsetWritten(mgr, ctrl, 'activateWithinSelection')
  mgr.forget('c');                                    assertNoSubsetWritten(mgr, ctrl, 'forget')
  mgr.selectOnly('fa');                               assertNoSubsetWritten(mgr, ctrl, 'selectOnly(CF)')
  mgr.clearSelection();                               assertNoSubsetWritten(mgr, ctrl, 'clearSelection')
})

test('選択入口は mode を正規化する — 全窓に効く (旧: Outliner だけが持っていた)', () => {
  const ctrl = makeCtrl([makeSolid('a'), makeSolid('b')])
  const mgr = new SelectionManager(ctrl)
  ctrl._scene.selectionMode = 'edit'

  mgr.selectOnly('b')

  assert.deepEqual(ctrl.modeCalls, ['object'],
    'edit → object の正規化が入口にないと、窓ごとに mode の扱いが違う')
})

test('既に選択済みの実体を掴んでも多重選択が 1 個へ潰れない', () => {
  const ctrl = makeCtrl([makeSolid('a'), makeSolid('b')])
  const mgr = new SelectionManager(ctrl)

  mgr.selectMany(['a', 'b'], { activeId: 'a' })
  mgr.activateWithinSelection('b')

  assert.deepEqual([...mgr.ids].sort(), ['a', 'b'])
  assert.equal(ctrl._scene.activeId, 'b')
})

// ── ADR-099 §基数 0·1·N (原則 #31) ───────────────────────────────────────────

test('基数 0 は正当な状態で、そのとき主張も強調も空 (0 は状態に見えない)', () => {
  const ctrl = makeCtrl([makeSolid('a'), makeFrame('fa', 'a')])
  const mgr = new SelectionManager(ctrl)

  assert.equal(mgr.count, 0, '起動直後は 0 個 — 「選択されていない」は不在ではなく状態')
  mgr.selectOnly('a')
  assert.equal(mgr.count, 1)
  mgr.clearSelection()

  assert.equal(mgr.count, 0)
  assert.equal(ctrl.contextual.size, 0)
  assert.equal(ctrl.linkHighlight.size, 0)
  assert.equal(ctrl._scene.activeId, 'a', '0 個でも active は残る — N パネルは在る対象を語り続ける')
})

test('基数 N の文脈主張は「和」であって「最後の 1 個」ではない', () => {
  // 旧実装は選択メンバーごとに丸ごと置換していたので、N 個選んでも最後の 1 個の
  // フレームしか出なかった。1 と N は別世界 (原則 #31 / ADR-093 と同じ構図)。
  const ctrl = makeCtrl([
    makeSolid('a'), makeFrame('fa', 'a'),
    makeSolid('b'), makeFrame('fb', 'b'),
    makeSolid('c'), makeFrame('fc', 'c'),
  ])
  const mgr = new SelectionManager(ctrl)

  mgr.selectMany(['a', 'b', 'c'], { activeId: 'a' })

  assert.deepEqual([...ctrl.contextual.keys()].sort(), ['a', 'b', 'c', 'fa', 'fb', 'fc'],
    'N 個選んだのに 1 個ぶんの文脈しか出ないのは、和ではなく置換を書いた形')
})

test('FULL は DIMMED に勝つ — 2 つの選択が同じフレームについて食い違うとき', () => {
  // tcp を直接選び、同じ木の base も選ぶ: base 視点では tcp は DIMMED だが、
  // tcp 自身は FULL を主張している。強い方を採らないと、選んだ当人が薄くなる。
  const ctrl = makeCtrl([makeFrame('base', null), makeFrame('tcp', 'base')])
  const mgr = new SelectionManager(ctrl)

  mgr.selectMany(['base', 'tcp'], { activeId: 'base' })

  assert.equal(ctrl.contextual.get('tcp'),  CONTEXTUAL.FULL)
  assert.equal(ctrl.contextual.get('base'), CONTEXTUAL.FULL)
})

// ── 基数 N と強度: reveal-on-select は N で溢れない ──────────────────────────
//
// ADR-099 の assumption `RevealOnSelectMayFloodTheView` の回収 (2026-07-29 実測)。
// 「N が大きいと大量の軸が一度に現れる」は量の問題として起票されたが、測ると
// 量 (到達する id の数) ではなく**強度**の問題だった: geometry 分岐だけが連鎖を
// FULL で主張していたので、Solid を 50 個矩形選択すると 200 個が全部フル強度に
// なっていた (CF 分岐は最初から連鎖 DIMMED)。強度規則を両分岐で 1 つにした結果が
// 下の不変条件で、これは N を振って初めて見える (1 個では両者が区別できない)。

/** FULL で主張されている id の集合。 */
const fullIds = (ctrl) => [...ctrl.contextual.entries()]
  .filter(([, m]) => m === CONTEXTUAL.FULL).map(([id]) => id).sort()

test('フル強度で現れるのは選択集合ちょうど — 連鎖は何個あっても DIMMED', () => {
  // 1 本の木を深くする: 連鎖の長さが FULL の個数に効いてはならない。
  const objs = [makeSolid('s'), makeFrame('f0', 's')]
  for (let i = 1; i < 12; i++) objs.push(makeFrame(`f${i}`, `f${i - 1}`))
  const ctrl = makeCtrl(objs)
  const mgr = new SelectionManager(ctrl)

  mgr.selectOnly('s')

  assert.equal(ctrl.contextual.size, 13, '到達は木の全体 — ADR-087 の振る舞いは変えない')
  assert.deepEqual(fullIds(ctrl), ['s'],
    'フルは選んだ 1 個だけ。連鎖を FULL で主張すると、木が深いほど画面が強く光る')
})

test('基数 N を振っても FULL の個数は選択基数のまま (溢れの上界)', () => {
  // 形は矩形選択 = 各 Solid が 3 フレームを持つ N 個の実体。旧実装ではここで
  // FULL が 4N まで伸びていた (N=25 で 100)。
  const N = 25
  const objs = []
  for (let i = 0; i < N; i++) {
    objs.push(makeSolid(`s${i}`))
    objs.push(makeFrame(`s${i}_origin`, `s${i}`))
    objs.push(makeFrame(`s${i}_tip`, `s${i}_origin`))
  }
  const ctrl = makeCtrl(objs)
  const mgr = new SelectionManager(ctrl)
  const ids = objs.filter(o => o.id.startsWith('s') && !o.id.includes('_')).map(o => o.id)

  mgr.selectMany(ids, { activeId: ids[0] })

  assert.equal(mgr.count, N)
  assert.equal(ctrl.contextual.size, 3 * N, '到達は 3N (各実体 + その 2 フレーム)')
  assert.equal(fullIds(ctrl).length, N,
    'FULL は選択の基数で抑えられる — これが「N で溢れない」の意味であって、' +
    '主張をやめること (G2 の放棄) ではない')
  assert.deepEqual(fullIds(ctrl), [...mgr.ids].sort(), 'FULL = 選択集合、ちょうど')
})

test('強度規則は分岐に依存しない — CF を選んでも Solid を選んでも同じ形', () => {
  // 同じ木を 2 通りに選ぶ。当人が誰であれ「当人 FULL・残り DIMMED」が答え。
  const objs = () => [makeSolid('s'), makeFrame('origin', 's'), makeFrame('tip', 'origin')]

  const viaSolid = makeCtrl(objs())
  new SelectionManager(viaSolid).selectOnly('s')

  const viaFrame = makeCtrl(objs())
  new SelectionManager(viaFrame).selectOnly('tip')

  // 到達は同じ木。違うのは誰がフルかだけ — 分岐ごとに別の規則を持たない。
  assert.deepEqual([...viaSolid.contextual.keys()].sort(), ['origin', 's', 'tip'])
  assert.deepEqual(fullIds(viaSolid), ['s'])
  assert.deepEqual(fullIds(viaFrame), ['tip'])
})

// ── Handing the axis back (link creation borrows it) ─────────────────────────

test('refreshFrameContext recomputes the claim from the current selection', () => {
  const ctrl = makeCtrl([makeSolid('solid'), makeFrame('origin', 'solid')])
  const mgr = new SelectionManager(ctrl)
  mgr.selectOnly('solid')

  // Link mode borrowed the axis and claimed every frame…
  ctrl._service.setContextualFrames([['origin', CONTEXTUAL.FULL], ['other', CONTEXTUAL.FULL]])
  // …then hands it back.
  mgr.refreshFrameContext()

  assert.deepEqual([...ctrl.contextual.keys()].sort(), ['origin', 'solid'],
    '返却は所有者の再計算であって、呼び出し側での再実装ではない')
})

test('refreshFrameContext with nothing selected releases the claim', () => {
  const ctrl = makeCtrl([makeSolid('solid')])
  const mgr = new SelectionManager(ctrl)

  ctrl._service.setContextualFrames([['solid', CONTEXTUAL.FULL]])
  mgr.refreshFrameContext()

  assert.equal(ctrl.contextual.size, 0)
})

// ── 選択の演出 (ADR-068 / #30) ────────────────────────────────────────────────

test('選択パルスは選択へ入る遷移でだけ鳴る (再選択churn では鳴らない)', () => {
  const solid = makeSolid('a')
  solid.corners = Array.from({ length: 8 }, () => ({ x: 0, y: 0, z: 0 }))
  const ctrl = makeCtrl([solid, makeSolid('b')])
  const mgr = new SelectionManager(ctrl)
  // Solid の instanceof を通さないと発火しないので、この stub では 0 のまま —
  // 問うているのは「復帰 (fx:false) が決して鳴らさない」側。
  mgr.selectOnly('a', { fx: false })
  mgr.selectOnly('a', { fx: false })
  assert.equal(ctrl.pulses, 0, '復帰は「いま選ばれた」ではないので鳴らしてはいけない')
})
