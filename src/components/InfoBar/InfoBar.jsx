import { useUIStore } from '../../store/uiStore.js'
import { getInfoText } from '../../utils/infoBarText.js'

const isMobile = () => window.matchMedia('(pointer: coarse)').matches

export function InfoBar() {
  const mode        = useUIStore(s => s.mode)
  const editSubtype = useUIStore(s => s.editSubtype)
  const statusParts = useUIStore(s => s.statusParts)
  const extraHint   = useUIStore(s => s.extraHint)

  const mobile = isMobile()

  return (
    <div style={{
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      height: '26px',
      background: '#1c1c1c',
      borderTop: '1px solid #111',
      display: 'flex',
      alignItems: 'center',
      padding: '0 12px',
      color: '#aaa',
      fontSize: '12px',
      fontFamily: 'sans-serif',
      pointerEvents: 'none',
      zIndex: 100,
      justifyContent: mobile ? 'center' : 'flex-start',
      gap: 0,
      overflow: 'hidden',
    }}>
      {!mobile && <HintsContent shortcuts={getInfoText(mode, editSubtype)} extraHint={extraHint} />}
    </div>
  )
}

function StatusContent({ parts }) {
  if (!parts || parts.length === 0) return null
  return parts.map((part, i) => (
    <span
      key={i}
      style={{
        color: part.color ?? '#c8c8c8',
        fontWeight: part.bold ? 'bold' : 'normal',
      }}
    >
      {i > 0 && <span style={{ color: '#555', margin: '0 4px' }}>·</span>}
      {part.text}
    </span>
  ))
}

function HintsContent({ shortcuts, extraHint }) {
  return (
    <>
      {shortcuts.map(([key, desc], i) => (
        <span key={i} style={{ display: 'flex', alignItems: 'center' }}>
          {i > 0 && <span style={{ color: '#555', padding: '0 5px' }}>|</span>}
          <span style={{
            background: '#444',
            border: '1px solid #666',
            borderRadius: '3px',
            padding: '0 4px',
            color: '#ddd',
            fontSize: '11px',
            marginRight: '3px',
            fontFamily: 'monospace',
          }}>
            {key}
          </span>
          <span>{desc}</span>
        </span>
      ))}
      {extraHint && (
        <span style={{ display: 'flex', alignItems: 'center' }}>
          <span style={{ color: '#555', padding: '0 5px' }}>|</span>
          <span style={{
            background: '#444',
            border: '1px solid #666',
            borderRadius: '3px',
            padding: '0 4px',
            color: '#ddd',
            fontSize: '11px',
            marginRight: '3px',
            fontFamily: 'monospace',
          }}>
            {extraHint.key}
          </span>
          <span>{extraHint.desc}</span>
        </span>
      )}
    </>
  )
}
