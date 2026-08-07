/**
 * TapGesture — 「この 2 回目の押下は、意図された double-tap か」を答える
 * **唯一の述語** (ADR-114 D3)。純粋関数のみ (原則 #3)。
 *
 * ## 何が壊れていたか
 *
 * `AppController._onDblClick` はブラウザの `dblclick` をそのまま信じ、
 * `focusSelection()` (カメラをフィットさせる飛行) を呼んでいた。判定は 0 個で、
 * とくに次の 3 つを見ていなかった:
 *
 * 1. **移動量** — ブラウザは離れた 2 点のタップも `dblclick` にまとめる。指は
 *    マウスより滑るので、別々の選択のつもりの 2 タップが 1 つの double-tap に
 *    化ける。マウスの `dblclick` にも同じ穴はあるが、実害はタッチで出る。
 * 2. **あいだに起きたこと** — 1 本指ドラッグはカメラを回す。回してから指を離し、
 *    もう一度触ると、2 つの「タップ」に挟まれてオービットが起きている。それは
 *    double-tap ではない。
 * 3. **当たり** — 何にも当たらないタップでも `focusSelection()` は呼ばれ、
 *    `_focusSphere()` は選択が空だと**シーン全体**へフォールバックする。つまり
 *    空振りの誤爆が、取りうる中で最大のカメラ跳躍を起こしていた。
 *
 * ## なぜ述語を分けるか
 *
 * ハンドラの中にインライン early-return を並べると、条件はハンドラの数だけ
 * 増殖する (原則 #25 — ドメインの前提条件は名前付きの述語に集約する)。加えて
 * ブラウザ無しで表を焼けるので、「12px ずれた 2 タップ」「オービット後のタップ」を
 * 回帰として持てる。
 *
 * @see docs/adr/ADR-114-reachable-is-not-declared.md
 */

/**
 * 2 タップが同じ場所と見なされる最大距離 (CSS px)。
 *
 * 指の接触面は太いので、意図的な 2 度叩きでも数 px は動く。24px は Fitts 的な
 * タップ標的の半分よりやや小さい値で、「同じものを 2 回叩いた」と「隣を叩いた」を
 * 分ける線。マウスにも同じ線を使う (マウスなら実質いつも 0px なので無害)。
 */
export const DOUBLE_TAP_SLOP_PX = 24

/**
 * この double-tap を受理してよいか。
 *
 * @param {object} input
 * @param {{x:number, y:number}|null} input.firstTap  1 回目の押下位置 (無ければ null)
 * @param {{x:number, y:number}}      input.secondTap 2 回目 (= `dblclick` の位置)
 * @param {boolean} input.cameraMovedBetween  2 タップのあいだにカメラが動いたか
 * @param {boolean} input.hitSomething        2 回目のタップが実体に当たったか
 * @param {boolean} input.hasSelection        既に選択があるか
 * @returns {{accept: boolean, reason: string|null}}
 *   `accept:false` のとき `reason` は必ず非 null (無言で捨てない — 原則 #11。
 *   呼び手はこれを黙って握り潰してよいが、*なぜ*落としたかは常に言える)。
 */
export function acceptDoubleTap({
  firstTap, secondTap, cameraMovedBetween, hitSomething, hasSelection,
}) {
  if (cameraMovedBetween) {
    return { accept: false, reason: 'カメラが動いた 2 タップは double-tap ではない' }
  }
  if (firstTap) {
    const dx = secondTap.x - firstTap.x
    const dy = secondTap.y - firstTap.y
    if (Math.hypot(dx, dy) > DOUBLE_TAP_SLOP_PX) {
      return { accept: false, reason: `2 タップが ${DOUBLE_TAP_SLOP_PX}px 以上離れている` }
    }
  }
  // 当たりも選択も無いなら、フィット先はシーン全体になる。それは「何も指して
  // いない指」に対する最大の応答で、誤爆したときの被害が最も大きい形。
  // **明示的に選択されている**なら、空を叩いてそこへ戻すのは意図として読める。
  if (!hitSomething && !hasSelection) {
    return { accept: false, reason: '当たりも選択も無い — フィット先が「シーン全体」になる' }
  }
  return { accept: true, reason: null }
}
