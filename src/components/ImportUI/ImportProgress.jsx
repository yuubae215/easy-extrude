import { useUIStore } from '../../store/uiStore.js'

const isMobile = () => window.matchMedia('(pointer: coarse)').matches

export function ImportProgress() {
  const importProgress = useUIStore(s => s.importProgress)

  if (!importProgress) return null

  const { percent, status } = importProgress
  const bottom = isMobile() ? '96px' : '64px'

  return (
    <div style={{
      position: 'fixed',
      bottom,
      left: '50%',
      transform: 'translateX(-50%)',
      background: 'rgba(28,28,32,0.92)',
      backdropFilter: 'blur(12px)',
      borderLeft: '3px solid #4a90d9',
      borderRadius: '12px',
      padding: '12px 20px',
      minWidth: '240px',
      pointerEvents: 'none',
      zIndex: 9998,
      fontSize: '12px',
      color: '#e8e8e8',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <span>⏳</span>
        <span style={{ flex: 1, color: '#ccc' }}>{status ?? 'Importing…'}</span>
        <span style={{ color: '#aad4f5' }}>{Math.round(percent)}%</span>
      </div>
      <div style={{
        height: '3px',
        background: 'rgba(255,255,255,0.12)',
        borderRadius: '2px',
        overflow: 'hidden',
      }}>
        <div style={{
          height: '100%',
          width: `${percent}%`,
          background: '#4a90d9',
          borderRadius: '2px',
          transition: 'width 0.3s ease',
        }} />
      </div>
    </div>
  )
}
