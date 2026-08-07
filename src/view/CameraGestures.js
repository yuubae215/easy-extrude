/**
 * CameraGestures — カメラの自由度と、それを動かすタッチジェスチャの**対応表**
 * (ADR-114 D2)。
 *
 * ## なぜ表が要るか — 0 は状態に見えない (原則 #31)
 *
 * ここに来る前、割当は `SceneView` の構築子に 1 行の直値で在った:
 *
 * ```js
 * this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE }
 * ```
 *
 * この行は「1 本指は回す」「2 本指は寄せて回す」の 2 つを**宣言している**。
 * 宣言されていないのは pan で、**宣言されていないものは行として現れない**ので、
 * コードを読んでも「pan が無い」は見えない。実際 pan はアプリの出荷から
 * 一度も触れず、2 本指のドラッグは常に dolly + rotate を返していた。
 *
 * 数えるべきは「割り当てられたジェスチャ」ではなく「**割当を持たない自由度**」で、
 * *在る割当*を辿る読み方は定義上それを見ない。したがって母集団を自由度の側
 * (`CAMERA_DOF`) に置き、表が全射であることを機械に問わせる。
 *
 * ## 2 本指ローテートを失うこと
 *
 * `DOLLY_ROTATE` → `DOLLY_PAN` は 2 本指の回転を捨てる。捨ててよいのは
 * **1 本指が既に回している**からで、失うのは重複であって能力ではない。逆に
 * `DOLLY_ROTATE` のままでは pan に割ける指が残らない (3 本指は発見されない —
 * 原則 #16 の発見可能性を成果物として払えない)。
 *
 * @see docs/adr/ADR-114-reachable-is-not-declared.md
 */

import * as THREE from 'three'

/**
 * カメラが持つ自由度。**母集団はこちら側**にある — 割当表ではなく。
 *
 * 3 つで閉じているのは軌道カメラ (OrbitControls) の定義による: 注視点まわりの
 * 回転・注視点との距離・注視点そのものの平行移動。ロール軸は `camera.up` が
 * 固定されているので存在しない (ROS world frame, +Z up)。
 */
export const CAMERA_DOF = Object.freeze({
  /** 注視点まわりに回る。 */
  ORBIT: 'orbit',
  /** 注視点との距離を変える。 */
  DOLLY: 'dolly',
  /** 注視点そのものを平行移動する。 */
  PAN:   'pan',
})

/** タッチのジェスチャ語彙。 */
export const TOUCH_GESTURE = Object.freeze({
  ONE_FINGER_DRAG:  'one-finger-drag',
  TWO_FINGER_PINCH: 'two-finger-pinch',
  TWO_FINGER_DRAG:  'two-finger-drag',
})

/**
 * 自由度 → タッチジェスチャ。**全射でなければならない** (各自由度に必ず 1 つ)。
 *
 * 2 本指がピンチとドラッグの 2 役なのは OrbitControls の `DOLLY_PAN` がそう
 * 実装されているため — 指の間隔が変われば dolly、平行に動けば pan で、同一
 * ジェスチャの中で連続的に切り替わる。したがって「2 本指」に 2 行あるのは
 * 衝突ではない。
 */
export const TOUCH_DOF_ASSIGNMENT = Object.freeze({
  [CAMERA_DOF.ORBIT]: TOUCH_GESTURE.ONE_FINGER_DRAG,
  [CAMERA_DOF.DOLLY]: TOUCH_GESTURE.TWO_FINGER_PINCH,
  [CAMERA_DOF.PAN]:   TOUCH_GESTURE.TWO_FINGER_DRAG,
})

/**
 * その自由度を動かすタッチジェスチャ。未宣言の自由度では **throw する**。
 *
 * fall-through させると「宣言された既定」と「誰も割り当てなかった自由度」が
 * 区別不能になる (原則 #31) — それがこの module の存在理由なので、ここで
 * 既定へ落ちるのは自己矛盾である。
 *
 * @param {string} dof `CAMERA_DOF` のいずれか
 * @returns {string} `TOUCH_GESTURE` のいずれか
 */
export function touchGestureFor(dof) {
  const gesture = TOUCH_DOF_ASSIGNMENT[dof]
  if (!gesture) {
    throw new Error(
      `CameraGestures: 自由度 "${dof}" にタッチジェスチャの割当が無い — ` +
      'TOUCH_DOF_ASSIGNMENT に行を足すこと。割当の無い自由度は「触れない」であって「既定」ではない')
  }
  return gesture
}

/**
 * 上の割当を OrbitControls の `touches` 形へ翻訳したもの。
 *
 * **翻訳であって第二の宣言ではない** — 自由度の割当を変えたければ
 * `TOUCH_DOF_ASSIGNMENT` を変える。ここは同じ事実の別表現 (§1.1)。
 *
 * @returns {{ONE: number, TWO: number}}
 */
export function orbitControlsTouches() {
  // 全射を実際に読む: 3 つとも割当を持つことを確認してから翻訳する。表を
  // 読まずに定数を返すと、表が空になっても緑を出す (宣言の空回り)。
  const orbit = touchGestureFor(CAMERA_DOF.ORBIT)
  const dolly = touchGestureFor(CAMERA_DOF.DOLLY)
  const pan   = touchGestureFor(CAMERA_DOF.PAN)

  if (orbit !== TOUCH_GESTURE.ONE_FINGER_DRAG) {
    throw new Error(`CameraGestures: 1 本指が orbit 以外に割り当てられている (${orbit}) — 翻訳先が無い`)
  }
  if (dolly !== TOUCH_GESTURE.TWO_FINGER_PINCH || pan !== TOUCH_GESTURE.TWO_FINGER_DRAG) {
    throw new Error(
      `CameraGestures: 2 本指の割当 (dolly=${dolly}, pan=${pan}) が DOLLY_PAN と一致しない — ` +
      'OrbitControls の touches はこの 2 つを 1 つのジェスチャとして扱うので、別々には割り当てられない')
  }
  return { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }
}
