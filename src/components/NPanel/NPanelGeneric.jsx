import { useState, useRef, useEffect } from 'react'
import { useUIStore } from '../../store/uiStore.js'
import { IFC_CLASSES } from '../../domain/IFCClassRegistry.js'
import { PLACE_TYPE_MAP, getPlaceTypesByGeometry } from '../../domain/PlaceTypeRegistry.js'
import { Section, NumRow, EditRow, NameInput, AXIS_COLORS, LINK_COLORS } from './npanelShared.jsx'

export function NPanelGeneric({ data }) {
  const {
    centroid, dimensions, name, description,
    locationEditable,
    showIfcClass, ifcClass,
    showPlaceType, placeType, placeTypeGeometry,
    spatialLinks, currentEntityId, onDeleteSpatialLink, getEntityName,
    frames, onAddFrame, onSelectFrame,
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

      {/* Location */}
      <Section title="Location (World)">
        {locationEditable ? (
          <>
            <EditRow axis="X" color={AXIS_COLORS.X} value={centroid.x} onChange={v => callbacks.onNPanelLocationChange?.('x', v)} />
            <EditRow axis="Y" color={AXIS_COLORS.Y} value={centroid.y} onChange={v => callbacks.onNPanelLocationChange?.('y', v)} />
            <EditRow axis="Z" color={AXIS_COLORS.Z} value={centroid.z} onChange={v => callbacks.onNPanelLocationChange?.('z', v)} />
          </>
        ) : (
          <>
            <NumRow axis="X" color={AXIS_COLORS.X} value={centroid.x} />
            <NumRow axis="Y" color={AXIS_COLORS.Y} value={centroid.y} />
            <NumRow axis="Z" color={AXIS_COLORS.Z} value={centroid.z} />
          </>
        )}
      </Section>

      {/* Dimensions */}
      <Section title="Dimensions">
        <NumRow axis="X" color={AXIS_COLORS.X} value={dimensions.x} />
        <NumRow axis="Y" color={AXIS_COLORS.Y} value={dimensions.y} />
        <NumRow axis="Z" color={AXIS_COLORS.Z} value={dimensions.z} />
      </Section>

      {/* IFC Class */}
      {showIfcClass && (
        <IfcClassSection
          ifcClass={ifcClass}
          onIfcClassChange={v => callbacks.onNPanelIfcClassChange?.(v)}
        />
      )}

      {/* Place Type */}
      {showPlaceType && (
        <PlaceTypeSection
          placeType={placeType}
          geometry={placeTypeGeometry}
          onPlaceTypeChange={v => callbacks.onNPanelPlaceTypeChange?.(v)}
        />
      )}

      {/* Spatial Links */}
      {spatialLinks?.length > 0 && (
        <SpatialLinksSection
          links={spatialLinks}
          onDelete={onDeleteSpatialLink}
          getEntityName={getEntityName}
          currentEntityId={currentEntityId}
        />
      )}

      {/* Frames */}
      {(frames !== null || onAddFrame !== null) && (
        <FramesSection
          frames={frames ?? []}
          onAddFrame={onAddFrame}
          onSelectFrame={onSelectFrame}
        />
      )}

      {/* Description */}
      <DescriptionSection
        description={description}
        onCommit={v => callbacks.onNPanelDescriptionChange?.(v)}
      />
    </div>
  )
}

// ── IFC Class section ─────────────────────────────────────────────────────

function IfcClassSection({ ifcClass, onIfcClassChange }) {
  const [open, setOpen] = useState(false)
  const entry = ifcClass ? IFC_CLASSES.find(e => e.name === ifcClass) : null

  return (
    <div style={{ padding: '8px 10px 6px', borderBottom: '1px solid #3a3a3a', position: 'relative' }}>
      <div style={{ color: '#aaa', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
        IFC Class
      </div>
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
        <ClassBadge entry={entry} />
        <SmallBtn onClick={() => setOpen(o => !o)}>
          {entry ? 'Change' : 'Set'}
        </SmallBtn>
        {entry && (
          <SmallBtn title="Clear IFC class" onClick={() => { onIfcClassChange(null) }}>✕</SmallBtn>
        )}
      </div>
      {open && (
        <IfcPicker
          onSelect={name => { onIfcClassChange(name); setOpen(false) }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}

function ClassBadge({ entry }) {
  if (entry) return (
    <span style={{
      flex: '1', minWidth: '0',
      display: 'inline-block',
      background: entry.color + '33',
      border: `1px solid ${entry.color}`,
      borderRadius: '3px',
      padding: '2px 6px',
      color: entry.color,
      fontSize: '11px',
      fontWeight: 'bold',
      fontFamily: 'sans-serif',
      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    }}>
      {entry.label}
    </span>
  )
  return (
    <span style={{
      flex: '1', minWidth: '0',
      display: 'inline-block',
      background: 'transparent',
      border: '1px solid #444',
      borderRadius: '3px',
      padding: '2px 6px',
      color: '#666',
      fontSize: '11px',
      fontFamily: 'sans-serif',
    }}>
      Not set
    </span>
  )
}

function IfcPicker({ onSelect, onClose }) {
  const [filter, setFilter] = useState('')
  const inputRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const lc = filter.toLowerCase()
  const groups = new Map()
  for (const e of IFC_CLASSES) {
    if (lc && !e.label.toLowerCase().includes(lc) && !e.name.toLowerCase().includes(lc)) continue
    if (!groups.has(e.group)) groups.set(e.group, [])
    groups.get(e.group).push(e)
  }

  return (
    <>
      {/* Backdrop to close picker */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: '0', zIndex: '199', pointerEvents: 'auto' }}
      />
      <div style={{
        position: 'fixed',
        top: '40px',
        right: window.innerWidth < 768 ? '0' : '200px',
        width: '220px',
        maxHeight: '420px',
        background: '#252525',
        border: '1px solid #555',
        borderRadius: '5px',
        zIndex: '200',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
        overflow: 'hidden',
        pointerEvents: 'auto',
      }}>
        <input
          ref={inputRef}
          type="text"
          placeholder="Search IFC class…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') onClose() }}
          style={{
            margin: '8px', padding: '4px 8px', flexShrink: '0',
            background: '#383838', border: '1px solid #555', borderRadius: '3px',
            color: '#e8e8e8', fontSize: '12px', fontFamily: 'sans-serif', outline: 'none',
          }}
          onFocus={e => { e.target.style.borderColor = '#4fc3f7' }}
          onBlur={e => { e.target.style.borderColor = '#555' }}
        />
        <div style={{ overflowY: 'auto', flex: '1', padding: '0 4px 6px' }}>
          {groups.size === 0 ? (
            <div style={{ padding: '8px', color: '#666', fontSize: '12px', textAlign: 'center' }}>No results</div>
          ) : [...groups].map(([groupName, entries]) => (
            <div key={groupName}>
              {!lc && (
                <div style={{ padding: '4px 6px 2px', color: '#777', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.07em', marginTop: '4px' }}>
                  {groupName}
                </div>
              )}
              {entries.map(entry => (
                <div
                  key={entry.name}
                  onClick={() => onSelect(entry.name)}
                  style={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '4px 8px', borderRadius: '3px', cursor: 'pointer' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                >
                  <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: entry.color, flexShrink: '0', border: '1px solid rgba(255,255,255,0.15)', display: 'inline-block' }} />
                  <span style={{ color: '#e0e0e0', fontSize: '12px', fontFamily: 'sans-serif' }}>{entry.label}</span>
                  <span style={{ color: '#666', fontSize: '10px', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: '1', textAlign: 'right' }}>
                    {entry.name}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

// ── Place Type section ────────────────────────────────────────────────────

function PlaceTypeSection({ placeType, geometry, onPlaceTypeChange }) {
  const [open, setOpen] = useState(false)
  const entry = placeType ? PLACE_TYPE_MAP.get(placeType) : null

  return (
    <div style={{ padding: '8px 10px 6px', borderBottom: '1px solid #3a3a3a' }}>
      <div style={{ color: '#aaa', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
        Place Type
      </div>
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
        <PlaceTypeBadge entry={entry} />
        <SmallBtn onClick={() => setOpen(o => !o)}>
          {entry ? 'Change' : 'Set'}
        </SmallBtn>
        {entry && (
          <SmallBtn title="Clear place type" onClick={() => onPlaceTypeChange(null)}>✕</SmallBtn>
        )}
      </div>
      {open && (
        <PlaceTypePicker
          geometry={geometry}
          onSelect={name => { onPlaceTypeChange(name); setOpen(false) }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}

function PlaceTypeBadge({ entry }) {
  if (entry) return (
    <span style={{
      flex: '1', minWidth: '0',
      display: 'inline-block',
      background: entry.color + '33',
      border: `1px solid ${entry.color}`,
      borderRadius: '3px',
      padding: '2px 6px',
      color: entry.color,
      fontSize: '11px',
      fontWeight: 'bold',
      fontFamily: 'sans-serif',
      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    }}>
      {entry.label}
    </span>
  )
  return (
    <span style={{
      flex: '1', minWidth: '0',
      display: 'inline-block',
      background: 'transparent',
      border: '1px solid #444',
      borderRadius: '3px',
      padding: '2px 6px',
      color: '#666',
      fontSize: '11px',
      fontFamily: 'sans-serif',
    }}>
      Not set
    </span>
  )
}

function PlaceTypePicker({ geometry, onSelect, onClose }) {
  const entries = geometry ? getPlaceTypesByGeometry(geometry) : []
  return (
    <>
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: '0', zIndex: '199', pointerEvents: 'auto' }}
      />
      <div style={{
        position: 'fixed',
        top: '40px',
        right: window.innerWidth < 768 ? '0' : '200px',
        width: '230px',
        maxHeight: '320px',
        background: '#252525',
        border: '1px solid #555',
        borderRadius: '5px',
        zIndex: '200',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
        overflow: 'hidden',
        pointerEvents: 'auto',
      }}>
        <div style={{ padding: '8px 10px 6px', color: '#ccc', fontSize: '12px', fontFamily: 'sans-serif', borderBottom: '1px solid #3a3a3a', flexShrink: '0' }}>
          Place Type
        </div>
        <div style={{ overflowY: 'auto', flex: '1', padding: '4px 6px 8px' }}>
          {entries.length === 0 ? (
            <div style={{ color: '#666', fontSize: '11px', padding: '8px 4px' }}>No types available for this geometry type.</div>
          ) : entries.map(entry => (
            <div
              key={entry.name}
              onClick={() => onSelect(entry.name)}
              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 6px', borderRadius: '3px', cursor: 'pointer' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: entry.color, flexShrink: '0', display: 'inline-block' }} />
              <div style={{ flex: '1', minWidth: '0' }}>
                <div style={{ color: entry.color, fontSize: '12px', fontWeight: 'bold', fontFamily: 'sans-serif' }}>{entry.label}</div>
                <div style={{ color: '#777', fontSize: '10px', fontFamily: 'sans-serif', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.description}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

// ── Spatial Links section ─────────────────────────────────────────────────

function SpatialLinksSection({ links, onDelete, getEntityName, currentEntityId }) {
  const outgoing = currentEntityId ? links.filter(l => l.sourceId === currentEntityId) : []
  const incoming = currentEntityId ? links.filter(l => l.targetId === currentEntityId) : []
  const unknown  = currentEntityId ? [] : links

  return (
    <div style={{ padding: '8px 10px 6px', borderBottom: '1px solid #3a3a3a' }}>
      <div style={{ color: '#aaa', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
        Spatial Links
      </div>
      {currentEntityId ? (
        <>
          {outgoing.length > 0 && (
            <>
              <SubHeader label="⟡→ Links to (source role)" color="#F59E0B" />
              {outgoing.map(link => (
                <SpatialLinkRow key={link.id} link={link} glyph="→" otherId={link.targetId} getEntityName={getEntityName} onDelete={onDelete} />
              ))}
            </>
          )}
          {incoming.length > 0 && (
            <>
              <SubHeader label="←⟡ Linked by (target role)" color="#14B8A6" />
              {incoming.map(link => (
                <SpatialLinkRow key={link.id} link={link} glyph="←" otherId={link.sourceId} getEntityName={getEntityName} onDelete={onDelete} />
              ))}
            </>
          )}
        </>
      ) : unknown.map(link => (
        <UnknownLinkRow key={link.id} link={link} getEntityName={getEntityName} onDelete={onDelete} />
      ))}
    </div>
  )
}

function SubHeader({ label, color }) {
  return (
    <div style={{ fontSize: '10px', color, fontWeight: 'bold', marginTop: '4px', marginBottom: '2px', fontFamily: 'sans-serif' }}>
      {label}
    </div>
  )
}

function SpatialLinkRow({ link, glyph, otherId, getEntityName, onDelete }) {
  const color = LINK_COLORS[link.semanticType] ?? '#888'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '3px 0', fontFamily: 'sans-serif' }}>
      <span style={{ flexShrink: '0', fontSize: '11px', color: '#888' }}>{glyph}</span>
      <span style={{ flexShrink: '0', background: color + '22', border: `1px solid ${color}`, borderRadius: '3px', padding: '1px 5px', color, fontSize: '10px', fontWeight: 'bold' }}>
        {link.semanticType}
      </span>
      <span style={{ flex: '1', fontSize: '11px', color: '#ccc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {getEntityName(otherId)}
      </span>
      {link.semanticType === 'connects' && link.properties?.deadline !== undefined && (
        <TactTimeInfo link={link} />
      )}
      {onDelete && <DeleteBtn onClick={() => onDelete(link.id)} />}
    </div>
  )
}

function UnknownLinkRow({ link, getEntityName, onDelete }) {
  const color = LINK_COLORS[link.semanticType] ?? '#888'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '3px 0', fontFamily: 'sans-serif' }}>
      <span style={{ flexShrink: '0', background: color + '22', border: `1px solid ${color}`, borderRadius: '3px', padding: '1px 5px', color, fontSize: '10px', fontWeight: 'bold' }}>
        {link.semanticType}
      </span>
      <span style={{ flex: '1', fontSize: '11px', color: '#ccc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {getEntityName(link.sourceId)} → {getEntityName(link.targetId)}
      </span>
      {onDelete && <DeleteBtn onClick={() => onDelete(link.id)} />}
    </div>
  )
}

function TactTimeInfo({ link }) {
  const transitTime = link.properties?.currentTransitTime
  const deadline    = link.properties.deadline
  const t           = transitTime !== undefined ? transitTime.toFixed(1) : '–'
  const exceeded    = transitTime !== undefined && transitTime > deadline
  return (
    <span style={{ flexShrink: '0', fontSize: '10px', fontFamily: 'monospace', color: exceeded ? '#EF4444' : '#4ADE80', margin: '0 2px' }}>
      {t}s/{deadline}s
    </span>
  )
}

function DeleteBtn({ onClick }) {
  return (
    <button
      onClick={onClick}
      title="Delete this link"
      style={{ flexShrink: '0', background: 'transparent', border: '1px solid #555', borderRadius: '3px', color: '#e74c3c', fontSize: '13px', cursor: 'pointer', padding: '0 5px', lineHeight: '16px' }}
    >
      ×
    </button>
  )
}

// ── Frames section ────────────────────────────────────────────────────────

function FramesSection({ frames, onAddFrame, onSelectFrame }) {
  return (
    <div style={{ padding: '8px 10px 6px', borderBottom: '1px solid #3a3a3a' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '6px' }}>
        <span style={{ flex: '1', color: '#aaa', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Frames
        </span>
        {onAddFrame && (
          <SmallBtn onClick={onAddFrame} title="Add an interface frame to this entity">+ Add Frame</SmallBtn>
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

// ── Description section ───────────────────────────────────────────────────

function DescriptionSection({ description, onCommit }) {
  const textareaRef = useRef(null)

  return (
    <div style={{ padding: '8px 10px 6px' }}>
      <div style={{ color: '#aaa', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
        Description
      </div>
      <textarea
        ref={textareaRef}
        key={description}
        defaultValue={description}
        rows={4}
        placeholder="Add a description…"
        onFocus={e => { e.target.style.borderColor = '#4fc3f7' }}
        onBlur={e => {
          e.target.style.borderColor = '#444'
          onCommit?.(e.target.value)
        }}
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
          resize: 'vertical',
          lineHeight: '1.5',
        }}
      />
    </div>
  )
}

// ── Shared small button ───────────────────────────────────────────────────

function SmallBtn({ onClick, title, children }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{ flexShrink: '0', padding: '2px 7px', background: '#3c3c3c', border: '1px solid #555', borderRadius: '3px', color: '#e8e8e8', fontSize: '11px', cursor: 'pointer', fontFamily: 'sans-serif' }}
      onMouseEnter={e => { e.currentTarget.style.background = '#4a4a4a' }}
      onMouseLeave={e => { e.currentTarget.style.background = '#3c3c3c' }}
    >
      {children}
    </button>
  )
}
