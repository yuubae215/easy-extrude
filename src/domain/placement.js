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
 * **stack assist の適用可否は種ではなく方針が決める** (ADR-098 §Decision 1)。
 *
 * ADR-097 は `_applyStackSnap` から「床を作る」責務を剥がしたが、残った補助
 * (`SceneService._applyStackAssist`) には `instanceof Solid` の門が 2 枚残っていた。
 * 帰結として方針表の `grounded` が種によって 2 つの意味を持っていた —
 * Solid では「床を割らない**かつ**直下の面に載る」、robot_base では
 * 「床を割らない**だけ**」。当事者の「キューブはスタックするのにロボットは
 * スタックしない」は、方針の差ではなく**同じ方針語の下に別実装が残っていた**
 * ことの現れである。
 *
 * 除外の理由が「種」から「方針」へ移るのがこの関数の意味であって、判定そのものは
 * `hasGroundInvariant` と一致する — 床の不変条件を持つ実体はすべて「何かの上に
 * 載せる」補助の対象になる。同じ述語を 2 本書くと第二の源になる (§1.1) ので
 * **委譲**する。将来この 2 つの問いが分かれたときに、分岐点はここ 1 箇所になる。
 *
 * @param {string} placement `PLACEMENT` メンバ
 * @returns {boolean}
 */
export function stackAssistApplies(placement) {
  return hasGroundInvariant(placement)
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
