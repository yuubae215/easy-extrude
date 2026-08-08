import { useUIStore } from '../../store/uiStore.js'
import { COLOR, rgba } from '../../theme/tokens.js'
import { WizardPanel } from '../Context/WizardPanel.jsx'
import { IntakePanel } from '../Context/IntakePanel.jsx'
import { BOTTOM_TIER, bottomEdgeOffset, transientOverlayLeft } from '../../view/EdgeOccupancy.js'
import { DOC_INTAKE_TAB, DOC_INTAKE_TABS, mayCoverRole } from '../../view/DocIntake.js'
import { NAVIGATOR_ROLES } from '../../view/NavigatorSides.js'
import { floorIsOpen } from '../../view/FloorTabs.js'
import { isNarrowViewport } from '../../view/Viewport.js'

/**
 * DocIntakeLayer — 文書の入口 (Wizard / Intake) の**恒久住所** (ADR-112)。
 *
 * これらは「入力」であって「解消」ではないので場のタブではない (ADR-106 D3)。
 * その移設のとき住所は**期限つきの留保**として宣言されたが、ADR-112 が決着させ恒久になった —
 * 見直す理由を探して出てこなかったからである。留保の宣言 (期限の定数と
 * 画面下部の但し書き) は更新ではなく**削除**された。
 *
 * 住所の根拠は `view/DocIntake.js` (語彙と、なぜモーダルではないか)。
 * 一時オーバーレイなので画面端の予算には参加しないが、下端の占有だけは
 * 唯一の所有者から引く (場が開いていれば場の上に立つ — 原則 #26 / D6)。
 *
 * ## 覆う範囲は面の**役割**で決まる (ADR-112 D2)
 *
 * 「Outliner を覆う」という*面の名前*での規則は、ADR-111 が意味側を置いた日に
 * 表せなくなった — 同じ Outliner の中で幾何側は覆ってよく、意味側は覆えない
 * (フォームを埋めながら、いま入力している文書の変数が見えなくなる)。だから
 * 役割表に問う。判断の所有者は `mayCoverRole` 1 つで、ここは答えを使うだけである。
 *
 * **問うのは「器が見せうる役割」であって「いま見せている役割」ではない** —
 * 側を切り替えるスイッチ自体が覆われる側に住んでいるので、いま幾何側だからと
 * 覆うと意味側へ行く手段が消える (`NAVIGATOR_ROLES` の節に実測の経緯)。だから
 * ここは `outlinerSide` を読まない: 現在の側で分岐しないことが、規則が描き手へ
 * 写っていないことの証拠でもある。
 */
export function DocIntakeLayer() {
  const docIntake = useUIStore(s => s.docIntake)
  const callbacks = useUIStore(s => s.callbacks)
  const floorOpen = useUIStore(floorIsOpen)
  const setTab    = useUIStore(s => s.actions.setDocIntake)

  if (!docIntake) return null

  const isMobile = isNarrowViewport()
  const bottom   = bottomEdgeOffset({ isMobile, tier: BOTTOM_TIER.DOCK, floorOpen })
  // 未宣言の役割は throw する — 3 つ目の役割が生まれた日に「覆ってよい」へ
  // 黙って落ちない (原則 #31)。
  const left     = transientOverlayLeft({
    isMobile,
    clearLeftDock: NAVIGATOR_ROLES.some(role => !mayCoverRole(role)),
  })

  return (
    <div style={{
      position:   'fixed',
      top:        '40px',
      left:       `${left}px`,
      bottom:     `${bottom}px`,
      width:      isMobile ? '100vw' : '420px',
      background: rgba(COLOR.surface, 0.98),
      borderRight: `1px solid ${COLOR.border}`,
      // Transient overlay (like the Template Gallery), so it may sit above the
      // permanent left dock — it is not a second permanent occupant of that edge.
      zIndex:     120,
      display:    'flex',
      flexDirection: 'column',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize:   '12px',
      color:      COLOR.textPrimary,
      pointerEvents: 'auto',
      boxSizing:  'border-box',
    }}>
      <div style={{ padding: '8px 10px 4px', display: 'flex', alignItems: 'baseline' }}>
        <span style={{ fontWeight: 'bold', color: COLOR.textPrimary }}>Document intake</span>
        <span style={{ marginLeft: '6px', fontSize: '10px', color: COLOR.textSecondary }}>
          build the context the floor negotiates over
        </span>
        <button
          onClick={() => callbacks.onCloseDocIntake?.()}
          title="Close (committed entries stay in the document)"
          style={{
            marginLeft: 'auto', background: 'transparent', border: 'none',
            color: COLOR.textSecondary, cursor: 'pointer', fontSize: '14px', lineHeight: '1',
            padding: '0 2px',
          }}
        >
          ✕
        </button>
      </div>

      <div style={{ display: 'flex', borderBottom: `1px solid ${COLOR.border}` }}>
        {DOC_INTAKE_TABS.map(tab => {
          const active = docIntake.tab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setTab(tab.id)}
              title={tab.blurb}
              style={{
                padding: '6px 14px', background: 'transparent', border: 'none',
                borderBottom: `2px solid ${active ? COLOR.infoTone : 'transparent'}`,
                color: active ? COLOR.infoTone : COLOR.textSecondary, cursor: 'pointer', fontSize: '11px',
                fontFamily: 'inherit', whiteSpace: 'nowrap',
              }}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 8px' }}>
        {docIntake.tab === DOC_INTAKE_TAB.WIZARD && <WizardPanel />}
        {docIntake.tab === DOC_INTAKE_TAB.INTAKE && <IntakePanel />}
      </div>
    </div>
  )
}
