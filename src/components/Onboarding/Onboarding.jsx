import { useEffect } from 'react'
import { useUIStore } from '../../store/uiStore.js'

const HINTS = [
  {
    svg: `<svg width="44" height="44" viewBox="0 0 44 44" fill="none" stroke="#4fc3f7" stroke-width="2" stroke-linecap="round"><circle cx="22" cy="14" r="5"/><path d="M22 19 Q16 28 18 38"/><path d="M22 19 Q28 28 26 38"/></svg>`,
    text: 'ドラッグ  →  視点回転',
  },
  {
    svg: `<svg width="44" height="44" viewBox="0 0 44 44" fill="none" stroke="#4fc3f7" stroke-width="2" stroke-linecap="round"><circle cx="14" cy="14" r="4"/><circle cx="30" cy="14" r="4"/><path d="M14 18 Q14 32 14 36"/><path d="M30 18 Q30 32 30 36"/><path d="M10 24 L34 24" stroke-dasharray="3 3"/></svg>`,
    text: 'ピンチ  →  ズーム',
  },
  {
    svg: `<svg width="44" height="44" viewBox="0 0 44 44" fill="none" stroke="#81c784" stroke-width="2" stroke-linecap="round"><circle cx="22" cy="22" r="7" stroke-dasharray="2 2"/><circle cx="22" cy="22" r="2" fill="#81c784" stroke="none"/><line x1="22" y1="6" x2="22" y2="14"/><line x1="22" y1="30" x2="22" y2="38"/><line x1="6" y1="22" x2="14" y2="22"/><line x1="30" y1="22" x2="38" y2="22"/></svg>`,
    text: 'タップ  →  オブジェクト選択',
  },
  {
    svg: `<svg width="44" height="44" viewBox="0 0 44 44" fill="none" stroke="#ffb74d" stroke-width="2" stroke-linecap="round"><rect x="8" y="28" width="28" height="10" rx="2"/><circle cx="22" cy="14" r="5"/><line x1="22" y1="19" x2="22" y2="28"/></svg>`,
    text: '長押し  →  移動 (Grab)',
  },
]

export function Onboarding() {
  const visible        = useUIStore(s => s.onboardingVisible)
  const hideOnboarding = useUIStore(s => s.actions.hideOnboarding)

  const dismiss = () => {
    hideOnboarding()
    localStorage.setItem('ee_onboarded', '1')
  }

  useEffect(() => {
    if (!visible) return
    const timer = setTimeout(dismiss, 4000)
    return () => clearTimeout(timer)
  }, [visible])  // eslint-disable-line react-hooks/exhaustive-deps

  if (!visible) return null

  return (
    <div
      onPointerDown={dismiss}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.72)',
        zIndex: 500,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 28,
        padding: 32,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        color: '#e8e8e8',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        pointerEvents: 'auto',
      }}
    >
      {HINTS.map(({ svg, text }) => (
        <div
          key={text}
          style={{ display: 'flex', alignItems: 'center', gap: 18, width: '100%', maxWidth: 280 }}
        >
          <div
            style={{ flexShrink: 0 }}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
          <span style={{ fontSize: 15, lineHeight: 1.4 }}>{text}</span>
        </div>
      ))}
      <div style={{ marginTop: 8, fontSize: 13, color: '#888' }}>
        タップして閉じる
      </div>
    </div>
  )
}
