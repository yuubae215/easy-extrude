/**
 * EdgeOccupancy — 画面端の占有オフセットを計算する**唯一の場所** (左端・上端・下端)。
 *
 * 原則 #26: 画面端は共有資源であり、そこへ固定される要素は端を占有する。占有量の
 * 計算は 1 箇所が持ち、**呼び出し箇所ごとにパッチを当てない**。
 *
 * ## 端ごとに所有者が分かれている理由 (ADR-105 D6)
 *
 * 右端の所有者は `AppController._updateGizmoOffset()` である。あちらは N パネルの
 * **開閉で動く**ので、ストア購読を持つ statefull な所有者になっている (ADR-103)。
 *
 * 左端と上端は動かない — desktop の Outliner は常設 (ドロワーではない)、ヘッダは
 * 常に 40px である。したがって所有者は**純粋関数**でよく、右端と 1 つにまとめる
 * 理由が無い。ADR-105 の GSN が「上端と左上は互いに素なので所有者を共有する必要が
 * ないかもしれない」と反証形で書いた通りで、実測の結果そちらが正しかった。
 * **所有者は 2 つに分かれるが、どちらも 1 つである** — 禁じているのは所有者が
 * 複数あることではなく、同じ端の占有量が複数箇所で計算されることである。
 *
 * ここに来る前、左端の `188px` は `LinkNetworkView` に literal として
 * 1 箇所だけ在った。2 つ目の占有者 (ADR-105 の KPI HUD) が生まれる瞬間が、
 * literal が計算へ昇格すべき瞬間である (2 箇所目を書いてからでは遅い)。
 *
 * ## 下端 (ADR-106 D6) — 右端で起きたことを下端で繰り返さない
 *
 * ADR-106 は場 (解消の器) を右端 280px の縦ストリップから**下部の展開パネル**へ
 * 移した。下端には既に InfoBar (26px)・モバイルツールバー (60px)・LINK NETWORK・
 * StoryBar・Toast が住んでおり、場が開けば必ず干渉する。右端で起きた病気は
 * 「同じ 1 つの衝突に、互いに知らない 3 つの回避策 (ずらす / 消す / 被せる) が
 * 当たっていた」ことなので、**器を動かす前に**下端の所有者を置く — 後から置くと、
 * その時点で既に書かれたパッチを剥がす作業になり、剥がし残しが緑を出す。
 *
 * 下端が右端と違うのは、占有物が**積み重なる**ことである。InfoBar の上にモバイル
 * ツールバーが乗り、その上に場が開き、その上に浮遊要素が乗る。したがって
 * 「下端の占有量」は 1 つの数ではなく**段 (tier) の関数**になる。段は
 * `BOTTOM_TIER` に列挙し、**未宣言の段では throw する** (原則 #31 — fall-through は
 * 「宣言された既定」と「誰も考えなかった段」を区別不能にする)。
 */

/** desktop の Outliner サイドバー幅 (常設・不透明・z:90)。 */
const OUTLINER_WIDTH = 180
/** 端に張り付いた要素と占有物のあいだの余白。 */
const EDGE_GAP = 8
/** ヘッダ (fixed top, h:40px)。 */
const HEADER_HEIGHT = 40
/** InfoBar (fixed bottom, h:26px)。場が開いても**動かない** (ADR-106 D1 / 原則 #15)。 */
const INFOBAR_HEIGHT = 26
/** モバイルツールバー (InfoBar の直上, h:60px)。desktop には存在しない。 */
const MOBILE_TOOLBAR_HEIGHT = 60
/**
 * 中央に浮く StoryBar / 場のヘッダが要求する縦の余地。Toast はこれを跨いで
 * 上に出る (Toast と StoryBar はどちらも画面中央下なので、同じ段に置けない)。
 */
const CENTRE_BAR_RESERVE = 62

/** 下部の場 (ADR-106 D1) の高さ。3D を覆い切らない — 覆うならモーダルである。 */
const FLOOR_HEIGHT = { desktop: 260, mobile: 220 }

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

// ── 下端 (ADR-106 D6) ────────────────────────────────────────────────────────

/**
 * 下端の**段**。名前は「何の上に座るか」を言う。
 *
 * 段は宣言であって推論ではない。新しい下端の住人は必ずこのどれかを名乗る —
 * 名乗れないなら段が足りていないので、`bottom` に literal を書くのではなく
 * ここに段を足す (それが原則 #26 の「1 箇所で計算する」の実体)。
 */
export const BOTTOM_TIER = Object.freeze({
  /** InfoBar の直上 (= モバイルツールバー自身の住所)。場より下に居る。 */
  ABOVE_INFOBAR: 'above-infobar',
  /** 場そのものの住所 — InfoBar とモバイルツールバーの上、自分自身は数えない。 */
  FLOOR: 'floor',
  /** 端に密着する常設パネル (Outliner / N パネル)。余白を取らない。 */
  DOCK: 'dock',
  /** 浮遊する要素 (LINK NETWORK / StoryBar)。DOCK + 余白。 */
  FLOATING: 'floating',
  /** Toast — 画面中央下で StoryBar / 場のヘッダと重なるので、その分だけ高く出る。 */
  TOAST: 'toast',
})

/**
 * 段ごとの**追加の持ち上げ量** (px) と、その段が場の高さを含むか。
 *
 * `EXPLICIT_DEFAULTS` / `PLACEMENT_BY_KIND` と同じ既定表の規律: 表に無い段は
 * 既定へ落ちず throw する。
 */
const BOTTOM_TIER_LIFT = Object.freeze({
  [BOTTOM_TIER.ABOVE_INFOBAR]: { toolbar: false, floor: false, gap: 0 },
  [BOTTOM_TIER.FLOOR]:         { toolbar: true,  floor: false, gap: 0 },
  [BOTTOM_TIER.DOCK]:          { toolbar: true,  floor: true,  gap: 0 },
  [BOTTOM_TIER.FLOATING]:      { toolbar: true,  floor: true,  gap: EDGE_GAP },
  [BOTTOM_TIER.TOAST]:         { toolbar: true,  floor: true,  gap: EDGE_GAP + CENTRE_BAR_RESERVE },
})

/**
 * 下部の場の高さ (px)。場の器自身も、場の上に乗る要素も、同じここを読む。
 *
 * @param {{isMobile: boolean}} viewport
 * @returns {number}
 */
export function floorHeight({ isMobile }) {
  return isMobile ? FLOOR_HEIGHT.mobile : FLOOR_HEIGHT.desktop
}

/**
 * 下端に張り付く要素の `bottom` (px) — **下端の占有量を計算する唯一の場所**。
 *
 * @param {object} occupancy
 * @param {boolean} occupancy.isMobile
 * @param {string}  occupancy.tier       `BOTTOM_TIER` のいずれか
 * @param {boolean} [occupancy.floorOpen=false]  下部の場が開いているか (`context.active`)
 * @returns {number}
 */
export function bottomEdgeOffset({ isMobile, tier, floorOpen = false }) {
  const lift = BOTTOM_TIER_LIFT[tier]
  if (!lift) {
    // 未宣言の段では throw する (原則 #31)。既定で埋めると、誰も考えなかった
    // 住人が「たまたま InfoBar の上」に置かれ、場が開いた日に沈黙で隠れる。
    throw new Error(
      `EdgeOccupancy: 未宣言の下端の段 "${tier}" — BOTTOM_TIER に段を足すこと。` +
      'bottom に literal を書くのは原則 #26 違反 (下端は共有資源で、占有量の計算は 1 箇所)')
  }
  return INFOBAR_HEIGHT
    + (lift.toolbar && isMobile ? MOBILE_TOOLBAR_HEIGHT : 0)
    + (lift.floor && floorOpen ? floorHeight({ isMobile }) : 0)
    + lift.gap
}
