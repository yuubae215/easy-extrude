/**
 * declaredPose — 確定したジェスチャから「文書に書く姿勢」を取り出す (ADR-129 D1)。
 *
 * ## なぜ実体種ごとの宣言表なのか
 *
 * Layout DSL の `position` は種によって**意味が違う**:
 *
 *   - `Solid` — 世界座標の body-frame 重心 (`_position`, ADR-040)
 *   - `CoordinateFrame` — 親を持つなら**親からの局所オフセット** (`translation`)、
 *     親が無いならそれがそのまま世界姿勢 (`LayoutCompiler` の CF 分岐)
 *   - `AnnotatedPoint` — 世界座標の点
 *
 * 呼び出し側で `obj._position ?? obj.translation` と書くと、この違いが *偶然*
 * 吸収される。偶然は次の種が来た日に破れ、しかも**破れたことが値として妥当に見える**
 * (局所座標を世界座標として書いても、数は数である)。だから種を列挙し、
 * **未宣言の種で throw** する — 「宣言された既定」と「誰も考えなかった種」を
 * 区別不能にしない (原則 #31 / ADR-096 の既定表規律)。
 *
 * ## 書かない欄は書かない
 *
 * Grab は位置を確定するが向きについては何も言っていない。そこへ恒等回転を書くと
 * 「向けていない」が「ゼロに向けた」に化ける (原則 #31)。だからこの module が返す
 * のは**述べられた欄だけ**を持つ疎なオブジェクトで、`DocBuilder.setEntityPose` は
 * 在る欄しか書かない。
 *
 * 純粋 (THREE 非依存): 実体の種は呼び出し側が `instanceof` で決めて**名前として**
 * 渡す。ここで `instanceof` すると domain クラス経由で THREE が入り、node の
 * test runner から読めなくなる。
 *
 * @module domain/declaredPose
 */

/** Layout DSL が使う実体種の名前 (`LayoutCompiler.generateObjects` の分岐と同じ語)。 */
export const POSE_ENTITY_KIND = Object.freeze({
  SOLID:            'Solid',
  COORDINATE_FRAME: 'CoordinateFrame',
  ANNOTATED_POINT:  'AnnotatedPoint',
})

/**
 * **宣言表** — 種ごとに「確定した姿勢をどこから読むか」。
 *
 * `read` は純粋: シーン実体を受け、述べられた欄だけを持つ疎な pose を返す。
 */
const DECLARED_POSE_BY_KIND = Object.freeze({
  [POSE_ENTITY_KIND.SOLID]: Object.freeze({
    why:  '世界座標の body-frame 重心 (ADR-040 の primary triple)。向きは別の動詞 (R) が述べる',
    read: (obj) => sparse(obj?._position, obj?.orientation),
  }),
  [POSE_ENTITY_KIND.COORDINATE_FRAME]: Object.freeze({
    why:  '親を持つなら局所オフセット、親が無ければ世界姿勢。どちらも translation / rotation に住む',
    read: (obj) => sparse(obj?.translation, obj?.rotation),
  }),
  [POSE_ENTITY_KIND.ANNOTATED_POINT]: Object.freeze({
    why:  '世界座標の点。向きを持たないので rotation は述べられない',
    read: (obj) => sparse(obj?.position ?? obj?._position, null),
  }),
})

/** 宣言表が覆っている種 (検査が母集団として引く)。 */
export const DECLARED_POSE_KINDS = Object.freeze(Object.keys(DECLARED_POSE_BY_KIND))

/**
 * 確定した姿勢を、文書に書ける形で取り出す。**未宣言の種で throw する。**
 *
 * @param {string} kind `POSE_ENTITY_KIND` の値
 * @param {object} obj  シーン実体
 * @returns {{position?: {x:number,y:number,z:number},
 *            rotation?: {x:number,y:number,z:number,w:number}}}
 * @throws {Error} 未宣言の種
 */
export function declaredPoseOf(kind, obj) {
  const decl = DECLARED_POSE_BY_KIND[kind]
  if (!decl) {
    throw new Error(
      `declaredPose: 未宣言の実体種 "${kind}"。DECLARED_POSE_BY_KIND に行を足すこと — ` +
      'Layout DSL の position は種によって意味が違う (世界座標 / 親からの局所オフセット) ので、' +
      'fall-through は局所座標を世界座標として書き、その誤りは値として妥当に見える (原則 #31 / ADR-129 D1)。',
    )
  }
  return decl.read(obj)
}

/** 述べられた欄だけを持つ疎な pose (無い欄は**書かない** — 原則 #31)。 */
function sparse(position, rotation) {
  const out = {}
  if (position && Number.isFinite(position.x)) {
    out.position = { x: position.x, y: position.y, z: position.z }
  }
  if (rotation && Number.isFinite(rotation.w)) {
    out.rotation = { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w }
  }
  return out
}
