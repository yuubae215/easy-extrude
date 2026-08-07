/**
 * Viewport — 「この画面は狭いレイアウトか」を答える**唯一の述語**、および
 * 対応を約束する最小幅の宣言。
 *
 * ## なぜ 1 箇所に要るか (§1.1)
 *
 * ここに来る前、同じ問いに **4 通りの答え**が並走していた:
 *
 * - `window.innerWidth < 768` — `Header` / `NPanel` / `MobileToolbar` / `UIShell` /
 *   `AppController._updateGizmoOffset()` (それぞれ独立に書かれた同じ式)
 * - `matchMedia('(max-width: 767px)')` — 上の 3 コンポーネントが**各自コピーした**
 *   `useIsMobile()` フック (同じ実装が 3 ファイルに在った)
 * - `matchMedia('(pointer: coarse)')` — `AppController._updateLinkNetworkEdges()` /
 *   `SemanticSuggestion` / `ImportProgress` が `bottomEdgeOffset({isMobile})` へ
 *   **入力の粗さ**を渡していた
 *
 * 3 番目は別の問いへの答えである。粗いポインタの広いタブレットは狭くないし、
 * 狭くしたデスクトップ窓は粗くない。`EdgeOccupancy` が受け取る `isMobile` は
 * **レイアウトの幅**を意味するので、そこへ入力の粗さを渡すと、モバイル
 * ツールバーが描かれていないのに 60px 退く / 描かれているのに退かない、が起きる。
 *
 * したがってこのファイルは**幅の問い**だけを持ち、入力の粗さは別の名前
 * (`hasFinePointer`) で答える。同じ関数に畳まない — 畳めるように見えるのは
 * 今日の端末分布がそうなっているだけで、それは規則ではない。
 *
 * ## 最小対応幅 (ADR-114)
 *
 * `MIN_SUPPORTED_WIDTH` は「この幅で全部の常設入口へ指が届く」と約束する下限。
 * 上端の幅予算 (`EdgeOccupancy.topEdgeFits`) はこの数に対して検査される。
 * 約束を下げる (= この定数を上げる) のは意図的な行為で、レビューで必ず目に入る。
 */

/** 狭いレイアウトへ切り替わる幅 (px)。この値未満が「狭い」。 */
export const MOBILE_BREAKPOINT = 768

/**
 * 対応を約束する最小のビューポート幅 (px)。
 *
 * 320px = iPhone SE (第1世代) / Galaxy S9+ の CSS ピクセル幅。今日の実機の下限で、
 * 「ここまでは全入口が画面内」を上端の幅予算が保証する対象。
 */
export const MIN_SUPPORTED_WIDTH = 320

/** 狭いレイアウトの media query 文字列 — 購読側が式を組み立て直さないための正本。 */
export const NARROW_MEDIA_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

/**
 * このビューポートは狭いレイアウトか。
 *
 * @param {number} [width] 省略時は `window.innerWidth`
 * @returns {boolean}
 */
export function isNarrowViewport(width = globalThis.window?.innerWidth ?? MOBILE_BREAKPOINT) {
  return width < MOBILE_BREAKPOINT
}

/**
 * この環境は精密ポインタ (マウス / トラックパッド) を持つか。
 *
 * **幅の問いではない。** hover 前提の affordance (原則 #13) や、ドラッグ精度を
 * 要求する操作の可否だけがこれを読む。レイアウトの寸法計算に渡してはならない。
 *
 * @returns {boolean}
 */
export function hasFinePointer() {
  return !globalThis.window?.matchMedia?.('(pointer: coarse)').matches
}
