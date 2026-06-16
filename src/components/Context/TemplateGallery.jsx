import { useUIStore } from '../../store/uiStore.js'
import { TEMPLATE_CATALOG } from '../../context/TemplateCatalog.js'

/**
 * TemplateGallery — starter-template picker modal (ADR-051 Phase 2, Entry B).
 *
 * A transient full-screen overlay (z-index above all edge panels — PHILOSOPHY
 * #26) that lists the static `TEMPLATE_CATALOG`. Selecting a card fires
 * `onSelectTemplate(id)`; ContextController resolves it to a canonical doc and
 * loads it through ContextService (the single authoritative load path — ADR-051
 * §2 / PHILOSOPHY #1). The footer states the scene-replacement consequence up
 * front (ADR-051 §7 transparency) so no second confirm dialog is needed.
 */

const CARD_BORDER = '1px solid #3a3a3a'

export function TemplateGallery() {
  const open      = useUIStore(s => s.templateGalleryOpen)
  const callbacks = useUIStore(s => s.callbacks)

  if (!open) return null

  const close  = () => callbacks.onCloseTemplateGallery?.()
  const select = (id) => callbacks.onSelectTemplate?.(id)

  // Group templates by category, preserving catalog order.
  const groups = []
  for (const t of TEMPLATE_CATALOG) {
    let g = groups.find(x => x.category === t.category)
    if (!g) { g = { category: t.category, items: [] }; groups.push(g) }
    g.items.push(t)
  }

  return (
    <div
      onClick={close}
      style={{
        position: 'fixed', inset: 0, zIndex: 300,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        pointerEvents: 'auto',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 'min(720px, 92vw)', maxHeight: '86vh',
          display: 'flex', flexDirection: 'column',
          background: '#222', border: '1px solid #444', borderRadius: '8px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)', overflow: 'hidden',
        }}
      >
        <div style={{
          padding: '14px 18px', borderBottom: CARD_BORDER,
          display: 'flex', alignItems: 'baseline',
        }}>
          <span style={{ fontSize: '15px', fontWeight: 'bold', color: '#e8e8e8' }}>
            テンプレートから開始
          </span>
          <span style={{ marginLeft: '8px', fontSize: '11px', color: '#888' }}>
            スターター .ctx.json を起点化 (ADR-051 §3 Entry B)
          </span>
          <button
            onClick={close}
            title="閉じる"
            style={{
              marginLeft: 'auto', background: 'transparent', border: 'none',
              color: '#999', cursor: 'pointer', fontSize: '18px', lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px' }}>
          {groups.map(group => (
            <div key={group.category} style={{ marginBottom: '16px' }}>
              <div style={{
                fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.06em',
                color: '#777', marginBottom: '8px',
              }}>
                {group.category}
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                gap: '10px',
              }}>
                {group.items.map(t => (
                  <button
                    key={t.id}
                    onClick={() => select(t.id)}
                    style={{
                      textAlign: 'left', cursor: 'pointer',
                      background: '#2a2a2a', border: CARD_BORDER, borderRadius: '6px',
                      padding: '12px 14px', color: '#e0e0e0',
                      fontFamily: 'inherit', display: 'flex', flexDirection: 'column', gap: '6px',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = '#323232'
                      e.currentTarget.style.borderColor = '#3a7bd5'
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = '#2a2a2a'
                      e.currentTarget.style.borderColor = '#3a3a3a'
                    }}
                  >
                    <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#5a9bf5' }}>
                      {t.name}
                    </span>
                    <span style={{ fontSize: '11px', color: '#aaa', lineHeight: 1.5 }}>
                      {t.description}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div style={{
          padding: '10px 18px', borderTop: CARD_BORDER,
          fontSize: '10px', color: '#888', lineHeight: 1.5,
        }}>
          テンプレートを選択すると現在のシーンは置き換えられ、選択した要求から再生成されます
          (3D は導出射影 — ADR-050 invariant 9 / ADR-051 §7)。
        </div>
      </div>
    </div>
  )
}
