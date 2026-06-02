import { useRef } from 'react'
import { useUIStore } from '../../store/uiStore.js'
import { Section, NumRow, EditRow, NameInput, AXIS_COLORS } from './npanelShared.jsx'

export function NPanelFrame({ data }) {
  const {
    pos, eulerDeg, name, locked,
    parentOptions, currentParentId,
    unreferenced,
    childFrames, onAddChildFrame, onSelectChildFrame,
  } = data

  const callbacks = useUIStore(s => s.callbacks)

  return (
    <div>
      {/* Name */}
      <div style={{ padding: '8px 10px 6px', borderBottom: '1px solid #3a3a3a' }}>
        <div style={{ color: '#aaa', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
          Name
        </div>
        <NameInput name={name} onCommit={v => callbacks.onNPanelNameChange?.(v)} />
      </div>

      {/* Parent dropdown */}
      {!locked && parentOptions?.length > 0 && (
        <ParentSection
          parentOptions={parentOptions}
          currentParentId={currentParentId}
          onParentChange={id => callbacks.onNPanelFrameParentChange?.(id)}
        />
      )}

      {/* Location */}
      <Section title={locked ? 'Location (World)' : 'Location (Local)'}>
        {locked ? (
          <>
            <NumRow axis="X" color={AXIS_COLORS.X} value={pos.x} />
            <NumRow axis="Y" color={AXIS_COLORS.Y} value={pos.y} />
            <NumRow axis="Z" color={AXIS_COLORS.Z} value={pos.z} />
          </>
        ) : (
          <>
            <EditRow axis="X" color={AXIS_COLORS.X} value={pos.x} onChange={v => callbacks.onNPanelFramePositionChange?.('x', v)} />
            <EditRow axis="Y" color={AXIS_COLORS.Y} value={pos.y} onChange={v => callbacks.onNPanelFramePositionChange?.('y', v)} />
            <EditRow axis="Z" color={AXIS_COLORS.Z} value={pos.z} onChange={v => callbacks.onNPanelFramePositionChange?.('z', v)} />
          </>
        )}
      </Section>

      {/* Rotation */}
      <Section title="Rotation (Local · RPY)">
        {locked ? (
          <>
            <NumRow axis="X" color={AXIS_COLORS.X} value={eulerDeg.x} />
            <NumRow axis="Y" color={AXIS_COLORS.Y} value={eulerDeg.y} />
            <NumRow axis="Z" color={AXIS_COLORS.Z} value={eulerDeg.z} />
          </>
        ) : (
          <>
            <EditRow axis="X" color={AXIS_COLORS.X} value={eulerDeg.x} onChange={v => callbacks.onNPanelFrameRotationChange?.('x', v)} />
            <EditRow axis="Y" color={AXIS_COLORS.Y} value={eulerDeg.y} onChange={v => callbacks.onNPanelFrameRotationChange?.('y', v)} />
            <EditRow axis="Z" color={AXIS_COLORS.Z} value={eulerDeg.z} onChange={v => callbacks.onNPanelFrameRotationChange?.('z', v)} />
          </>
        )}
      </Section>

      {/* Unreferenced notice */}
      {unreferenced && (
        <div style={{ padding: '8px 10px 6px', borderTop: '1px solid #3a3a3a' }}>
          <div style={{ fontSize: '11px', color: '#666', fontStyle: 'italic', fontFamily: 'sans-serif' }}>
            ⊡ No SpatialLink references this frame
          </div>
        </div>
      )}

      {/* Child frames */}
      {(childFrames !== null || onAddChildFrame !== null) && (
        <FramesSection
          frames={childFrames ?? []}
          onAddFrame={onAddChildFrame}
          onSelectFrame={onSelectChildFrame}
        />
      )}
    </div>
  )
}

function ParentSection({ parentOptions, currentParentId, onParentChange }) {
  const selectRef = useRef(null)
  return (
    <div style={{ padding: '8px 10px 6px', borderBottom: '1px solid #3a3a3a' }}>
      <div style={{ color: '#aaa', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
        Parent
      </div>
      <select
        ref={selectRef}
        defaultValue={currentParentId ?? ''}
        key={currentParentId}
        onChange={e => onParentChange?.(e.target.value)}
        onFocus={e => { e.target.style.borderColor = '#4fc3f7' }}
        onBlur={e => { e.target.style.borderColor = '#444' }}
        onKeyDown={e => e.stopPropagation()}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          background: '#383838',
          border: '1px solid #444',
          borderRadius: '3px',
          padding: '3px 6px',
          color: '#e8e8e8',
          fontSize: '12px',
          fontFamily: 'sans-serif',
          outline: 'none',
          cursor: 'pointer',
        }}
      >
        {parentOptions.map(opt => (
          <option key={opt.id} value={opt.id}>{opt.name}</option>
        ))}
      </select>
    </div>
  )
}

function FramesSection({ frames, onAddFrame, onSelectFrame }) {
  return (
    <div style={{ padding: '8px 10px 6px', borderBottom: '1px solid #3a3a3a' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '6px' }}>
        <span style={{ flex: '1', color: '#aaa', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Frames
        </span>
        {onAddFrame && (
          <SmallBtn onClick={onAddFrame} title="Add a child frame">+ Add Frame</SmallBtn>
        )}
      </div>
      {frames.length === 0 ? (
        <div style={{ fontSize: '11px', color: '#666', fontStyle: 'italic' }}>No frames</div>
      ) : frames.map(frame => (
        <FrameRow key={frame.id} frame={frame} onSelect={onSelectFrame} />
      ))}
    </div>
  )
}

function FrameRow({ frame, onSelect }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '3px 0', fontFamily: 'sans-serif' }}>
      <span style={{ color: '#6ab04c', fontSize: '13px', flexShrink: '0' }}>⊞</span>
      <span style={{ flex: '1', fontSize: '12px', color: '#e8e8e8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {frame.name}
      </span>
      {frame.unreferenced && (
        <span title="No SpatialLink references this frame" style={{ color: '#888', fontSize: '11px', flexShrink: '0' }}>⊡</span>
      )}
      {onSelect && (
        <SmallBtn onClick={() => onSelect(frame.id)} title={`Select frame "${frame.name}"`}>Select</SmallBtn>
      )}
    </div>
  )
}

function SmallBtn({ onClick, title, children }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        flexShrink: '0',
        padding: '2px 7px',
        background: '#3c3c3c',
        border: '1px solid #555',
        borderRadius: '3px',
        color: '#ccc',
        fontSize: '10px',
        cursor: 'pointer',
        fontFamily: 'sans-serif',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = '#4a4a4a' }}
      onMouseLeave={e => { e.currentTarget.style.background = '#3c3c3c' }}
    >
      {children}
    </button>
  )
}
