import { useUIStore } from '../../store/uiStore.js'
import { COLOR, rgba } from '../../theme/tokens.js'
import { WizardPanel } from '../Context/WizardPanel.jsx'
import { IntakePanel } from '../Context/IntakePanel.jsx'
import { BOTTOM_TIER, bottomEdgeOffset } from '../../view/EdgeOccupancy.js'
import { DOC_INTAKE_TAB, DOC_INTAKE_TABS, PROVISIONAL_UNTIL } from '../../view/DocIntake.js'
import { floorIsOpen } from '../../view/FloorTabs.js'

/**
 * DocIntakeLayer — 文書の入口 (Wizard / Intake) の**暫定住所** (ADR-106 D3)。
 *
 * これらは「入力」であって「解消」ではないので場のタブではない。行き先を名指し
 * しないまま器から外すと機能が無言で到達不能になる (原則 #11 / #16) ので、Phase 5
 * が最終的な住所を決めるまでのあいだ、ここが到達可能な住所になる。
 * **暫定であることは画面にも書いてある** — 宣言しない暫定は恒久になる。
 *
 * 住所の根拠は `view/DocIntake.js` (語彙と、なぜモーダルではないか)。
 * 一時オーバーレイなので画面端の予算には参加しないが、下端の占有だけは
 * 唯一の所有者から引く (場が開いていれば場の上に立つ — 原則 #26 / D6)。
 */
export function DocIntakeLayer() {
  const docIntake = useUIStore(s => s.docIntake)
  const callbacks = useUIStore(s => s.callbacks)
  const floorOpen = useUIStore(floorIsOpen)
  const setTab    = useUIStore(s => s.actions.setDocIntake)

  if (!docIntake) return null

  const isMobile = window.innerWidth < 768
  const bottom   = bottomEdgeOffset({ isMobile, tier: BOTTOM_TIER.DOCK, floorOpen })

  return (
    <div style={{
      position:   'fixed',
      top:        '40px',
      left:       '0',
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

      {/* An undeclared provisional address becomes a permanent one. This line is
          the declaration, and it is on screen rather than only in a doc because
          the people who would notice it hardening are the people using it. */}
      <div style={{
        padding: '4px 10px', borderTop: `1px solid ${COLOR.border}`,
        fontSize: '9px', color: COLOR.textSecondary, lineHeight: 1.5,
      }}>
        Provisional address — the document entrances are being consolidated in {PROVISIONAL_UNTIL}.
      </div>
    </div>
  )
}
