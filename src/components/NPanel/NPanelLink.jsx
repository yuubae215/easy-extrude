import { LINK_COLORS } from './npanelShared.jsx'

export function NPanelLink({ data }) {
  const { link, srcName, tgtName, onDelete } = data
  const color = LINK_COLORS[link.semanticType] ?? '#888'
  const badgeLabel = link.jointType
    ? `${link.jointType} · ${link.semanticType}`
    : link.semanticType

  return (
    <div>
      {/* Type badge + from/to */}
      <div style={{ padding: '8px 10px 6px', borderBottom: '1px solid #3a3a3a' }}>
        <span style={{
          display: 'inline-block',
          background: color + '33',
          border: `1px solid ${color}`,
          borderRadius: '3px',
          padding: '2px 8px',
          color,
          fontSize: '12px',
          fontWeight: 'bold',
          fontFamily: 'sans-serif',
          marginBottom: '8px',
        }}>
          {badgeLabel}
        </span>
        <LinkRow label="From:" value={srcName} />
        <LinkRow label="To:"   value={tgtName} />
      </div>

      {/* Delete */}
      <div style={{ padding: '8px 10px' }}>
        <button
          onClick={onDelete}
          style={{
            width: '100%',
            padding: '5px',
            background: 'rgba(192,57,43,0.15)',
            border: '1px solid rgba(231,76,60,0.4)',
            borderRadius: '4px',
            color: '#e74c3c',
            fontSize: '12px',
            fontFamily: 'sans-serif',
            cursor: 'pointer',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(192,57,43,0.3)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(192,57,43,0.15)' }}
        >
          Delete Link
        </button>
      </div>
    </div>
  )
}

function LinkRow({ label, value }) {
  return (
    <div style={{ display: 'flex', gap: '6px', alignItems: 'baseline', padding: '2px 0', fontFamily: 'sans-serif' }}>
      <span style={{ color: '#888', fontSize: '11px', minWidth: '40px' }}>{label}</span>
      <span style={{ color: '#e0e0e0', fontSize: '12px' }}>{value}</span>
    </div>
  )
}
