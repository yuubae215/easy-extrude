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
 *
 * Structure preview (ADR-062 Phase 5): each example card shows a Why/How/What
 * stacked bar + node counts + the doc-signature prefix, all derived from the
 * ADR-056 canonical form (`templateGalleryPreviews`, pushed by the controller).
 * A card without a preview entry renders nothing extra — never a guessed
 * structure (PHILOSOPHY #11). Layer colours match WhyTreeView.
 */

const CARD_BORDER = '1px solid #3a3a3a'

/** 5W1H layer colours — kept identical to WhyTreeView's LAYER_META. */
const LAYER_COLOR = { why: '#5a9bf5', how: '#d59b3a', what: '#5aa86a' }

/** Mini structure preview strip on an example card (fact-fed, display-only). */
function StructurePreview({ preview }) {
  if (!preview) return null
  return (
    <div style={{ marginTop: '2px' }}>
      <div style={{ display: 'flex', height: '4px', borderRadius: '2px', overflow: 'hidden', background: '#333' }}>
        {preview.layers.map(l => l.count > 0 && (
          <div key={l.layer} title={`${l.layer}: ${l.count}`} style={{
            width: `${Math.max(l.fraction * 100, 2)}%`,
            background: LAYER_COLOR[l.layer] ?? '#777',
          }} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: '6px', marginTop: '3px', fontSize: '9px', color: '#888' }}>
        {preview.layers.map(l => (
          <span key={l.layer}>
            <span style={{ color: LAYER_COLOR[l.layer] ?? '#888' }}>●</span> {l.layer} {l.count}
          </span>
        ))}
        <span style={{ marginLeft: 'auto', fontFamily: 'monospace', color: '#666' }}>
          ⌗{preview.signature}
        </span>
      </div>
    </div>
  )
}

export function TemplateGallery() {
  const open      = useUIStore(s => s.templateGalleryOpen)
  const previews  = useUIStore(s => s.templateGalleryPreviews)
  const callbacks = useUIStore(s => s.callbacks)

  if (!open) return null

  const close  = () => callbacks.onCloseTemplateGallery?.()
  const select = (id) => callbacks.onSelectTemplate?.(id)
  const fork   = (id) => callbacks.onForkTemplate?.(id)

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
            New Project
          </span>
          <span style={{ marginLeft: '8px', fontSize: '11px', color: '#888' }}>
            Start from a blank project or a starter template
          </span>
          <button
            onClick={close}
            title="Close"
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
                {group.items.map(t => {
                  const forkable = t.source.kind === 'example'
                  return (
                    <div
                      key={t.id}
                      style={{
                        background: '#2a2a2a', border: CARD_BORDER, borderRadius: '6px',
                        display: 'flex', flexDirection: 'column', overflow: 'hidden',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = '#3a7bd5' }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = '#3a3a3a' }}
                    >
                      <button
                        onClick={() => select(t.id)}
                        style={{
                          textAlign: 'left', cursor: 'pointer', background: 'transparent',
                          border: 'none', padding: '12px 14px', color: '#e0e0e0',
                          fontFamily: 'inherit', display: 'flex', flexDirection: 'column', gap: '6px',
                        }}
                      >
                        <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#5a9bf5' }}>
                          {t.name}
                        </span>
                        <span style={{ fontSize: '11px', color: '#aaa', lineHeight: 1.5 }}>
                          {t.description}
                        </span>
                        {t.source.kind === 'example' && (
                          <StructurePreview preview={previews?.[t.source.file]} />
                        )}
                      </button>
                      {forkable && (
                        <button
                          onClick={() => fork(t.id)}
                          title="Clone this example as a starting point and tweak its requirements"
                          style={{
                            textAlign: 'left', cursor: 'pointer', background: 'transparent',
                            borderTop: '1px dashed #444', border: 'none', borderTopWidth: '1px',
                            borderTopStyle: 'dashed', borderTopColor: '#444',
                            padding: '7px 14px', color: '#8a8a8a', fontFamily: 'inherit',
                            fontSize: '10px',
                          }}
                          onMouseEnter={e => { e.currentTarget.style.color = '#d5a23a' }}
                          onMouseLeave={e => { e.currentTarget.style.color = '#8a8a8a' }}
                        >
                          ✎ Use as a starting point (fork &amp; edit)
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        <div style={{
          padding: '10px 18px', borderTop: CARD_BORDER,
          fontSize: '10px', color: '#888', lineHeight: 1.5,
        }}>
          Selecting a template replaces the current scene and regenerates it from
          the chosen requirements (the 3D scene is a derived projection). Fork &amp;
          edit keeps the example's values as faint anchors in the intake forms so
          you can tweak them into your own.
        </div>
      </div>
    </div>
  )
}
