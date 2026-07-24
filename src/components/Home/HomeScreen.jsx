import { useState } from 'react'
import { useUIStore } from '../../store/uiStore.js'
import { LAYOUT_TEMPLATE_CATALOG } from '../../layout/LayoutTemplateCatalog.js'
import { useReducedMotion } from '../Feedback/FeedbackPrimitives.jsx'
import { enterMotion } from '../../view/ChromeMath.js'

/**
 * HomeScreen — the app's launch / Home overlay (ADR-089, screen S-19).
 *
 * Shown on startup (unless skipped via `ee_home`) over the BootReveal stage, so
 * the first move is *recognition* — pick a process layout — instead of *recall*
 * on a blank canvas. This is the **Layout DSL** entry, distinct from the Context
 * DSL New Project gallery (ADR-051 / TemplateGallery.jsx).
 *
 * State: `uiStore.home` (`null | { status:'open' }`), sole writer AppController.
 * This component only reads and fires callbacks:
 *   onSelectLayoutTemplate(id) — load a layout template (scene replacement)
 *   onStartEmptyProject()      — close onto the default boot scene (Empty card)
 *   onToggleHomeSkip(bool)     — persist the Blender-style skip preference
 *   onCloseHome()              — ✕ (close onto whatever scene is loaded)
 *
 * The entrance is Tier D delight via `enterMotion`; under reduced motion the
 * final state is the whole show (PHILOSOPHY #30/#11). Card hover is Tier B
 * affordance. The overlay does NOT dismiss on backdrop click — a launch choice
 * is deliberate (Empty is an explicit card / ✕).
 */
export function HomeScreen() {
  const home      = useUIStore(s => s.home)
  const callbacks = useUIStore(s => s.callbacks)
  const reduced   = useReducedMotion()

  // The skip preference authority is localStorage (ee_home); mirror it into the
  // checkbox once so toggling reflects the persisted setting.
  const [skip, setSkip] = useState(() => {
    try { return localStorage.getItem('ee_home') === 'skip' } catch { return false }
  })

  if (home?.status !== 'open') return null

  const select = (id) => callbacks.onSelectLayoutTemplate?.(id)
  const empty  = () => callbacks.onStartEmptyProject?.()
  const close  = () => callbacks.onCloseHome?.()
  const toggleSkip = (checked) => {
    setSkip(checked)
    callbacks.onToggleHomeSkip?.(checked)
  }

  const groups = []
  for (const t of LAYOUT_TEMPLATE_CATALOG) {
    let g = groups.find(x => x.category === t.category)
    if (!g) { g = { category: t.category, items: [] }; groups.push(g) }
    g.items.push(t)
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 300,
        // Semi-transparent scrim so the living BootReveal stage glows behind the
        // launch screen (ADR-089 §1 — a living stage, not a dead splash).
        background: 'radial-gradient(120% 100% at 50% 0%, rgba(20,26,36,0.62), rgba(8,10,14,0.82))',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        pointerEvents: 'auto',
      }}
    >
      <div
        style={{
          width: 'min(760px, 94vw)', maxHeight: '90vh',
          display: 'flex', flexDirection: 'column',
          background: 'rgba(26,28,32,0.96)', border: '1px solid #3a3a3a', borderRadius: '10px',
          boxShadow: '0 12px 48px rgba(0,0,0,0.6)', overflow: 'hidden',
          ...enterMotion(reduced),
        }}
      >
        <div style={{
          padding: '18px 22px 14px', borderBottom: '1px solid #333',
          display: 'flex', alignItems: 'baseline',
        }}>
          <div>
            <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#eaeaea', letterSpacing: '0.01em' }}>
              easy-extrude
            </div>
            <div style={{ marginTop: '4px', fontSize: '12px', color: '#9a9a9a' }}>
              工程レイアウトを選んで始める — まず近い構成を選び、あとから調整
            </div>
          </div>
          <button
            onClick={close}
            title="閉じる（既定のシーンで始める）"
            style={{
              marginLeft: 'auto', background: 'transparent', border: 'none',
              color: '#999', cursor: 'pointer', fontSize: '20px', lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 22px' }}>
          {groups.map(group => (
            <div key={group.category} style={{ marginBottom: '18px' }}>
              <div style={{
                fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.06em',
                color: '#777', marginBottom: '9px',
              }}>
                {group.category}
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                gap: '11px',
              }}>
                {group.items.map(t => {
                  const isEmpty = t.source.kind === 'empty'
                  return (
                    <button
                      key={t.id}
                      onClick={() => (isEmpty ? empty() : select(t.id))}
                      style={{
                        textAlign: 'left', cursor: 'pointer',
                        background: isEmpty ? 'transparent' : '#2b2d31',
                        border: `1px ${isEmpty ? 'dashed' : 'solid'} #3a3a3a`,
                        borderRadius: '8px', padding: '13px 15px', color: '#e0e0e0',
                        fontFamily: 'inherit', display: 'flex', flexDirection: 'column', gap: '6px',
                        transition: reduced ? 'none' : 'border-color 120ms ease, transform 120ms ease',
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.borderColor = '#3a7bd5'
                        if (!reduced) e.currentTarget.style.transform = 'translateY(-1px)'
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.borderColor = '#3a3a3a'
                        e.currentTarget.style.transform = 'none'
                      }}
                    >
                      <span style={{
                        fontSize: '14px', fontWeight: 'bold',
                        color: isEmpty ? '#9a9a9a' : '#7fb2ff',
                      }}>
                        {t.name}
                      </span>
                      <span style={{ fontSize: '11.5px', color: '#a8a8a8', lineHeight: 1.55 }}>
                        {t.description}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        <div style={{
          padding: '11px 22px', borderTop: '1px solid #333',
          display: 'flex', alignItems: 'center', gap: '10px',
          fontSize: '11px', color: '#8a8a8a', lineHeight: 1.5,
        }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', userSelect: 'none' }}>
            <input
              type="checkbox"
              checked={skip}
              onChange={e => toggleSkip(e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
            起動時に表示しない
          </label>
          <span style={{ marginLeft: 'auto', color: '#666' }}>
            テンプレを選ぶと現在のシーンを置き換えます
          </span>
        </div>
      </div>
    </div>
  )
}
