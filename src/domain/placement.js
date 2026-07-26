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
 * ## 3 つの方針
 *
 *   supported : 必ず何かの上。支持を失う pose は存在できない。Z は支持面から
 *               導出され、入力の Z 成分は捨てる。
 *   grounded  : 床下へは行けない。ただし belowGradeIntent を立てれば行ける。
 *   free      : 自由。支持の概念を持たない。
 *
 * `free` は既定ではない。**種ごとに表で宣言する**のがこの決定の要点で、新しい
 * 実体種を足すときにこの欄を空にできない (原則 #31 — 正当な「支持なし」は
 * 推論させず宣言させる)。`placementFor()` は未宣言の種で throw する。
 *
 * ## この木が成立する範囲
 *
 * 支持の導出は下向きレイに依存するので、扱えるのは**水平支持面だけ**である
 * (壁面・天井・傾斜面へのマウントは表現できない — ADR-097 §受け入れるコスト)。
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

/** 接地判定の許容 (1 mm) — stack snap の rest tolerance と同じ値。 */
export const SUPPORT_TOLERANCE = 0.001

/** 配置方針の語彙 (ADR-097 §Decision 1)。 */
export const PLACEMENT = Object.freeze({
  SUPPORTED: 'supported',
  GROUNDED:  'grounded',
  FREE:      'free',
})

/**
 * 方針表が引かれる「種」。全メンバが `PLACEMENT_BY_KIND` に行を持たねばならず、
 * *在るもの*を辿るのではなく**列挙して個数を検査**する (原則 #31)。
 */
export const PLACEMENT_KIND = Object.freeze({
  /** AnnotatedPoint / AnnotatedLine / AnnotatedRegion — マップオブジェクト。 */
  ANNOTATION:        'annotation',
  /** Solid — 押し出された建物・部品。 */
  SOLID:             'solid',
  /** ImportedMesh — STEP 等の取り込み形状。 */
  IMPORTED_MESH:     'importedMesh',
  /** robot_base CF — ロボットが立つ床は実在する床である (ADR-083)。 */
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
  // 基礎・杭・ピットは正当な要求なので禁止しない — 宣言させる (G3)。
  [PLACEMENT_KIND.SOLID]:            PLACEMENT.GROUNDED,
  [PLACEMENT_KIND.IMPORTED_MESH]:    PLACEMENT.GROUNDED,
  // ロボットが床に埋まった状態でコアAPI へ base pose を送っても解は無意味 (ADR-083)。
  [PLACEMENT_KIND.ROBOT_BASE_FRAME]: PLACEMENT.GROUNDED,
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
  if (entity instanceof AnnotatedPoint ||
      entity instanceof AnnotatedLine  ||
      entity instanceof AnnotatedRegion) return PLACEMENT_KIND.ANNOTATION
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

/** その方針が床の不変条件を持つか (= 支持を問う意味があるか)。 */
export function hasGroundInvariant(placement) {
  return placement === PLACEMENT.SUPPORTED || placement === PLACEMENT.GROUNDED
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
 *   grounded  : Z は上向きにのみ clamp する (底面が床を割らない)。
 *               `belowGradeIntent` が立っていれば素通し (G3 — 宣言された床下)。
 *
 * `grounded` が「床へ吸い付く」のではなく「床を割らない」だけなのは意図的で、
 * 上から載せる補助 (stack assist, ADR-071) と役割を分けるため。床は方針が持ち、
 * 「他の実体の上に載せる」は補助が持つ。
 *
 * @param {object}  p
 * @param {string}  p.placement          `PLACEMENT` メンバ
 * @param {boolean} [p.belowGradeIntent] 床下を宣言済みか (`grounded` のみ意味を持つ)
 * @param {{x:number,y:number,z:number}} p.requested  ハンドラが求めた world delta
 * @param {number}  p.startBottomZ       セグメント開始時点の最下点 Z
 * @param {number|null} [p.supportZ]     行き先 XY 直下の支持面 Z (地面込みなので通常 >= 0)
 * @returns {{x:number, y:number, z:number}} 適用後の world delta
 */
export function resolvePlacementDelta({
  placement,
  belowGradeIntent = false,
  requested,
  startBottomZ,
  supportZ = null,
}) {
  const { x, y, z } = requested
  if (placement === PLACEMENT.FREE) return { x, y, z }

  if (placement === PLACEMENT.SUPPORTED) {
    // 支持面が求まらないうちは Z を動かさない (推測で浮かせない — 原則 #11)。
    if (supportZ === null || !Number.isFinite(supportZ)) return { x, y, z: 0 }
    return { x, y, z: supportZ - startBottomZ }
  }

  // grounded
  if (belowGradeIntent) return { x, y, z }
  // 底面が床 (Z=0) を割らない最小の Z。上へは自由に動ける。
  return { x, y, z: Math.max(z, -startBottomZ) }
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
 * `grounded` / `supported` の返り値が `cameraNormal` を**読まない**ことに意味が
 * ある — 接地面に沿う動きがカメラ姿勢に依存しないことが、関数の形から言える。
 *
 * @param {object} p
 * @param {string} p.placement
 * @param {{x:number,y:number,z:number}|null} [p.hostNormal]  mounts ホストの local Z (world 表現)
 * @param {{x:number,y:number,z:number}} p.cameraNormal
 * @returns {{x:number,y:number,z:number}} 平面法線
 */
export function dragPlaneNormalFor({ placement, hostNormal = null, cameraNormal }) {
  if (placement === PLACEMENT.FREE) return cameraNormal
  return hostNormal ?? { x: 0, y: 0, z: 1 }
}
