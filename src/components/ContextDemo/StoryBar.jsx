import { useUIStore } from '../../store/uiStore.js'

/**
 * StoryBar — step navigation for the Context DSL demo (ADR-047).
 *
 * Bottom-center overlay: step dots ①–⑥, title + narration, Back/Next, ✕ exit.
 * Next is disabled at step ④ until the interval Decision is approved — the
 * UI expression of "intervals never collapse silently" (controller double-guards).
 * Only the bar itself captures pointer events; orbit/select stay usable.
 */
export function StoryBar() {
  const demo      = useUIStore(s => s.demo)
  const callbacks = useUIStore(s => s.callbacks)

  const isMobile = window.innerWidth < 768
  const last     = demo.steps.length - 1
  const stepInfo = demo.steps[demo.step] ?? { title: '', narration: '' }

  // Gate: leaving step ④ requires the interval decision to be approved.
  const intervalDecision = demo.decisions.find(d => {
    const fact = demo.facts.find(f => f.ref === d.resolves)
    return Array.isArray(fact?.quantity?.interval)
  })
  const gated = demo.step === 3 && intervalDecision && !demo.approvedDecisions[intervalDecision.ref]
  const nextDisabled = demo.step >= last || gated

  return (
    <div style={{
      position:     'fixed',
      left:         '50%',
      transform:    'translateX(-50%)',
      bottom:       isMobile ? '96px' : '36px',  // above mobile toolbar / InfoBar
      width:        'min(620px, calc(100vw - 24px))',
      background:   'rgba(24, 26, 30, 0.96)',
      border:       '1px solid #3a3a3a',
      borderRadius: '10px',
      padding:      '10px 14px',
      zIndex:       100,
      color:        '#e8e8e8',
      fontFamily:   'system-ui, -apple-system, sans-serif',
      boxShadow:    '0 4px 24px rgba(0,0,0,0.5)',
      pointerEvents: 'auto',
      boxSizing:    'border-box',
    }}>
      {/* Step dots + exit */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '6px' }}>
        <div style={{ display: 'flex', gap: '6px', flex: 1 }}>
          {demo.steps.map((_, i) => (
            <div key={i} style={{
              width: '8px', height: '8px', borderRadius: '50%',
              background: i === demo.step ? '#3a7bd5' : i < demo.step ? '#2a5a9a' : '#3a3a3a',
            }} />
          ))}
        </div>
        <span style={{ fontSize: '10px', color: '#777', marginRight: '10px', fontFamily: 'monospace' }}>
          {demo.step + 1}/{demo.steps.length} · ADR-046
        </span>
        <button
          aria-label="Exit demo"
          onClick={() => callbacks.onDemoExit?.()}
          style={{
            background: 'transparent', border: 'none', color: '#888', cursor: 'pointer',
            fontSize: '16px', lineHeight: '1', padding: '2px 4px',
          }}
        >
          ✕
        </button>
      </div>

      <div style={{ fontWeight: 'bold', fontSize: '13px', marginBottom: '3px' }}>
        {stepInfo.title}
      </div>
      <div style={{ fontSize: '12px', color: '#b8b8b8', lineHeight: '1.6', minHeight: '38px' }}>
        {stepInfo.narration}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px' }}>
        <NavBtn
          disabled={demo.step === 0}
          onClick={() => callbacks.onDemoStepChange?.(demo.step - 1)}
        >
          ← 戻る
        </NavBtn>
        {gated && (
          <span style={{ alignSelf: 'center', fontSize: '11px', color: '#f59e0b' }}>
            Decision の承認が必要です
          </span>
        )}
        <NavBtn
          primary
          disabled={nextDisabled}
          onClick={() => callbacks.onDemoStepChange?.(demo.step + 1)}
        >
          次へ →
        </NavBtn>
      </div>
    </div>
  )
}

function NavBtn({ onClick, disabled, primary = false, children }) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        padding:      '6px 16px',
        background:   primary && !disabled ? '#3a7bd5' : 'transparent',
        border:       `1px solid ${primary && !disabled ? '#3a7bd5' : '#3a3a3a'}`,
        borderRadius: '5px',
        color:        disabled ? '#555' : primary ? '#fff' : '#bbb',
        cursor:       disabled ? 'default' : 'pointer',
        fontSize:     '12px',
        fontFamily:   'inherit',
        opacity:      disabled ? 0.6 : 1,
      }}
    >
      {children}
    </button>
  )
}
