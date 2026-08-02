/**
 * EdgeOccupancy — 画面端の占有オフセットを計算する**唯一の場所** (左端・上端)。
 *
 * 原則 #26: 画面端は共有資源であり、そこへ固定される要素は端を占有する。占有量の
 * 計算は 1 箇所が持ち、**呼び出し箇所ごとにパッチを当てない**。
 *
 * ## 端ごとに所有者が分かれている理由 (ADR-105 D6)
 *
 * 右端の所有者は `AppController._updateGizmoOffset()` である。あちらは N パネルと
 * チュートリアル Inspector の**開閉で動く**ので、ストア購読を持つ statefull な
 * 所有者になっている (ADR-047 / ADR-103)。
 *
 * 左端と上端は動かない — desktop の Outliner は常設 (ドロワーではない)、ヘッダは
 * 常に 40px である。したがって所有者は**純粋関数**でよく、右端と 1 つにまとめる
 * 理由が無い。ADR-105 の GSN が「上端と左上は互いに素なので所有者を共有する必要が
 * ないかもしれない」と反証形で書いた通りで、実測の結果そちらが正しかった。
 * **所有者は 2 つに分かれるが、どちらも 1 つである** — 禁じているのは所有者が
 * 複数あることではなく、同じ端の占有量が複数箇所で計算されることである。
 *
 * ここに来る前、左端の `188px` は `LinkNetworkView.setMobile()` に literal として
 * 1 箇所だけ在った。2 つ目の占有者 (ADR-105 の KPI HUD) が生まれる瞬間が、
 * literal が計算へ昇格すべき瞬間である (2 箇所目を書いてからでは遅い)。
 */

/** desktop の Outliner サイドバー幅 (常設・不透明・z:90)。 */
const OUTLINER_WIDTH = 180
/** 端に張り付いた要素と占有物のあいだの余白。 */
const EDGE_GAP = 8
/** ヘッダ (fixed top, h:40px)。 */
const HEADER_HEIGHT = 40

/**
 * 左端に張り付く要素の `left` (px)。
 *
 * desktop は Outliner の**隣**に座る (後ろではない — Outliner は不透明)。
 * mobile の Outliner はドロワーなので端そのものが空いている。
 *
 * @param {{isMobile: boolean}} occupancy
 * @returns {number}
 */
export function leftEdgeOffset({ isMobile }) {
  return isMobile ? EDGE_GAP : OUTLINER_WIDTH + EDGE_GAP
}

/**
 * ヘッダ直下に張り付く要素の `top` (px)。
 * @returns {number}
 */
export function belowHeaderOffset() {
  return HEADER_HEIGHT + 6
}
