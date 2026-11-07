/**
 * placement — 実体の「配置方針」の宣言と、その方針が pose 入力に課す規則 (ADR-097)。
 *
 * ## なぜ方針が要るのか
 *
 * 「接地」はこれまで**ジェスチャの副作用**だった。stack snap は自由 Grab には
 * 効いて軸拘束には効かず (`stackMode && axis !== 'z'`)、Solid には効いて非 Solid
 * には効かず (`instanceof Solid` の早期 return)、ドラッグ中の注釈には効いて
 * `mounts` の毎フレーム追従には効かなかった。同じ規則が経路ごとに別実装され、
 * 実装されていない経路が黙って床を抜ける — 症状が実体種ごとに現れたのは
 * **入口ごとに実装したから**であって、種の問題ではない (ADR-097 §Lens notes)。
 *
 * そこで規則を経路から剥がし、**実体種の宣言**へ移す。ハンドラは delta を渡す
 * だけで clamp を持たない。方針の適用は pose 書き込みの唯一の入口
 * (`SceneService.applyPreviewTranslation`) が行う (原則 #1)。
 *
 * ## 4 つの方針
 *
 *   supported : 必ず何かの上。支持を失う pose は存在できない。Z は支持面から
 *               導出され、入力の Z 成分は捨てる。
 *   resting   : 面に載る物体。水平に動き、載る補助 (stack assist) を受ける。
 *               **床は方針ではなく所属が持つ** (ADR-170 S2): 属するゾーンがあれば
 *               その高さより下へは行けない (belowGradeIntent を立てれば行ける)。
 *               どこにも属さなければ床を持たない。
 *   free      : 自由。支持の概念を持たない。
 *   level     : その高さの面の中で動く。Z は宣言で、ドラッグは水平、Z を変えるのは
 *               数値か Z 拘束だけ。下の面に貼り付かない (ADR-170 — ゾーンの板)。
 *
 * ## 床は種類から来ない (ADR-170 S2)
 *
 * ADR-097 から S2 までの `grounded` は 2 つの事実を 1 語で運んでいた — 「床を割らない」と
 * 「面に載る物体 (水平ドラッグ・載る補助)」。床を所属へ移すには割るしかなかった
 * (床を外した物体を `free` にすると、箱がカメラ正対面で動き、積み上がらなくなる)。
 * 後者が方針の語 `resting`、前者は物の `floor` = `zone.js` の `floorOf()` (所属から導く。
 * 保存しない)。純粋な決定 (`resolvePlacementDelta` / `resolveFaceExtrudeDistance`) は
 * 床を引数 `floorZ` で受け取り、Z=0 を知らない。
 *
 * `free` は既定ではない。**種ごとに表で宣言する**のがこの決定の要点で、新しい
 * 実体種を足すときにこの欄を空にできない (原則 #31 — 正当な「支持なし」は
 * 推論させず宣言させる)。`placementFor()` は未宣言の種で throw する。
 *
 * ## 「載る」も方針の関数である (ADR-098)
 *
 * ADR-097 は pose の入口を 1 つにしたが、その入口の**中に種の門が残っていた** —
 * stack assist は `instanceof Solid` で閉じ、支持プローブ (`_footprintSamplesOf` /
 * `_bottomZOf`) は `instanceof CoordinateFrame` で分岐していた。入口を 1 つにしても
 * 入口の中で種が分かれれば結果は同じなので、ADR-098 が
 * `stackAssistApplies()` と `SUPPORT_PROBE_BY_KIND` をここへ引き取った。
 *
 * ## この木が成立する範囲
 *
 * 支持の導出は下向きレイに依存するので、扱えるのは**水平支持面だけ**である
 * (壁面・天井・傾斜面へのマウントは表現できない — ADR-097 §受け入れるコスト)。
 * ロボットのスケルトンと非表示の実体は支持面ではない (レイは可視 cuboid のみを
 * 撃つ — ADR-098 §範囲の限界 / ADR-096)。
 *
 * 純粋モジュール: THREE も DOM も持たず、plain な `{x,y,z}` で入出力する。
 * ドメインクラスの `instanceof` はこのファイルの中だけに在り (原則 #2)、
 * 呼び出し側で並べ直すのは第二の源 (§1.1) なので `PosePolicyOwnership.test.js`
 * が落とす。
 *
 * @see docs/adr/ADR-097-support-is-entity-state-not-gesture-side-effect.md
 * @see docs/gsn/adr-097-support-as-entity-state.gsn
 */

import { Solid }           from './Solid.js'
import { ImportedMesh }    from './ImportedMesh.js'
import { MeasureLine }     from './MeasureLine.js'
import { Profile }         from './Profile.js'
import { AnnotatedPoint }  from './AnnotatedPoint.js'
import { AnnotatedLine }   from './AnnotatedLine.js'
import { AnnotatedRegion } from './AnnotatedRegion.js'
import { CoordinateFrame } from './CoordinateFrame.js'
import { isRobotBaseFrame } from './robotFrames.js'
import { isZone } from './zone.js'
import { mm } from './worldUnits.js'

/**
 * 接地判定の許容 — **1 mm** (ADR-137 D1/D2「宣言された物理長」)。
 *
 * この定数は元から「1 mm」と書かれていたが、値は `0.001` だった — つまり
 * **1 world-unit = 1 m** を前提にしていた。ADR-136 が world-unit を mm へ寄せた
 * あと、この許容は 1 µm を意味してしまい、接地・積み重ねの判定が実質「完全一致」
 * になっていた (mm 系の corner はわずかな回転で 1 µm を超える)。意図した物理量は
 * 変えず、単位だけを `mm()` で名乗らせる。
 */
export const SUPPORT_TOLERANCE = mm(1)

/** 配置方針の語彙 (ADR-097 §Decision 1)。 */
export const PLACEMENT = Object.freeze({
  SUPPORTED: 'supported',
  /** ADR-170 S2: 面に載る物体。床は種類ではなく所属から (`floorOf`) — `grounded` の後継。 */
  RESTING:   'resting',
  FREE:      'free',
  /** ADR-170: 宣言された高さの水平面に居る (ゾーン)。床の不変条件は持たない — 地下は負の高さ。 */
  LEVEL:     'level',
})

const PLACEMENT_WORDS = new Set(Object.values(PLACEMENT))

/**
 * 方針語の外の値 (`undefined` を含む) で throw する。
 *
 * ADR-170 S2 で `PLACEMENT.GROUNDED` を消したとき、テストに残った 3 か所の
 * `PLACEMENT.GROUNDED` (= `undefined`) は「free 以外は水平」の分岐を素通りして
 * **緑を出した**。退役した語は違反を見逃すのではなく緑を出す (原則 #31 / ADR-103)
 * ので、純粋な決定の入口で語彙を問う — 種ごとの既定表が未宣言の種で throw するのと同じ形。
 * @param {*} placement
 */
function assertPlacementWord(placement) {
  if (!PLACEMENT_WORDS.has(placement)) {
    throw new Error(`[placement] not a placement word: ${String(placement)} (one of ${[...PLACEMENT_WORDS].join(' / ')})`)
  }
}

/**
 * 方針表が引かれる「種」。全メンバが `PLACEMENT_BY_KIND` に行を持たねばならず、
 * *在るもの*を辿るのではなく**列挙して個数を検査**する (原則 #31)。
 */
export const PLACEMENT_KIND = Object.freeze({
  /** AnnotatedPoint / AnnotatedLine / ゾーンでない AnnotatedRegion — マップオブジェクト。 */
  ANNOTATION:        'annotation',
  /** placeType が Zone の AnnotatedRegion — 物が属し、その高さに床を持つ場所 (ADR-170)。 */
  ZONE:              'zone',
  /** Solid — 押し出された建物・部品。 */
  SOLID:             'solid',
  /** ImportedMesh — STEP 等の取り込み形状。 */
  IMPORTED_MESH:     'importedMesh',
  /** robot_base CF — 物体と同じ規則で面に載る。床は所属から (ADR-170 O1 — 例外にしない)。 */
  ROBOT_BASE_FRAME:  'robotBaseFrame',
  /** ユーザー CF / body frame (Origin) / tcp — 空間の目印であって物体ではない。 */
  COORDINATE_FRAME:  'coordinateFrame',
  /** MeasureLine — 二点間を測る補助線。 */
  MEASURE_LINE:      'measureLine',
  /** Profile — 押し出し前の 2D 断面。 */
  PROFILE:           'profile',
})

/**
 * 種ごとに**宣言された**配置方針 (ADR-097 §Decision 1)。
 *
 * `placementFor()` 経由でのみ読むこと — 直接添字すると未知の種が黙って
 * `undefined` を返し、それは「誰も選んでいない既定」そのものになる。
 */
export const PLACEMENT_BY_KIND = Object.freeze({
  // 散文の不変条件だったもの: "must stay pinned to the ground plane or a
  // building roof, never floating" (SceneService._isMapObject の JSDoc)。
  [PLACEMENT_KIND.ANNOTATION]:       PLACEMENT.SUPPORTED,
  // ゾーンの板の Z はその床の高さという**宣言**で、下に何があるかから導かない
  // (ADR-170 S1 — 2F や地下を、スラブを描かずに言うため)。ADR-072 の「浮かない板」から外れる唯一の注釈。
  [PLACEMENT_KIND.ZONE]:             PLACEMENT.LEVEL,
  // 物体は面に載る。床は種類ではなく所属から来る (ADR-170 S2 — DEF-076 の満期で
  // `grounded` の行は消えた)。属するゾーンの床の下 (基礎・杭・ピット) は禁止しない —
  // S で宣言させる (G3 / O3)。
  [PLACEMENT_KIND.SOLID]:            PLACEMENT.RESTING,
  [PLACEMENT_KIND.IMPORTED_MESH]:    PLACEMENT.RESTING,
  // ロボットも例外にしない (ADR-170 O1 — 2026-11-07 当事者)。かつての理由「床に埋まった
  // base pose は無意味 (ADR-083)」は ADR-083 の本文に無く、地下の台座は負の高さの
  // ゾーンに属させれば言える。属するなら床はそのゾーンの高さ。
  [PLACEMENT_KIND.ROBOT_BASE_FRAME]: PLACEMENT.RESTING,
  // CF は物体ではない。床下の座標系は正当 (地下の基準点・ピットの原点)。
  [PLACEMENT_KIND.COORDINATE_FRAME]: PLACEMENT.FREE,
  // 計測線は「何かの上」ではなく「二点の間」に在る。支持の概念を持たない。
  [PLACEMENT_KIND.MEASURE_LINE]:     PLACEMENT.FREE,
  // 断面はスケッチ平面の上に在り、その平面は床とは限らない (面上スケッチ)。
  [PLACEMENT_KIND.PROFILE]:          PLACEMENT.FREE,
})

/**
 * 実体 → 種。`instanceof` の連鎖が在ってよい唯一の場所 (原則 #2 / §1.1)。
 *
 * robot_base だけは `instanceof CoordinateFrame` の**内側**で分かれる — 判定は
 * ドメインの名前付き述語 `isRobotBaseFrame()` を呼ぶ (同一性の再導出をしない —
 * ADR-090 / `IDENTITY_RULES`)。
 *
 * @param {*} entity
 * @returns {string|null} `PLACEMENT_KIND` メンバ、分類できなければ null
 */
export function placementKindOf(entity) {
  if (!entity) return null
  // ゾーンは AnnotatedRegion の**内側**で分かれる — robot_base と同じ形で、判定は
  // ドメインの名前付き述語 `isZone()` を呼ぶ (placeType を並べ直さない — IDENTITY_RULES)。
  if (entity instanceof AnnotatedRegion) {
    return isZone(entity) ? PLACEMENT_KIND.ZONE : PLACEMENT_KIND.ANNOTATION
  }
  if (entity instanceof AnnotatedPoint ||
      entity instanceof AnnotatedLine) return PLACEMENT_KIND.ANNOTATION
  if (entity instanceof Solid)           return PLACEMENT_KIND.SOLID
  if (entity instanceof ImportedMesh)    return PLACEMENT_KIND.IMPORTED_MESH
  if (entity instanceof MeasureLine)     return PLACEMENT_KIND.MEASURE_LINE
  if (entity instanceof Profile)         return PLACEMENT_KIND.PROFILE
  if (entity instanceof CoordinateFrame) {
    return isRobotBaseFrame(entity)
      ? PLACEMENT_KIND.ROBOT_BASE_FRAME
      : PLACEMENT_KIND.COORDINATE_FRAME
  }
  return null
}

/**
 * 種の宣言された方針。未宣言の種は throw する — 実体種を足すときに配置方針を
 * 決めないことは、テストの失敗であって黙った `free` ではない (原則 #31)。
 *
 * @param {string} kind  `PLACEMENT_KIND` メンバ
 * @returns {string} `PLACEMENT` メンバ
 */
export function placementFor(kind) {
  // `Object.prototype.hasOwnProperty.call` rather than `Object.hasOwn`: this file
  // is inside the typechecked `src/domain/**` scope, which targets ES2020.
  if (!Object.prototype.hasOwnProperty.call(PLACEMENT_BY_KIND, kind)) {
    throw new Error(
      `[placement] no declared placement policy for kind "${kind}". ` +
      'Add a row to PLACEMENT_BY_KIND — a policy nobody declared is the defect ADR-097 removes.',
    )
  }
  return PLACEMENT_BY_KIND[kind]
}

/**
 * 実体の配置方針。分類できない実体 (SpatialLink 等、pose を持たないもの) は
 * `free` を返す — これは既定ではなく「支持の概念を持たない」の宣言である。
 *
 * @param {*} entity
 * @returns {string} `PLACEMENT` メンバ
 */
export function placementOf(entity) {
  const kind = placementKindOf(entity)
  return kind === null ? PLACEMENT.FREE : placementFor(kind)
}

/**
 * その方針の実体は面に載るか (= 支持を問う意味があるか)。`supported` と `resting`。
 *
 * S2 までは `hasGroundInvariant` と呼んでいた — 「床を持つ」と「面に載る」が同じ
 * 方針語 (`grounded`) に入っていたからである。床は所属から来るようになったので
 * (`floorOf`)、この問いが答えるのは「載る」だけになった (ADR-170 S2)。
 */
export function restsOnSurfaces(placement) {
  return placement === PLACEMENT.SUPPORTED || placement === PLACEMENT.RESTING
}

/**
 * **stack assist の適用可否は種ではなく方針が決める** (ADR-098 §Decision 1)。
 *
 * ADR-097 は `_applyStackSnap` から「床を作る」責務を剥がしたが、残った補助
 * (`SceneService._applyStackAssist`) には `instanceof Solid` の門が 2 枚残っていた。
 * 帰結として方針表の `grounded` (S2 以降 `resting`) が種によって 2 つの意味を持っていた —
 * Solid では「床を割らない**かつ**直下の面に載る」、robot_base では
 * 「床を割らない**だけ**」。当事者の「キューブはスタックするのにロボットは
 * スタックしない」は、方針の差ではなく**同じ方針語の下に別実装が残っていた**
 * ことの現れである。
 *
 * 除外の理由が「種」から「方針」へ移るのがこの関数の意味であって、判定そのものは
 * `restsOnSurfaces` と一致する — 面に載る実体はすべて「何かの上に載せる」補助の
 * 対象になる。同じ述語を 2 本書くと第二の源になる (§1.1) ので **委譲**する。
 *
 * ADR-098 はここに「将来この 2 つの問いが分かれたとき、分岐点はここ 1 箇所」と
 * 書いた。分かれたのは別の 2 つだった (ADR-170 S2): **床**と**載る**。床は所属へ
 * 移り (`floorOf`)、載る補助は方針に残る — 何も定義していないシーンの箱も積み上がる。
 *
 * @param {string} placement `PLACEMENT` メンバ
 * @returns {boolean}
 */
export function stackAssistApplies(placement) {
  return restsOnSurfaces(placement)
}

// ── 支持プローブの宣言 (ADR-098 §Decision 2) ────────────────────────────────

/**
 * 足跡 (XY サンプル) の取り方。
 *
 * `NONE` は「プローブを持たない」の**宣言**であって既定ではない — `PLACEMENT.FREE`
 * と同じ扱い (原則 #31)。
 */
export const FOOTPRINT_PROBE = Object.freeze({
  /** 最下面の corners + その重心。屋根の縁をまたぐ底面が角だけで浮かないように重心も見る。 */
  BOTTOM_FACE_AND_CENTROID: 'bottomFaceAndCentroid',
  /** world 原点 1 点。CF は足跡を持たない — 立っているのは原点である (ADR-085)。 */
  ORIGIN_POINT:             'originPoint',
  /** 足跡の概念を持たない。 */
  NONE:                     'none',
})

/** 最下点 Z の取り方。値の意味は `FOOTPRINT_PROBE` と対。 */
export const BOTTOM_PROBE = Object.freeze({
  MIN_CORNER_Z: 'minCornerZ',
  ORIGIN_Z:     'originZ',
  NONE:         'none',
})

/**
 * 種ごとに**宣言された**支持プローブ (ADR-098 §Decision 2)。
 *
 * ## なぜ方針表の隣に居るのか
 *
 * 「この種の底はどこか」は、ADR-097 以前は `SceneService._footprintSamplesOf` /
 * `_bottomZOf` が `instanceof CoordinateFrame` で答えていた。ADR-097 は
 * 「`instanceof` の連鎖が在ってよい唯一の場所は `placementKindOf()`」と決めたのに、
 * この 2 つは**方針表と同じ問いに別の場所で答え続けていた** (§1.1 の第二の源)。
 *
 * 症状の非対称がその証拠になる: 種を足したとき、方針表は throw して気づかせるが、
 * プローブは黙って `corners = []` → `null` を返して「支持なし」に見せる
 * (原則 #31 — 不在は検査対象のノードを持たない)。
 *
 * robot_base の底が base 原点である根拠は ADR-085 (`world → robot_base → tcp` の
 * TF で base 原点が床に立つ)。ここで新しく決めるのではなく既存の決定を**写す**。
 */
export const SUPPORT_PROBE_BY_KIND = Object.freeze({
  [PLACEMENT_KIND.ANNOTATION]:       Object.freeze({ footprint: FOOTPRINT_PROBE.BOTTOM_FACE_AND_CENTROID, bottom: BOTTOM_PROBE.MIN_CORNER_Z }),
  [PLACEMENT_KIND.ZONE]:             Object.freeze({ footprint: FOOTPRINT_PROBE.BOTTOM_FACE_AND_CENTROID, bottom: BOTTOM_PROBE.MIN_CORNER_Z }),
  [PLACEMENT_KIND.SOLID]:            Object.freeze({ footprint: FOOTPRINT_PROBE.BOTTOM_FACE_AND_CENTROID, bottom: BOTTOM_PROBE.MIN_CORNER_Z }),
  [PLACEMENT_KIND.IMPORTED_MESH]:    Object.freeze({ footprint: FOOTPRINT_PROBE.BOTTOM_FACE_AND_CENTROID, bottom: BOTTOM_PROBE.MIN_CORNER_Z }),
  [PLACEMENT_KIND.ROBOT_BASE_FRAME]: Object.freeze({ footprint: FOOTPRINT_PROBE.ORIGIN_POINT,             bottom: BOTTOM_PROBE.ORIGIN_Z    }),
  [PLACEMENT_KIND.COORDINATE_FRAME]: Object.freeze({ footprint: FOOTPRINT_PROBE.ORIGIN_POINT,             bottom: BOTTOM_PROBE.ORIGIN_Z    }),
  // 計測線は「二点の間」に在る。断面はスケッチ平面の上に在り、その平面は床とは
  // 限らない — どちらも底を持たないことの宣言であって、未記入ではない。
  [PLACEMENT_KIND.MEASURE_LINE]:     Object.freeze({ footprint: FOOTPRINT_PROBE.NONE, bottom: BOTTOM_PROBE.NONE }),
  [PLACEMENT_KIND.PROFILE]:          Object.freeze({ footprint: FOOTPRINT_PROBE.NONE, bottom: BOTTOM_PROBE.NONE }),
})

/** プローブを持たない実体の宣言 (分類できない実体の答え)。 */
const NO_PROBE = Object.freeze({ footprint: FOOTPRINT_PROBE.NONE, bottom: BOTTOM_PROBE.NONE })

/**
 * 種ごとに**宣言された**「支える側になれるか」(ADR-102 §Decision 2)。
 *
 * ## なぜこの行が必要だったか (見つかり方が要点)
 *
 * `SUPPORT_PROBE_BY_KIND` が答えるのは「この種の**底**はどこか」= 載る側の問い。
 * その鏡像である「この種は**面**を差し出すか」= 支える側の問いは、宣言されないまま
 * `SceneService.highestSurfaceAt()` の `!(o instanceof MeasureLine)` という
 * 1 個の門に残っていた。ADR-097 が「`instanceof` の連鎖が在ってよい唯一の場所は
 * `placementKindOf()`」と決め、ADR-098 が載る側の門を 2 枚外した後も、支える側は
 * 誰も見ていなかった。
 *
 * **人が気づいたのではない。** ADR-102 が pose 決定の**呼び出し閉包**を母集団として
 * 数えさせた初回に、この門が「分類されていない種分岐」として落ちてきた。ADR-098 が
 * 自分で予告した「8 つ目のプローブが増えたら数えられない」— その 8 つ目は増えたのでは
 * なく、**最初から表の外に在った**。*在るもの* (表の 7 行) を辿る検査が構造的に
 * 見ないのはこの形である (原則 #31)。
 *
 * 非対称が欠陥の証拠: 種を足したとき載る側 (`supportProbeFor`) は throw して
 * 気づかせるが、支える側は黙って「支持面ではない」に落ちる = 新しい種の上には
 * 何も載らない、と誰も宣言していないのに決まる。
 */
export const SUPPORT_SURFACE_BY_KIND = Object.freeze({
  // 建物・取り込み形状・マップ注釈 (床板・屋根) は上に物が載る面を持つ。
  [PLACEMENT_KIND.ANNOTATION]:       true,
  // ゾーンの板は床板 — 上に注釈を描ける面である (ゾーンでない Region と同じ)。
  [PLACEMENT_KIND.ZONE]:             true,
  [PLACEMENT_KIND.SOLID]:            true,
  [PLACEMENT_KIND.IMPORTED_MESH]:    true,
  // フレームは空間の目印であって面ではない。robot_base も同様 — ロボットは床に
  // 立つが、その原点の上に何かが載る面は存在しない (ADR-085)。実際の描画でも
  // CF は cuboid メッシュを持たないので、この宣言は現状の挙動の**明文化**である。
  [PLACEMENT_KIND.ROBOT_BASE_FRAME]: false,
  [PLACEMENT_KIND.COORDINATE_FRAME]: false,
  // 計測線は二点の間に在る線であって面ではない (退役した instanceof の門が
  // 唯一名指ししていた種)。断面は押し出し前の 2D で、厚みを持たない。
  [PLACEMENT_KIND.MEASURE_LINE]:     false,
  [PLACEMENT_KIND.PROFILE]:          false,
})

/**
 * 種は支持面を差し出すか。未宣言の種は throw する — `supportProbeFor()` /
 * `placementFor()` と同じ形であることに意味がある (原則 #31 — 種ごとの既定表は
 * 未宣言の種で throw し、「宣言された既定」と「誰も考えなかった種」を区別する)。
 *
 * @param {string} kind `PLACEMENT_KIND` メンバ
 * @returns {boolean}
 */
export function providesSupportSurfaceFor(kind) {
  if (!Object.prototype.hasOwnProperty.call(SUPPORT_SURFACE_BY_KIND, kind)) {
    throw new Error(
      `[placement] no declared support surface for kind "${kind}". ` +
      'Add a row to SUPPORT_SURFACE_BY_KIND — an undeclared kind silently answers ' +
      '"nothing lands on me", which is a decision nobody made (ADR-102).',
    )
  }
  return SUPPORT_SURFACE_BY_KIND[kind]
}

/**
 * 実体は支持面を差し出すか。分類できない実体 (SpatialLink 等) は差し出さない —
 * `placementOf()` が `free` を、`supportProbeOf()` が `NO_PROBE` を返すのと同じ扱い。
 *
 * @param {*} entity
 * @returns {boolean}
 */
export function providesSupportSurface(entity) {
  const kind = placementKindOf(entity)
  return kind === null ? false : providesSupportSurfaceFor(kind)
}

/**
 * 種の宣言された支持プローブ。未宣言の種は throw する — `placementFor()` と同じ形
 * であることに意味がある (原則 #31)。
 *
 * @param {string} kind `PLACEMENT_KIND` メンバ
 * @returns {{footprint: string, bottom: string}}
 */
export function supportProbeFor(kind) {
  if (!Object.prototype.hasOwnProperty.call(SUPPORT_PROBE_BY_KIND, kind)) {
    throw new Error(
      `[placement] no declared support probe for kind "${kind}". ` +
      'Add a row to SUPPORT_PROBE_BY_KIND — an undeclared probe silently answers ' +
      '"no support", which is the defect ADR-098 removes.',
    )
  }
  return SUPPORT_PROBE_BY_KIND[kind]
}

/**
 * 実体の支持プローブ。分類できない実体 (SpatialLink 等) は「持たない」の宣言を
 * 返す — `placementOf()` が `free` を返すのと同じ扱い。
 *
 * @param {*} entity
 * @returns {{footprint: string, bottom: string}}
 */
export function supportProbeOf(entity) {
  const kind = placementKindOf(entity)
  return kind === null ? NO_PROBE : supportProbeFor(kind)
}

/**
 * 最下面の corners — 最小 Z から `SUPPORT_TOLERANCE` 以内のものだけ。
 * 傾いた実体では側面の輪郭ではなく**接地している面**が足跡である。
 * @param {{x:number,y:number,z:number}[]} corners
 */
function bottomFaceCorners(corners) {
  if (!corners?.length) return []
  const minZ = corners.reduce((lo, c) => Math.min(lo, c.z), Infinity)
  return corners.filter(c => Math.abs(c.z - minZ) < SUPPORT_TOLERANCE)
}

/**
 * **宣言どおりに足跡を取る純粋関数** — 幾何は呼び手が渡す (原則 #3)。
 *
 * `SceneService` 側は宣言を読んで幾何を渡すだけの薄い実行系になり、種の分岐を
 * 持たない。未知のプローブ値で throw するのは、種ごとの既定表が未宣言の種で
 * throw するのと同じ理由 — fall-through は「宣言された既定」と「誰も考えなかった
 * 値」を区別不能にする (原則 #31)。
 *
 * @param {{footprint: string}} probe
 * @param {object} geometry
 * @param {{x:number,y:number,z:number}[]} [geometry.corners]
 * @param {{x:number,y:number,z:number}|null} [geometry.worldPosition]
 * @returns {{x:number,y:number}[]}
 */
export function footprintSamplesFor(probe, { corners = [], worldPosition = null } = {}) {
  const kind = probe?.footprint
  if (kind === FOOTPRINT_PROBE.NONE) return []
  if (kind === FOOTPRINT_PROBE.ORIGIN_POINT) {
    return worldPosition ? [{ x: worldPosition.x, y: worldPosition.y }] : []
  }
  if (kind === FOOTPRINT_PROBE.BOTTOM_FACE_AND_CENTROID) {
    const face = bottomFaceCorners(corners)
    if (face.length === 0) return []
    const samples = face.map(c => ({ x: c.x, y: c.y }))
    const cx = samples.reduce((a, s) => a + s.x, 0) / samples.length
    const cy = samples.reduce((a, s) => a + s.y, 0) / samples.length
    samples.push({ x: cx, y: cy })
    return samples
  }
  throw new Error(
    `[placement] unknown footprint probe "${kind}". ` +
    'Every FOOTPRINT_PROBE member needs a branch here — a fall-through would ' +
    'make an unconsidered value indistinguishable from a declared one.',
  )
}

/**
 * **宣言どおりに最下点 Z を取る純粋関数**。`footprintSamplesFor` と対。
 *
 * @param {{bottom: string}} probe
 * @param {object} geometry
 * @param {{x:number,y:number,z:number}[]} [geometry.corners]
 * @param {{x:number,y:number,z:number}|null} [geometry.worldPosition]
 * @returns {number|null} 底を持たない宣言なら null
 */
export function bottomZFor(probe, { corners = [], worldPosition = null } = {}) {
  const kind = probe?.bottom
  if (kind === BOTTOM_PROBE.NONE) return null
  if (kind === BOTTOM_PROBE.ORIGIN_Z) return worldPosition ? worldPosition.z : null
  if (kind === BOTTOM_PROBE.MIN_CORNER_Z) {
    if (!corners?.length) return null
    return corners.reduce((lo, c) => Math.min(lo, c.z), Infinity)
  }
  throw new Error(
    `[placement] unknown bottom probe "${kind}". ` +
    'Every BOTTOM_PROBE member needs a branch here (see footprintSamplesFor).',
  )
}

/** そのプローブが world 原点を要るか (呼び手が幾何を集めるときの判定)。 */
export function probeNeedsWorldOrigin(probe) {
  return probe?.footprint === FOOTPRINT_PROBE.ORIGIN_POINT ||
         probe?.bottom    === BOTTOM_PROBE.ORIGIN_Z
}

/**
 * **方針の適用** (ADR-097 §Decision 3) — 要求された world delta を、方針が
 * 許す delta へ写す純粋関数。ハンドラが持っていた clamp はすべてここに集まる。
 *
 * 方針ごとの規則:
 *   free      : 素通し。
 *   supported : 入力の Z を捨て、行き先の支持面 `supportZ` へ底面を座らせる。
 *               `supportZ` が null (支持面が求まらない) なら Z を動かさない —
 *               推測で浮かせない。
 *   resting   : 床 (`floorZ`) があれば Z は上向きにのみ clamp する (底面が床を割らない)。
 *               `floorZ` が null (どこにも属さない — ADR-170 D4) か `belowGradeIntent`
 *               が立っていれば素通し (G3 — 宣言された床下)。
 *               床が物の**上に**後から来た場合 (所属の宣言・ゾーンを上げた — S2 Q3) は
 *               動かさない・沈めない・引き上げない: 守る床は `min(floorZ, startBottomZ)`。
 *               床より下に居る物を次の掴みで床まで跳ね上げない (ADR-169 の押し出しと同じ規則)。
 *
 * `resting` が「床へ吸い付く」のではなく「床を割らない」だけなのは意図的で、
 * 上から載せる補助 (stack assist, ADR-071) と役割を分けるため。床は方針が持ち、
 * 「他の実体の上に載せる」は補助が持つ。
 *
 * @param {object}  p
 * @param {string}  p.placement          `PLACEMENT` メンバ
 * @param {number|null} [p.floorZ]      `resting` のみ: 物の床 (`floorOf`)。null = 床なし
 * @param {boolean} [p.belowGradeIntent] 床下を宣言済みか (`resting` かつ床があるときのみ意味を持つ)
 * @param {{x:number,y:number,z:number}} p.requested  ハンドラが求めた world delta
 * @param {number}  p.startBottomZ       セグメント開始時点の最下点 Z
 * @param {number|null} [p.supportZ]     行き先 XY 直下の支持面 Z (地面込みなので通常 >= 0)
 * @param {string|null} [p.elevationRefusal] `level` のみ: この Z の変更を拒む理由 (ADR-170 D5)。null = 許す
 * @returns {{x:number, y:number, z:number}} 適用後の world delta
 */
export function resolvePlacementDelta({
  placement,
  floorZ = null,
  belowGradeIntent = false,
  requested,
  startBottomZ,
  supportZ = null,
  elevationRefusal = null,
}) {
  assertPlacementWord(placement)
  const { x, y, z } = requested
  if (placement === PLACEMENT.FREE) return { x, y, z }

  // level (ADR-170): Z moves only when asked — a drag on the horizontal plane
  // asks for none. A height that would put a member on two floors (D5) is
  // refused by keeping the plate where it is; the caller says why (原則 #11).
  if (placement === PLACEMENT.LEVEL) return { x, y, z: elevationRefusal ? 0 : z }

  if (placement === PLACEMENT.SUPPORTED) {
    // 支持面が求まらないうちは Z を動かさない (推測で浮かせない — 原則 #11)。
    if (supportZ === null || !Number.isFinite(supportZ)) return { x, y, z: 0 }
    return { x, y, z: supportZ - startBottomZ }
  }

  // resting — the floor comes from belonging, not from the kind (ADR-170 S2)
  if (floorZ === null || !Number.isFinite(floorZ) || belowGradeIntent) return { x, y, z }
  // 底面が床を割らない最小の Z。上へは自由に動ける。床より下から始まった物は
  // その高さを床とする — 沈めないが、引き上げもしない (S2 Q3)。
  const floor = Math.min(floorZ, startBottomZ)
  return { x, y, z: Math.max(z, floor - startBottomZ) }
}

/**
 * **形を変える操作にも同じ床** (ADR-169) — 面を法線方向へ押し出す距離を、方針が
 * 許す距離へ写す純粋関数。`resolvePlacementDelta` の「形」版。
 *
 * 押し出しは pose ではなく形を変えるが、床を割る点では並進と同じ事故になる
 * (割れた底は次の Grab で床 clamp に引き上げられ、跳ねる)。
 * 並進と同じく**床で止める** — 床下は S で宣言してから (G3)。持ち上げはしない:
 * 底面を下へ引いた人に「本体が上へ逃げる」を返すのは、要求の符号を裏返すことになる。
 *
 * 動くのは面の頂点だけで、各頂点は `z + normalZ·d` へ行く。各頂点が守る床は
 * `min(floorZ, z)` — 始めから床下にある頂点 (宣言の無い古いデータ・後から上に来た床)
 * を**それ以上**沈めないだけで、引き上げはしない (要求していない動きを作らない)。
 *
 * 床は方針ではなく所属から来る (ADR-170 S2) ので、この関数は方針を受け取らない —
 * 床が在るか (`floorZ`) だけを問う。
 *
 *   床なし / 宣言済みの床下    : 素通し
 *   床あり                     : d を [lo, hi] へ clamp。
 *                                normalZ > 0 の頂点は d ≥ (floor − z)/normalZ、
 *                                normalZ < 0 の頂点は d ≤ (floor − z)/normalZ
 *   |normalZ| ≈ 0 (鉛直な面)   : Z が動かないので素通し
 *
 * @param {object}   p
 * @param {number|null} [p.floorZ]        物の床 (`floorOf`)。null = 床なし (どこにも属さない)
 * @param {boolean}  [p.belowGradeIntent]  床下を宣言済みか
 * @param {number[]} p.faceStartZs         動く面の頂点の world Z (操作開始時点)
 * @param {number}   p.normalZ             面法線 (world, 単位) の Z 成分
 * @param {number}   p.requested           要求された押し出し距離 (符号付き)
 * @returns {number} 適用する距離
 */
export function resolveFaceExtrudeDistance({
  floorZ = null,
  belowGradeIntent = false,
  faceStartZs,
  normalZ,
  requested,
}) {
  if (!Number.isFinite(requested)) return requested
  if (floorZ === null || !Number.isFinite(floorZ) || belowGradeIntent) return requested
  if (!Number.isFinite(normalZ) || Math.abs(normalZ) < 1e-9) return requested
  let lo = -Infinity
  let hi = Infinity
  for (const z of faceStartZs) {
    if (!Number.isFinite(z)) continue
    const bound = (Math.min(floorZ, z) - z) / normalZ
    if (normalZ > 0) lo = Math.max(lo, bound)
    else             hi = Math.min(hi, bound)
  }
  const d = Math.min(hi, Math.max(lo, requested))
  return d === 0 ? 0 : d   // never -0 (a stopped face would print "-0.000")
}

/**
 * 支持の**導出** (ADR-097 §Decision 2) — 保存フィールドにはしない。幾何が源で
 * あり、支持は幾何の関数である。保存すると「実体を動かしたが支持フィールドが
 * 古い」という第二の源のドリフトが生まれ、それは今日 mounts の Z 二重書き込みが
 * 起こしている事故と同型になる。
 *
 * 散文「never floating」がそのまま述語になる形:
 *   `placement === 'supported'` の実体は、pose 書き込み後に必ず非 null。
 *
 * @param {object} p
 * @param {number} p.bottomZ            実体の最下点 Z (world)
 * @param {number|null} p.surfaceZ      直下の最高面 Z (地面込み)。null = 走査不能
 * @param {string|null} [p.surfaceEntityId]  その面を持つ実体 id。null = 地面
 * @param {number} [p.tolerance]
 * @returns {{kind:'ground'}|{kind:'entity', id:string}|null}
 */
export function supportUnder({ bottomZ, surfaceZ, surfaceEntityId = null, tolerance = SUPPORT_TOLERANCE }) {
  if (surfaceZ === null || !Number.isFinite(surfaceZ) || !Number.isFinite(bottomZ)) return null
  if (Math.abs(bottomZ - surfaceZ) > tolerance) return null   // 浮いている / めり込んでいる
  return surfaceEntityId === null ? { kind: 'ground' } : { kind: 'entity', id: surfaceEntityId }
}

/**
 * **ドラッグ平面も方針から導く** (ADR-097 §Decision 5 / G2)。
 *
 * 実体種の分岐 (現在: 注釈だけ特別扱い) を方針の関数へ畳む。接地している実体は
 * 接地面に沿って滑り、自由な実体だけがカメラ正対面で動く。「カメラ平面で動かした
 * 結果を stack snap が Z で引き戻す」二重のねじれが、ここで消える。
 *
 * `resting` / `supported` の返り値が `cameraNormal` を**読まない**ことに意味が
 * ある — 接地面に沿う動きがカメラ姿勢に依存しないことが、関数の形から言える。
 *
 * @param {object} p
 * @param {string} p.placement
 * @param {{x:number,y:number,z:number}|null} [p.hostNormal]  mounts ホストの local Z (world 表現)
 * @param {{x:number,y:number,z:number}} p.cameraNormal
 * @returns {{x:number,y:number,z:number}} 平面法線
 */
export function dragPlaneNormalFor({ placement, hostNormal = null, cameraNormal }) {
  assertPlacementWord(placement)
  if (placement === PLACEMENT.FREE) return cameraNormal
  return hostNormal ?? { x: 0, y: 0, z: 1 }
}
