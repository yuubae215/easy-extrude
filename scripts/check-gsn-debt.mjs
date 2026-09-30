#!/usr/bin/env node
/**
 * check-gsn-debt.mjs — GSN の**宣言された未支持**に母集団・満期・個数を与える (ADR-126)
 *
 * ## なぜ必要か
 *
 * 出発点はユーザーの提案である —「残しとかって GSN の要素として書いておいたら忘れずに
 * 管理されないですか? 散文にすると忘れるんですよね? GSN の構造の一部にしといて、
 * GSN 自体も hook にすれば良いのでは?」
 *
 * **半分は既にそうなっていた。** `docs/gsn/*.gsn` には `support-exploring` /
 * `support-unexplored` の goal が **30 個**あり、しかも中身が残しそのものだった:
 *
 * ```
 * goal AbsentCentreOfMassNeverBecomesTheCentroid
 * labels support-exploring
 *     assumption KeyAbsenceTestWillSettleIt
 *     summary "未着手。決着させる検査は、重心なしのリクエストで com_offset の鍵が出ないこと。…"
 * ```
 *
 * 残しと満期条件が、散文ではなく**型のあるノード**として書かれている。ADR-123 / ADR-124 で
 * 苦しんだ語彙・記法の問題がここには最初から無い。
 *
 * ## しかし hook は半分しか出来ていなかった
 *
 * `gsn_tool.py` の `check_goal_support` は支えが 0 で**未宣言**なら error にするが、
 * **宣言済み (`support-exploring` + 検査を名指しした assumption) なら永久に緑**である。
 * `check_artifacts` も、存在しない artifact パスを hard error にするのは `solution` の
 * 下だけで、`assumption` の下は意図的に warning (「planned but not yet written は正当」)。
 *
 * つまり **「宣言された未支持」に満期が無い**。名指しした検査が実在するようになっても
 * 何も落ちない — **ADR-109 力学 1 (満期が無言で過ぎる) が GSN レーンでそのまま
 * 再生産されている**。しかも 30 個ある。個数を数える ratchet も無く、`report` モードの
 * 集計は `pnpm test:gsn` が走らせないので**印字ですらない** (ADR-115)。
 *
 * ## 4 つの問い
 *
 *   G1 POPULATION — 木を持つべき ADR が木を持っている。**ADR-126 以降は必須**
 *                   (遡及しない — `Retires:` を ADR-125 以降に切ったのと同じ判断)。
 *                   cutoff 前の欠落は `DECLARED_TREELESS` に理由つきで宣言する。
 *   G2 DEBT       — 宣言された未支持 goal の個数を ratchet で縛る。**超えても下回っても**
 *                   fail。「宣言された未支持」に欄が無ければ、30 が 60 になっても
 *                   誰も気づかない (原則 #31 — 正当な非ゼロは 0 に見えない)。
 *   G3 REACH      — 満期 trigger を持たない未支持 goal の個数を ratchet で縛る。
 *                   Q5 と同じ形 — 「満期を書く欄が在る」ことと「その欄を読む機械が
 *                   在る」ことは別の事実である (ADR-109 D6)。
 *   G4 EXPIRY     — 満期の来た未支持 goal が 0 件。名指しした検査が実在するように
 *                   なったら落ちる = 「exploring を solution へ昇格させよ」。
 *   G5 ATTRIBUTION — ADR の木はすべて、事業木 `profit-growth.gsn` の solution から
 *                   **ちょうど 1 回**吊られている (ADR-153)。0 回 = 事業的な goal が
 *                   無いまま実行された投資、2 回以上 = 寄与の二重計上。どちらも
 *                   ROI_i = ΔΠ_i / I_i の分子を出せなくする。木の側に書いた
 *                   「接続は保留」は数えない — 2026-09-26 に 57 本中 52 本がその形で
 *                   吊られておらず、どの検査も緑だった (原則 #31: 数えるのは在る接続
 *                   ではなく**吊られていない木の個数**。母集団は docs/gsn の構文から導く)。
 *   G6 CATEGORY   — 吊り先が妥当か、を**独立した 2 つの申告の一致**として問う (ADR-153 D5)。
 *                   木の top goal は自分が動かす項 `term-*` と変更の種類 `change-*` を
 *                   1 つずつ名乗り、事業木の goal は自分の項 `term-*` と受け入れる変更の
 *                   種類 `admits-*` を名乗る。吊った場所の項 (祖先で最も近い term-) と
 *                   木の項が一致し、木の変更の種類が吊った場所の admits- に含まれること。
 *                   語彙は事業木から導く — 事業木に無い項・種類を木が名乗ったら throw 相当
 *                   (原則 #31: 未宣言の種を既定で通さない)。**限界:** 2 つの申告を同じ人が
 *                   同時に書けば一致させられる。問えるのは「吊った場所」と「何を変えたか」が
 *                   食い違う形 — 2026-09-27 にカテゴリを当てた段階で 102 / 105 の 2 本が見つかった
 *                   (予定先どおりに吊ると、どちらも項と種類の両方で落ちる)。
 *
 * ## 満期の書き方
 *
 * exploring goal の子 `assumption` の `summary` に、登録簿と**同じ語彙**で書く:
 *
 *     assumption KeyAbsenceTestWillSettleIt
 *     summary "未着手。決着させる検査は … 満期=GREP:core/tests/test_engine.py::com_offset"
 *
 * 文法と評価器は `scripts/expiry-trigger.mjs` ただ 1 箇所 (§1.1)。ここに書き写さない —
 * それは ADR-123 §実装で分かったこと 2 で見つけた欠陥の再生産である。
 *
 * ## 限界 (宣言する — 推論させない)
 *
 * - **パーサは字下げベースの素朴なもの**である。`gsn_tool.py` が正本の文法を持ち、
 *   ここは「goal の labels と子 assumption の summary」しか読まない。文法が変わったら
 *   ここも落ちる (黙って 0 件になるより落ちるほうがよい — G2 が下回りでも fail する)。
 * - **`support-unexplored` には満期を求めない。** 「まだ何も名指ししていない」が
 *   その状態の定義なので、満期を書けというのは矛盾である。G3 の母集団は exploring のみ。
 *
 * 使い方: pnpm test:gsn-debt   (CI の gate ジョブからも実行)
 *
 * @see docs/adr/ADR-126-a-deferral-that-is-a-claim-belongs-to-the-argument.md
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { adrStatuses } from './adr-status.mjs'
import { hasExpiryTrigger, evaluateTriggers, TRIGGER_HELP } from './expiry-trigger.mjs'
import { BUSINESS_TREE, TAG, collectHungTrees, collectHangSites, topGoalLabels } from './gsn-attribution.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const GSN_DIR = join(ROOT, 'docs', 'gsn')
const ADR_DIR = join(ROOT, 'docs', 'adr')

/**
 * 木を持つべき ADR の cutoff。**ADR-126 以降は必須。**
 *
 * `.claude/skills/adr/SKILL.md` は「ADR を起票するなら GSN も起こす(無条件)」と既に
 * 規律を持っているが、**それを問う機械が無かった** — 規律が在ることと、守られたかを
 * 数える場所が在ることは別の事実である (ADR-115 と同じ形)。実測で ADR-115 / 116 / 117 に
 * 木が無く、逆に未実装の ADR-119 / 121 / 122 には在った。
 *
 * 遡及しない理由: 歴史 ADR 125 本に木を書くのは churn に対して得るものが無い
 * (`Retires:` を ADR-125 以降に切ったのと同じ判断)。
 */
const TREE_REQUIRED_FROM = 126

/**
 * cutoff より前で木を持たない ADR のうち、**書かないと決めたもの**。
 *
 * 空にしない — cutoff 前は「木が無い」が既定なので、ここに並ぶのは「将来書くつもりが
 * あるか、無いと決めたか」を人が判断した分だけである。今日は 0 件 (誰も判断していない)
 * ことを宣言しておく: **判断していないことと、判断して不要としたことは違う**。
 */
const DECLARED_TREELESS = new Map([])

/**
 * **support ラベルの種の宣言** — prefix で推論しない。
 *
 * 初版は `startsWith('support-')` で数え、**57 個**を報告した (実測は 30)。原因は
 * **第 3 のラベル `support-verified`** で、これは「支えが在る」= *逆の意味*である。
 * prefix は「support について何か言っている」しか意味せず、その符号を持たない。
 * 未宣言の種で throw する形にすれば、4 つ目のラベルが生まれた日に落ちる
 * (`EXPLICIT_DEFAULTS` / `PLACEMENT_BY_KIND` と同じ形 — 原則 #31)。
 */
const SUPPORT_LABELS = new Map([
  ['support-exploring', 'unsupported'],    // 探索中 — 決着させる検査を名指し済み
  ['support-unexplored', 'unsupported'],   // 未探索 — まだ何も名指ししていない
  ['support-verified', 'supported'],       // 証拠あり (逆の意味 — 債務ではない)
])

/**
 * G2 — 宣言された未支持 goal の個数 (実測値。目標値ではない)。
 *
 * **30 であって 31 ではない。** 前段の棚卸しで grep が 31 と数えたのは、adr-105 の
 * summary が散文の中で `support-unexplored` に**言及**していたからである — 言及と
 * 宣言を区別できないという ADR-124 の欠陥が、その ADR を書いた本人の計測にも出た。
 * ラベルを構造として読む本パーサが正しい。
 */
// 2026-08-14: ADR-119 D1 (target の契約宣言 + 両端の準拠テスト) が決着し 30 → 29。
// 同日 ADR-127 (UR の解析解 IK) が木を起こし +1 で 30。増えた 1 個は
// `TheFlangeConventionMatchesWhatTheFrontDraws` — **core/ 内では原理的に決着しない**
// 主張である (自己整合な誤った規約も往復検査を通る) ため、証拠はフロント配線と同時。
// 満期は機械可読なので G3 の分子には乗らない。
// 2026-08-14 (同日 3 度目): ADR-128 が 2 件決着させて 30 → 28。ADR-119 の
// `UnstatedAndStatedAnywhereAreDistinguishable` (D2/D3 の純粋層 + 文書往復) と、
// ADR-127 の `TheFlangeConventionMatchesWhatTheFrontDraws` — 後者は上のコメントが
// 予告したとおり**フロント配線と同時**に決着した (満期 trigger が実際に発火し、
// G4 が「exploring を solution へ昇格させよ」と言ってきた)。ADR-128 自身の木は
// 未支持 goal を 1 つも持たない (3 つとも solution が在る) ので +0。
// 2026-08-14 (同日 4 度目): ADR-129 (Proposed・未実装) の木が **4 goal** を足して 32。
// 起票と同時に木を起こす規律 (adr skill §GSN 併設) の帰結で、Proposed の ADR は
// 定義上ほぼ全部の goal が exploring になる — この 4 件は「借金が増えた」のではなく
// **借金が可視化された**ぶんである。4 件とも機械可読な満期を持つので分子 (G3) は動かない。
// 2026-08-14: 32 → 28。ADR-129 の 4 goal に証拠が付いた (D1/D2/D3 が実装され、
// 往復・対照・入口の個数を焼いた検査が実在する) ので exploring から solution へ昇格した。
// 下げるのも意図的な行為である — 債務を払ったのに baseline が古いままだと、
// 「いま いくつ未支持か」が再び記憶の中の数になる (ADR-103)。
// 2026-08-14 (同日 5 度目): 28 → 29。ADR-132 の木が 1 goal を足した
// (`TheJoinIsExercisedOnMovedRealGeometry` — 文書を読み込んだ状態で Solid を動かし、
// 掴む場所の宣言が動いた先に付いてくることを実機で通していない)。**ADR 本文が
// 「この証拠が構造的に見逃すもの」として自分で名指しした限界**を、散文ではなく
// 数えられる場所へ降ろしたぶんである — 散文の限界は誰も数えないので、宣言した
// 瞬間から静かに消える。機械可読な満期 (GREP) を持つので分子 (G3) は動かない。
// 2026-08-15: 29 → 34。ADR-133 (Proposed・未実装) の木が **5 goal** を足した
// (ContainerCompilesToFiveRoleTaggedSolids / WorkpieceBatchCompilesToNSolidsUnderTwoPlacementPolicies /
// RoleTaggedWallsAreExcludedFromPickableTargetsButRemainObstacles /
// ObstacleDeclarationExtendsToOrientedBoxesWithoutMovingWhoSolvesInterference /
// ScatterOverlapIsAcceptedAsCosmeticNotPhysicallyResolved)。ADR-129 の先例と同形:
// 起票と同時に木を起こす規律 (adr skill §GSN 併設) の帰結で、Proposed の ADR は
// 定義上ほぼ全部の goal が exploring になる — 借金が増えたのではなく可視化された
// ぶんである。5 件とも機械可読な満期 (PATH/GREP) を持つので分子 (G3) は動かない。
// 2026-09-18: 34 → 35。ADR-136 (Accepted・実装済み) の木が 1 goal を足した
// (`RobotSkeletonAndDefaultAddedGeometryShareTheMmScale` — ロボット骨格の見た目の
// スケールが Solid と一致することは、RobotStage が THREE.js/URDFLoader 依存で
// node --test レーンに乗らないため自動テストで焼けず、pnpm dev の目視確認に委ねる)。
// 機械可読な満期 (PATH:e2e/robot-scale-parity.spec.js — 将来 e2e が現れたら昇格判定)
// を持つので分子 (G3) は動かない。
//
// 2026-09-19: 35 → 34。その満期が ADR-137 で到来した — G4 EXPIRY が
// `PATH:e2e/robot-scale-parity.spec.js` の実在を検知して fail し、goal を
// support-verified へ昇格させた。**満期が実際に発火して借金が減った初めての例**で、
// ADR-126 が作った仕組みが印字ではなく機械であることの実測でもある。同時にこれは
// 「手動確認に委ねる」と宣言した借金の典型的な末路の記録でもあり — その目視確認は
// 一度も実行されず、見た目の主張は見た目を見ないレーンで緑のまま ADR-137 の欠陥
// (起動直後に何も描かれない) を出荷しかけた。
//
// 2026-09-19: 34 → 35。同じ PR で ADR-137 の木が exploring を 1 つ足した
// (`TheOpeningShotIsPreservedNotReinvented` — 開幕ショットの画角が従来と同じである
// ことの根拠が、逆算値とカメラ距離の一致 + main 対比のスクリーンショット目視だけで、
// e2e は frustum 内在しか見ないため『霧で沈む』『黒いマテリアル』の類を原理的に
// 通過する)。満期は機械可読 (PATH:e2e/boot-visual-regression.spec.js) なので分子
// (G3) は動かない。差引きゼロだが**両方向を宣言する** — 昇格 1 件と新規 1 件が
// 相殺して 34 のままなら、動きが 2 つあったこと自体が見えなくなる (ratchet が
// 超えても下回っても fail する理由と同じ)。
// 2026-09-19: 35 → 37。ADR-137 (Proposed・未実装) の木が 2 goal を足した
// (`UndeclaredScaleDependentQuantitiesAreCounted` — 三種のどれでもない尺度依存量を
// 数える ratchet census がまだ無い / `BootFramingGoesThroughTheOneDerivation` —
// 起動直後の framing が導出を通ることは見た目の事実なので node --test レーンが
// 構造的に見えず、決着は e2e)。ADR-133 の先例と同形で、起票と同時に木を起こす規律
// (adr skill §GSN 併設) の帰結 — Proposed の ADR は定義上ほぼ全部の goal が
// exploring になる。**この 2 件は ADR-136 のレビューで実測された欠陥**であって
// 予測ではない (前後スクリーンショットと 1293/1293 green の測り直し) — 借金が
// 増えたのではなく、散文にしか無かった限界が数えられる場所へ降りたぶんである。
// 2 件とも機械可読な満期 (PATH:src/WorldUnitCensus.test.js ·
// PATH:e2e/boot-framing.spec.js) を持つので分子 (G3) は動かない。
// 2026-09-19 (同日 2 度目): 37 → 35。ADR-137 の 2 goal に証拠が付いた
// (`UndeclaredScaleDependentQuantitiesAreCounted` ← src/WorldUnitCensus.test.js /
// `BootFramingGoesThroughTheOneDerivation` ← e2e/boot-framing.spec.js)。同日に上げて
// 同日に下げたのは、ADR を起票した PR と実装した PR が同じセッションで連続したため
// であって、借金が往復したわけではない — **上げ下げの両方が記録として要る**
// (下げないと「今いくつ未支持か」が再び記憶の中の数になる — ADR-103)。
// 2 件とも満期 (PATH:…) が実在するファイルになったので分子 (G3) も 10 → 8 へ戻る。
// 2026-09-20: 35 → 39。ADR-139 (Proposed・未実装) の木が 4 goal を足した
// (ContradictoryFramesCannotBeConstructed / HandednessErrorsAreDetectableByTheTestItself /
// UndeclaredIngressIsRefusedNotDefaulted / ExportStampsTheFrameItWrote)。ADR-133 / ADR-137
// 初版と同形で、起票と同時に木を起こす規律 (adr skill §GSN 併設) の帰結 — Proposed の
// ADR は定義上ほぼ全部の goal が exploring になる。4 件とも機械可読な満期 (PATH:…) を
// 持つので分子 (G3) は動かない。**うち 1 件は「まだ決めていない」を運ぶ**
// (LegacyFileMigrationIsDeclaredUndecided — 既存ファイルの移行 UI を今決めると画面設計を
// 先取りするので、対象外とは書かずに未決として数える。DEF-034/035 と同じ扱い)。
// 2026-09-20: 35 → 39。ADR-137 と**並行に別セッションで書かれた** ADR-138 / ADR-139 が
// main へ合流したぶん。ADR-138 の 3 goal はすべて support-verified (実装込みなので
// 借金を増やさない) で、増えた 4 件は ADR-139 (Proposed・未実装) の木である
// (ContradictoryFramesCannotBeConstructed / HandednessErrorsAreDetectableByTheTestItself /
// UndeclaredIngressIsRefusedNotDefaulted / ExportStampsTheFrameItWrote)。起票と同時に
// 木を起こす規律 (adr skill §GSN 併設) の帰結で、Proposed の ADR は定義上ほぼ全部の
// goal が exploring になる。4 件とも機械可読な満期 (PATH:…) を持つので分子 (G3) は
// 動かない。**うち 1 件は「まだ決めていない」を運ぶ** (LegacyFileMigrationIsDeclaredUndecided
// — 既存ファイルの移行 UI を今決めると画面設計を先取りするので、対象外とは書かずに
// 未決として数える。DEF-034/035 と同じ扱い)。
// 2026-09-20 (3 度目): 39 → 43。ADR-140 / ADR-141 の木が 2 本ずつ足した。**4 件とも
// 実装は済んでいる** (両 ADR とも Accepted) 点が上の 2 回と違う — 増えたのは
// 「実装が未着手だから未支持」ではなく、**この形の証拠では原理的に届かない主張**を
// 隠さず宣言したぶんである:
//   - ThePointerActuallySelectsTheArmInTheRunningApp (ADR-140, exploring・満期あり)
//     — 純粋な決定は 16 本の検査で焼いたが、候補を*集める*側 (RobotStage.raycast の
//     距離) は問うていない。「実際にクリックして選べる」は人が画面で見るしかない。
//   - TheFallbackHitBoxesAreTheRightSizeOnScreen (ADR-140, unexplored・満期なし)
//     — ADR-136 以後 ±0.4 world-unit は ±0.4 mm を意味する。優先順位の決定であって
//     当たり判定の広さの決定ではないのでスコープ外にしたが、**対象外とは書かずに
//     未決として数える** (ADR-138 の census に当てるか別 ADR かが未決)。
//   - DeclaringADifferentArmIsAllowedButNeverSilent (ADR-141, exploring・満期あり)
//     — 純粋側 (reachDisagreements) は焼いたが、それが*画面に出る*ことは焼いていない。
//     パネルの分岐は JSX + zustand に住み node --test レーンから構築できない。
//   - TheWholeEnvelopeIsTraceableNotJustItsMaximum (ADR-141, unexplored・満期なし)
//     — 帯の検査は reachMax しか縛らない。reachMin / wristConeHalfAngle は実質的に
//     宣言されただけの数で、reachProvenance はこの 2 つを指していない。
// 満期を持つのは 2 件 (PATH:e2e/click-target.spec.js / PATH:e2e/reach-declaration.spec.js)
// なので、分子 (G3) は 2 件ぶん増える。**実装済みの ADR が借金を増やすのは正常である** —
// 増えないのは「証拠が届かない範囲を宣言しなかった」ときだけで、それは借金が無いのでは
// なく数えていないだけ (原則 #31)。
// 2026-09-20 (4 度目): 43 → 44。ADR-142 (Accepted・実装済み) の木が 1 goal を足した。
//   - ThePointerActuallySeesTheRobotAfterPickingATemplate (ADR-142, exploring・満期あり)
//     — 純粋な既定値の反転 (defaultExplicit) は unit で焼いた。「実際のブラウザで
//     テンプレートを選ぶとロボットが描かれる」ことは、テンプレート選択 (_selectLayoutTemplate)
//     を通る e2e が repo に 1 本も無い (調査済み) ため、まだ人が見るしかない。
// 満期は機械可読 (PATH:e2e/smoke.spec.js) なので分子 (G3) は動かない。
// 2026-09-21: 43 → 47。ADR-144 (Proposed・未実装) の木が 4 goal を足した
// (ApproximateSearchReusesExistingFkSamplingWithNoNewSolverEquations /
// ClientApproximationIsStructurallyDistinctFromTheWireReachSolution /
// GateIsTheExistingUndeclaredFactNotANewEnvironmentFlag /
// SinglePreviewEntryPointIsExtendedNotDuplicated)。ADR-129/133/137/139 の先例と同形で、
// 起票と同時に木を起こす規律 (adr skill §GSN 併設) の帰結 — Proposed の ADR は定義上
// ほぼ全部の goal が exploring になる。4 件とも機械可読な満期 (PATH:src/robotics/
// ApproximateReachPreview.test.js · GREP:src/controller/GraspController.test.js ·
// GREP:src/domain/robotConfig.test.js) を持つので分子 (G3) は動かない。
// 2026-09-21 (同日・実装後): 47 → 43。ADR-144 を実装し、上の 4 goal がすべて
// support-verified になった (満期は 4 件とも実在する検査として現れた: ユニット 2 本 +
// e2e S11/S11b + ajv 準拠)。**下回りも落とすのがこの定数の規律** — 払った借金を
// baseline に残すと、次に増えたとき「増えた」が見えなくなる (ADR-103)。同じ木は
// 支えつきの goal を 1 つ足している (画素側の TheArmActuallyMovesOnAStaticHost…) が、
// 支えがあるので未支持の数には乗らない。分子 (G3) は 4 件とも機械可読だったので不変。
// 2026-09-21 (同日・別ADR): 43 → 47。ADR-145 (Proposed・未実装) の木が 4 goal を足した
// (ForwardKinematicsChainReturnsEachJointOriginNotOnlyTheFlange /
// NaiveArmSweepCollisionCheckerDetectsPedestalIntrusion /
// ProtocolExtensionKeepsTheWireAndExistingCheckersUnchanged /
// UndeclaredKinematicsFallsBackToPathOnlyCheckingWithoutSilentBehaviorChange)。
// ADR-144 と同じ先例 — Proposed の ADR は定義上ほぼ全部の goal が exploring になる
// (adr skill §GSN 併設: 起票と同時に木を起こす規律は無条件)。4 件とも機械可読な満期
// (GREP:core/easy_extrude_core/engine/ur_kinematics.py・feasibility.py・
// core/tests/test_engine.py) を持つので分子 (G3) は動かない。
// 2026-09-21 (同日・実装後): 47 → 43。ADR-145 を実装し、上の 4 goal がすべて
// support-verified になった。ADR-144 のときと**同じ日に同じ振れ方**をしたので記録して
// おく — 起票と実装が同日に並ぶと baseline は上がって下がるが、上がったまま忘れられた
// 日があれば「宣言された未支持」は静かに増える。下げるのを忘れないための痕跡がこの行。
// 2026-09-21 (同日・3 件目): 43 → 44。ADR-146 が支えの無い goal を **1 つ意図的に**
// 足した — D1 アイデア軸 (「コスト関数・重み・ランキングは core/ のみ」) は
// **コードの構文から導出できない**ので機械に降ろせていない。降ろせないものを
// support-verified と名乗らせるほうが害が大きいので、未支持のまま宣言して数える
// (ADR-146 の最も弱い辺。DEF-039 と同じ番地で満期を持つ)。
// 2026-09-22: 44 → 45。ADR-148 が支えの無い goal を **1 つ意図的に** 足した —
// 描画スタイルを往復切替したときに geometry/material が実際に解放されたかは、
// **どのレーンも数えていない**。`RobotStage._disposeTree` は書いたが、解放の
// *個数* を問うには renderer の `info.memory` を露出させる判断が要り、この PR の
// 範囲を超える。e2e の往復は「壊れていないこと」を示すだけで解放は示さないので、
// support-verified と名乗らせずに未支持のまま宣言して数える (原則 #29 の二状態 —
// 「対象外」とは書かない)。満期は機械可読: AppController.js の
// "Console-level for now" が消えたとき = UI トグルが付き往復が常用操作になる日。
// 2026-09-22: 45 → 47。ADR-149 がその満期を実際に到来させた (Retires: で件の行を
// 消した) — が、到来したのは「往復が常用操作になる前提条件」であって「disposal 計測の
// 証拠が実在するようになった」ではないため、ADR-148 側の goal は support-verified へは
// 昇格させず、旧 assumption の文面だけを事実 (満期到来・証拠は依然として無い) に合わせて
// 更新した。あわせて ADR-149 自身が支えの無い goal を **2 つ** 意図的に足した —
// (1) UI トグルの失敗経路 (route abort による e2e) はこの PR で見送り (満期は機械可読:
// PATH:e2e/robot-appearance-failure.spec.js)、(2) 上記の disposal 計測をどう引き継ぐかの
// 判断そのもの (DEF-042、番号未定の ADR が起票されるまで機械可読な満期を持てない)。
// 45 → 47 の内訳は 47(+2, ADR-149 の新規未支持 2 件) であり、ADR-148 側は goal 数も
// support ラベルも変えていない (assumption の文面更新のみ)。
// 2026-09-23: 47 → 48。ADR-150 が支えの無い goal を **1 つ意図的に** 足した —
// `WhatThisDidNotDoIsCounted`: 当事者依頼のうち触れなかった 2 つ (単体/トレー内の
// ピック検証の分割 = DEF-043、シーンの tcp フレームの seed がフランジのまま = DEF-044)。
// どちらも登録簿の行で満期は機械可読 (PATH:pick-sequence-response.schema.json /
// GREP:robotSkeleton.js::TOOL_LENGTH_M)。ADR-150 の他の 5 goal はすべて support-verified。
// 2026-09-23 (同日・別ADR): 48 → 51。ADR-151 (Proposed・起票のみ — 当事者の指示) の木が
// 3 goal を足した (TCP の印がツール先端に追従 / tcp 実体 0 個 + 移行警告 / tcpOrientation の
// 導出)。ADR-144/145 の先例どおり、実装して support-verified に上がった日に下げる。
// 3 つとも満期は機械可読 (GREP:src/view/RobotStage.js::_attachTcpMarker)。
// 2026-09-23 (ADR-151 実装): 51 → 49。起票時の 3 goal (印の追従 / 保存された tcp /
// ワイヤの導出) が e2e・unit の solution で支えられて verified になり、第二段 (DEF-045 —
// 取付けの 6 自由度をワイヤと core/ へ) の goal が 1 つ exploring として増えた (差し引き −2)。
// 満期は機械可読 (GREP:…grasp-search-request.schema.json::toolMount)。
// 2026-09-25: 49 → 53。ADR-152 (Proposed・起票のみ — 当事者の指示「まず ADR をかためる」) の
// 木が 4 goal を足した (手の形 = 判定の形 / どう掴むかの宣言と幅の測り方 / 全宣言欄の 3D
// 確認 / request のみの契約追加)。ADR-144/145/151 の先例どおり、実装して support-verified に
// 上がった日に下げる。4 つとも満期は機械可読 (GREP:grasp-search-request.schema.json::closingAxis
// ほか) なので分子 (G3) は動かない。
// 2026-09-26: 53 → 55。ADR-152 を当事者レビューで改稿 (把持仕様・把持戦略の語彙と
// 「+x ってどこ?」の確認を追加、response 版上げを決定) し、木が 2 goal 増えた
// (GraspSpecsAndStrategyAreSayable / PlusXIsSeenOnTheObject — 旧 HowToGraspIs… を
// 語彙と判定の 2 つに割った差し引き)。6 つとも満期は機械可読なので分子 (G3) は動かない。
// 2026-09-26 (同日・実装): 55 → 49。ADR-152 を実装し 6 goal がすべて support-verified に
// 上がった (証拠: graspFeature / robotHand / robotTool / GraspDeclarationConfirmation の
// node --test、core/tests/test_grasp_specs.py、test:contract v7、e2e/grasp-declaration.spec.js)。
// 6 つとも満期は機械可読だったので分子 (G3) は動かない。
// 2026-09-29: 49 → 52。ADR-156 (Proposed・起票のみ — 当事者の指示「今回は ADR だけで」) の
// 木が 3 goal を足した (最良 1 点・外れる 0 点 / 欠けた入力は採点しない / 長さ単位が消える)。
// ADR-151/152 の先例どおり、実装して support-verified に上がった日に下げる。3 つとも満期は
// 機械可読 (GREP:core/tests/test_engine.py::suction_hold) なので分子 (G3) は動かない。
// 同日 (当事者レビュー): 52 → 53。ADR-156 D6「外れる候補は落とさず、札は 0 点から導出」の
// goal を 1 つ足した。満期は機械可読 (GREP:src/view/GraspScoreMath.test.js::suction_hold)。
// 2026-09-30: 53 → 46。ADR-121 (3 goal) と ADR-156 (4 goal) を同じ PR で実装し、7 goal が
// すべて support-verified に上がった (証拠: core/tests/test_engine.py の suction_hold 群、
// test_contract_conformance.py の推定 census、GraspScoreMath / GraspDeclarationConfirmation /
// targetMass の node --test)。ADR-156 の 4 つは機械可読な満期が G4 で発火して昇格を求めた。
const DEBT_BASELINE = 46

/**
 * G3 — 満期 trigger を持たない exploring goal の個数 (実測値)。
 *
 * 0 にできない理由を宣言しておく: 決着させる検査が**まだ設計されていない**ことがある。
 * 「何が決着させるか」を名指しできても、それが repo 内のどの番地に現れるかは
 * 決まっていない段階が実在する。嘘の trigger を書くより、書けないことを数える。
 */
// 2026-08-14: 上と同じ 1 件。決着した goal の assumption は散文満期だったので分子も下がる。
// 2026-08-14 (同日 3 度目): ADR-128 の決着 2 件のうち、ADR-119 側の assumption は
// 散文満期だったので 25 → 24。ADR-127 側は機械可読な満期を持っていたので分子には
// もともと乗っておらず、ここは 1 しか下がらない。
// 2026-09-22: 24 → 26。ADR-148 の DisposalCountWouldNeedARendererLevelProbe は
// 機械可読な満期を使い切った (発火・決着済みではなく、前提条件だけが成立) ので、
// 次の判断先 (DEF-042 — 番号未定の ADR が起票されるまで trigger を書けない) へ
// 散文のまま引き継ぎ、分子に残る (+1)。ADR-149 自身の
// TheFiredADR148TriggerIsRegisteredNotSilentlyDropped も同じ理由で機械可読な
// 満期を持てない (+1)。もう一方の新規 exploring goal
// (AFailedLoadIsShownAndRolledBackRatherThanSilent) は
// PATH:e2e/robot-appearance-failure.spec.js を持つので分子には乗らない。
// 2026-09-30: 26 → 24。ADR-121 の PureLayerTestWillSettleIt / SchemaCensusWillSettleIt は
// 散文満期だった (番地を書けていなかった) ので、実装で決着して分子から 2 つ抜けた。
// 3 つ目 (KeyAbsenceTestWillSettleIt) は GREP 満期を持っていたので分子には乗っていない。
const PROSE_DEBT_BASELINE = 24

const errors = []

// ── .gsn の素朴なパース (字下げベース) ───────────────────────────────────────

/**
 * @returns {{file: string, ident: string, line: number, labels: string[],
 *            assumptions: {ident: string, summary: string}[]}[]}
 *   goal ノードのうち support ラベルを持つものだけ。
 */
function collectDeclaredUnsupported() {
  const out = []
  if (!existsSync(GSN_DIR)) return out

  for (const file of readdirSync(GSN_DIR).filter(f => f.endsWith('.gsn')).sort()) {
    const lines = readFileSync(join(GSN_DIR, file), 'utf8').split('\n')
    /** @type {{ident: string, indent: number, line: number, labels: string[], assumptions: any[]}|null} */
    let current = null
    /** @type {{indent: number, summary: string}|null} */
    let pendingAssumption = null

    const flush = () => {
      if (current) {
        const support = current.labels.filter(l => l.startsWith('support-'))
        for (const l of support) {
          if (!SUPPORT_LABELS.has(l)) {
            errors.push(
              `G2 DEBT: docs/gsn/${file}:${current.line} の goal ${current.ident} が未宣言の ` +
              `support ラベル "${l}" を持っている。\n` +
              '    SUPPORT_LABELS に種と**符号** (supported / unsupported) を宣言すること — ' +
              'prefix は符号を持たない。\n' +
              '    実際 support-verified は「支えが在る」= 逆の意味で、prefix で数えた初版は ' +
              '30 を 57 と報告した。')
          }
        }
        if (support.some(l => SUPPORT_LABELS.get(l) === 'unsupported')) {
          out.push({ file: `docs/gsn/${file}`, ...current })
        }
      }
      current = null
    }

    lines.forEach((raw, i) => {
      const indent = raw.length - raw.trimStart().length
      const text = raw.trim()
      const node = /^(goal|strategy|solution|context|assumption|justification)\s+(\S+)/.exec(text)

      if (node) {
        const [, kind, ident] = node
        if (kind === 'goal') {
          flush()
          current = { ident, indent, line: i + 1, labels: [], assumptions: [] }
          pendingAssumption = null
          return
        }
        // goal より深い assumption はその goal の子。同じか浅ければ goal は閉じる。
        if (current && indent <= current.indent) flush()
        pendingAssumption = (kind === 'assumption' && current)
          ? { ident, indent, summary: '' }
          : null
        if (pendingAssumption) current.assumptions.push(pendingAssumption)
        return
      }

      if (!current) return
      const labels = /^labels\s+(.*)$/.exec(text)
      if (labels && !pendingAssumption) {
        current.labels.push(...labels[1].split(',').map(s => s.trim()))
        return
      }
      const summary = /^summary\s+"([\s\S]*)"?$/.exec(text)
      if (summary && pendingAssumption) pendingAssumption.summary += summary[1]
    })
    flush()
  }
  return out
}

// ── 実行 ─────────────────────────────────────────────────────────────────────

const statuses = adrStatuses(ADR_DIR)

// ── G1 POPULATION ────────────────────────────────────────────────────────────

const trees = existsSync(GSN_DIR)
  ? readdirSync(GSN_DIR).filter(f => f.endsWith('.gsn'))
  : []
if (trees.length === 0) {
  errors.push('G1 POPULATION: docs/gsn に .gsn が 1 本も無い — 走査に失敗している (0 は達成ではない)。')
}

const adrFiles = readdirSync(ADR_DIR).filter(f => /^ADR-\d{3}.*\.md$/.test(f)).sort()
for (const file of adrFiles) {
  const id = file.slice(0, 7)
  const num = Number(id.slice(4))
  const slug = `adr-${id.slice(4)}-`
  const hasTree = trees.some(t => t.startsWith(slug))

  if (hasTree) {
    if (DECLARED_TREELESS.has(id)) {
      errors.push(
        `G1 POPULATION: ${id} は DECLARED_TREELESS に宣言されているのに木が在る。\n` +
        '    宣言が実物より古い — 行を消すこと (ADR-103 — 退役の腐敗は緑を出す)。')
    }
    continue
  }
  if (num >= TREE_REQUIRED_FROM) {
    errors.push(
      `G1 POPULATION: ${id} に \`.gsn\` が無い。ADR-${TREE_REQUIRED_FROM} 以降は必須 (ADR-126)。\n` +
      `    docs/gsn/${slug}<slug>.gsn を同じ PR で起こすこと。\n` +
      '    .claude/skills/adr/SKILL.md §GSN 併設 が「無条件」と既に宣言しているが、\n' +
      '    **それを問う機械が無かった** — 規律が在ることと、守られたかを数える場所が\n' +
      '    在ることは別の事実である (ADR-115 と同じ形)。')
  }
}

for (const id of DECLARED_TREELESS.keys()) {
  if (!statuses.has(id)) {
    errors.push(`G1 POPULATION: DECLARED_TREELESS の ${id} が docs/adr に無い。`)
  }
}

// ── G2 DEBT / G3 REACH / G4 EXPIRY ───────────────────────────────────────────

const unsupported = collectDeclaredUnsupported()

if (unsupported.length !== DEBT_BASELINE) {
  const dir = unsupported.length > DEBT_BASELINE ? '増えた' : '減った'
  const byFile = new Map()
  for (const g of unsupported) byFile.set(g.file, (byFile.get(g.file) ?? 0) + 1)
  errors.push(
    `G2 DEBT: 宣言された未支持 goal が ${unsupported.length} 個 (baseline ${DEBT_BASELINE} から ${dir})。\n` +
    (unsupported.length > DEBT_BASELINE
      ? '    証拠の無い主張が増えた。正当なら baseline を上げ、理由をこの定数の docstring に書くこと。\n'
      : '    証拠が付いたなら baseline をこの実測値へ下げること。下回りも落とすのは、\n' +
        '    baseline が古いままだと「今いくつ未支持か」が再び記憶の中の数になるから (ADR-103)。\n') +
    [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([f, n]) => `      ${String(n).padStart(3)}  ${f}`).join('\n') + '\n')
}

const exploring = unsupported.filter(g => g.labels.includes('support-exploring'))
const proseOnly = exploring.filter(g => !g.assumptions.some(a => hasExpiryTrigger(a.summary)))

if (proseOnly.length !== PROSE_DEBT_BASELINE) {
  const dir = proseOnly.length > PROSE_DEBT_BASELINE ? '増えた' : '減った'
  errors.push(
    `G3 REACH: 満期 trigger を持たない exploring goal が ${proseOnly.length} 個 ` +
    `(baseline ${PROSE_DEBT_BASELINE} から ${dir})。\n` +
    '    決着させる検査の**番地**が分かるなら、assumption の summary に書くこと:\n' +
    TRIGGER_HELP +
    '    書けない (検査がまだ設計されていない) なら baseline を動かし、理由を宣言すること。\n' +
    '    数えなければ「満期を機械が読む」は goal ごとに静かに空洞化する (原則 #31)。\n')
}

for (const g of exploring) {
  for (const a of g.assumptions) {
    for (const t of evaluateTriggers(a.summary, { root: ROOT, statuses })) {
      if (t.broken) {
        errors.push(
          `G4 EXPIRY: ${g.file} の goal ${g.ident} (assumption ${a.ident}) の満期 trigger ` +
          `(${t.kind}) が壊れている — ${t.broken}。\n` +
          '    満期が来ないのではなく、満期を判定する場所が消えている。張り替えること。')
        continue
      }
      if (t.fired) {
        errors.push(
          `G4 EXPIRY: ${g.file}:${g.line} の goal ${g.ident} は満期を迎えている — ` +
          `${t.kind}:${t.what}。\n` +
          '    名指しした検査が実在するようになった。**exploring を solution へ昇格させる**\n' +
          '    (証拠が在るのに support-exploring のままだと、論証木は実際より弱く見える —\n' +
          '    退役の腐敗の鏡像で、こちらは*過少申告*として緑を出す)。')
      }
    }
  }
}

// ── G5 ATTRIBUTION (ADR-153) ─────────────────────────────────────────────────

// 帰属の読み手は scripts/gsn-attribution.mjs ただ 1 箇所 (ADR-154 — 登録簿 Q8 と共有)。

const hungTrees = collectHungTrees()
const adrTrees = trees.filter(t => /^adr-\d{3}-/.test(t)).sort()
if (!trees.includes(BUSINESS_TREE)) {
  errors.push(`G5 ATTRIBUTION: docs/gsn/${BUSINESS_TREE} が無い — 投資を帰属させる先が消えている。`)
}
const unhung = adrTrees.filter(t => !hungTrees.has(t))
const doubleHung = adrTrees.filter(t => (hungTrees.get(t) ?? 0) > 1)
if (unhung.length > 0) {
  errors.push(
    `G5 ATTRIBUTION: 事業木に吊られていない木が ${unhung.length} 本 — 事業的な goal が無いまま実行された投資。\n` +
    '    docs/gsn/profit-growth.gsn の、この木が動かす項 (ProfitFormula のどれか) の goal の下に\n' +
    '    solution を 1 つ足し、artifacts に木のパスを書くこと。ADR が Proposed でも吊ってよい\n' +
    '    (solution は goal を増やさない — 木の側の state が成熟度を持つ)。\n' +
    unhung.map(t => `      docs/gsn/${t}`).join('\n') + '\n')
}
if (doubleHung.length > 0) {
  errors.push(
    `G5 ATTRIBUTION: 事業木に 2 回以上吊られた木が ${doubleHung.length} 本 — 寄与の二重計上。\n` +
    '    主たる寄与先 1 つに吊り、副次的な寄与は木の側の context に書くこと (ByRevenueAndCost の規約)。\n' +
    doubleHung.map(t => `      docs/gsn/${t} (${hungTrees.get(t)} 回)`).join('\n') + '\n')
}

// ── G6 CATEGORY (ADR-153 D5) ─────────────────────────────────────────────────

const { sites, terms: businessTerms, kinds: businessKinds } = collectHangSites()
const categoryErrors = []
for (const tree of adrTrees) {
  const labels = topGoalLabels(tree)
  const term = TAG(labels, 'term-')
  const change = TAG(labels, 'change-')
  const where = `docs/gsn/${tree}`
  if (term.length !== 1 || change.length !== 1) {
    categoryErrors.push(`${where}: top goal が term-* を ${term.length} 個・change-* を ${change.length} 個持つ (それぞれちょうど 1 個)`)
    continue
  }
  if (!businessTerms.has(term[0])) {
    categoryErrors.push(`${where}: term-${term[0]} は事業木に無い項 (未宣言の種を既定で通さない)`)
    continue
  }
  if (!businessKinds.has(change[0])) {
    categoryErrors.push(`${where}: change-${change[0]} はどの項も受け入れていない種類 (事業木の admits- に無い)`)
    continue
  }
  const site = sites.get(tree)
  if (!site) continue // 未接続は G5 が数える
  if (site.term.length !== 1) {
    categoryErrors.push(`${where}: 吊り先 ${site.goal} から項が 1 つに決まらない (祖先の term- = [${site.term}])`)
    continue
  }
  if (site.term[0] !== term[0]) {
    categoryErrors.push(`${where}: 木は term-${term[0]} を名乗るが、吊り先 ${site.goal} の項は term-${site.term[0]}`)
  }
  if (!site.admits.includes(change[0])) {
    categoryErrors.push(`${where}: change-${change[0]} を吊り先 ${site.goal} は受け入れない (admits: ${site.admits.join(' / ') || 'なし'})`)
  }
}
if (categoryErrors.length > 0) {
  errors.push(
    `G6 CATEGORY: 吊り先と木の申告が食い違う木が ${categoryErrors.length} 本。\n` +
    '    どちらかの判断が誤っている — 吊り先を移すか、木の term-/change- を直すか、\n' +
    '    事業木の goal の admits- を広げるか (広げるなら理由をその goal の summary に書く)。\n' +
    categoryErrors.map(e => `      ${e}`).join('\n') + '\n')
}

// ── 出力 ─────────────────────────────────────────────────────────────────────

if (errors.length > 0) {
  console.error(`check-gsn-debt: ${errors.length} 件\n`)
  for (const e of errors) console.error(`  • ${e}\n`)
  process.exit(1)
}

console.error(
  `check-gsn-debt: OK — 木 ${trees.length} 本 / 宣言された未支持 ${unsupported.length} 個 ` +
  `(baseline ${DEBT_BASELINE}) / うち exploring ${exploring.length} 個 · ` +
  `満期が機械可読 ${exploring.length - proseOnly.length} 個・散文のみ ${proseOnly.length} 個 ` +
  `(baseline ${PROSE_DEBT_BASELINE}) / 満期切れ 0 件 / ` +
  `事業木に吊られた木 ${adrTrees.length - unhung.length}/${adrTrees.length} 本 · ` +
  `項と種類が一致 ${adrTrees.length - categoryErrors.length}/${adrTrees.length} 本 ` +
  `(項 ${businessTerms.size} · 種類 ${businessKinds.size})`)
