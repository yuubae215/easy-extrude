import { useState, useEffect, useRef } from 'react'
import { useUIStore } from '../../store/uiStore.js'
import { IFC_CLASS_MAP } from '../../domain/IFCClassRegistry.js'
import { PLACE_TYPE_MAP } from '../../domain/PlaceTypeRegistry.js'
import { tourAnchor, tourVisible } from '../../view/TourMath.js'
import { activeGlow } from '../../view/ChromeMath.js'
import { useReducedMotion } from '../Feedback/FeedbackPrimitives.jsx'
import { DURATION, EASING } from '../../theme/tokens.js'
import { ROBOT_BASE_FRAME_NAME, TCP_FRAME_NAME } from '../../domain/robotFrames.js'

// ── Robot placement frames (ADR-084 §2) ──────────────────────────────────────
// These two world-parented CoordinateFrames carry the robot's placement (the
// single source grasp-search declares against). They look like any other frame
// in the tree, so a badge + tooltip tells the user what they are and how to move
// them — otherwise "how do I place the robot?" has no visible answer.
const ROBOT_FRAME_HINT = {
  [ROBOT_BASE_FRAME_NAME]: 'Robot base — where the arm stands. Select and move with G / R or the N-panel to place the robot.',
  [TCP_FRAME_NAME]:        'Robot TCP — how the gripper is aimed (drives the grasp wrist-cone). Select and rotate with R or the N-panel.',
}

// ── Icon config matching OutlinerView._createRow ──────────────────────────────
const TYPE_ICON = {
  cuboid:       { glyph: '⬡', color: '#4fc3f7', title: '' },
  sketch:       { glyph: '⬡', color: '#80cbc4', title: '' },
  imported:     { glyph: '⬡', color: '#888888', title: 'Imported mesh (read-only)' },
  measure:      { glyph: '↔', color: '#f9a825', title: 'Measure line' },
  frame:        { glyph: '⊕', color: '#a0c8ff', title: 'Coordinate frame' },
  'annot-line':   { glyph: '⟿', color: '#888888', title: 'Annotated line (Route / Boundary)' },
  'annot-region': { glyph: '⬡', color: '#888888', title: 'Annotated region (Zone)' },
  'annot-point':  { glyph: '⬤', color: '#888888', title: 'Annotated point (Hub / Anchor)' },
}
const DEFAULT_ICON = { glyph: '⬡', color: '#4fc3f7', title: '' }

// ── DFS pre-order traversal ───────────────────────────────────────────────────
function buildOrderedItems(items) {
  const byParent = new Map()
  for (const item of items) {
    const key = item.parentId ?? '__root__'
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key).push(item)
  }
  const result = []
  const visit = (item, depth) => {
    result.push({ item, depth })
    const children = byParent.get(item.id) ?? []
    children.forEach(c => visit(c, depth + 1))
  }
  const roots = byParent.get('__root__') ?? []
  roots.forEach(r => visit(r, 0))
  return result
}

// ── Individual row ────────────────────────────────────────────────────────────
function OutlinerRow({ item, depth, active, hasChildren, callbacks, draggingId, setDraggingId }) {
  const [hovered, setHovered] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const inputRef = useRef(null)
  const rowRef = useRef(null)
  const reduced = useReducedMotion()
  // ADR-068 polish: colour/opacity glide on hover & active, gated by reduced motion.
  const rowTransition = reduced ? undefined
    : `background ${DURATION.hover}ms ${EASING.out}, opacity ${DURATION.hover}ms ${EASING.out}`
  const iconTransition = reduced ? undefined : `opacity ${DURATION.hover}ms ${EASING.out}`

  const { id, name, type, visible, locked, ifcClass, placeType, linked, unreferenced } = item

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  // Follow the selection: when a row becomes active (e.g. selected from the 3D
  // canvas, not just clicked here), scroll it into view (ADR-068 polish).
  useEffect(() => {
    if (active) rowRef.current?.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' })
  }, [active, reduced])

  // ── Robot placement frame hint (ADR-084 §2) ───────────────────────────────
  const robotHint = type === 'frame' ? ROBOT_FRAME_HINT[name] : undefined

  // ── IFC badge ──────────────────────────────────────────────────────────────
  const ifcEntry = ifcClass ? IFC_CLASS_MAP.get(ifcClass) : null

  // ── Place type badge + icon color override ────────────────────────────────
  const ptEntry = placeType ? PLACE_TYPE_MAP.get(placeType) : null
  const iconDef = TYPE_ICON[type] ?? DEFAULT_ICON
  const iconColor = ptEntry ? ptEntry.color : iconDef.color

  // ── Triangle / connector glyph ────────────────────────────────────────────
  const triStyle = depth > 0
    ? { color: '#555', fontSize: 10, marginLeft: -14, marginRight: 2, flexShrink: 0, lineHeight: 1 }
    : { color: hasChildren ? '#cc7a00' : '#444', fontSize: hasChildren ? 9 : 8, flexShrink: 0, lineHeight: 1 }

  // ── Rename handlers ────────────────────────────────────────────────────────
  const startEdit = () => {
    setEditValue(name)
    setEditing(true)
  }
  const commitEdit = () => {
    const newName = editValue.trim() || name
    setEditing(false)
    callbacks.outlinerOnRename?.(id, newName)
  }
  const cancelEdit = () => setEditing(false)

  // ── Drag handlers ─────────────────────────────────────────────────────────
  const handleDragStart = (e) => {
    if (locked) { e.preventDefault(); return }
    setDraggingId(id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }
  const handleDragEnd = () => setDraggingId(null)
  const handleDragOver = (e) => {
    if (!draggingId || draggingId === id) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }
  const handleDrop = (e) => {
    e.preventDefault()
    if (!draggingId || draggingId === id) return
    const dragged = draggingId
    setDraggingId(null)
    callbacks.outlinerOnReparent?.(dragged, id)
  }

  const isDragTarget = hovered && draggingId && draggingId !== id

  return (
    <div
      ref={rowRef}
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: `3px 4px 3px ${16 + depth * 12}px`,
        cursor: 'pointer',
        gap: 4,
        background: active
          ? 'rgba(255,112,67,0.18)'
          : hovered
            ? 'rgba(255,255,255,0.05)'
            : 'transparent',
        borderBottom: '1px solid transparent',
        outline: isDragTarget ? '2px solid #4fc3f7' : 'none',
        outlineOffset: isDragTarget ? -2 : 0,
        opacity: draggingId === id ? 0.4 : 1,
        transition: rowTransition,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => callbacks.outlinerOnSelect?.(id)}
      draggable={type === 'frame' && !locked}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Triangle / connector */}
      <span style={triStyle}>
        {depth > 0 ? '└' : '▶'}
      </span>

      {/* Icon */}
      <span style={{ color: iconColor, fontSize: 12, flexShrink: 0, lineHeight: 1 }}
            title={iconDef.title}>
        {iconDef.glyph}
      </span>

      {/* Name or inline rename input */}
      {editing ? (
        <input
          ref={inputRef}
          value={editValue}
          onChange={e => setEditValue(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={e => {
            e.stopPropagation()
            if (e.key === 'Enter') { e.preventDefault(); inputRef.current?.blur() }
            if (e.key === 'Escape') { e.preventDefault(); inputRef.current?.removeEventListener('blur', commitEdit); cancelEdit() }
          }}
          style={{
            flex: 1, background: '#1a1a2e', border: '1px solid #4fc3f7',
            borderRadius: 2, color: '#e8e8e8', fontSize: 12,
            fontFamily: 'sans-serif', padding: '0 3px', outline: 'none', minWidth: 0,
          }}
          onClick={e => e.stopPropagation()}
        />
      ) : (
        <span
          style={{
            flex: 1, color: active ? '#ff8c69' : '#e0e0e0', fontSize: 12,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
          onDoubleClick={e => { e.stopPropagation(); startEdit() }}
        >
          {name}
        </span>
      )}

      {/* Robot placement frame badge (ADR-084 §2) */}
      {robotHint && (
        <span title={robotHint} style={{
          display: 'inline-block', fontSize: 9, fontWeight: 'bold',
          padding: '1px 4px', borderRadius: 2, flexShrink: 0,
          lineHeight: 1.4, cursor: 'default',
          background: '#5a9bf522', border: '1px solid #5a9bf5', color: '#5a9bf5',
        }}>
          ROBOT
        </span>
      )}

      {/* IFC badge */}
      {ifcEntry && (
        <span title={ifcEntry.name} style={{
          display: 'inline-block', fontSize: 9, fontWeight: 'bold',
          padding: '1px 4px', borderRadius: 2, flexShrink: 0,
          maxWidth: 52, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          lineHeight: 1.4, cursor: 'default',
          background: ifcEntry.color + '22', border: `1px solid ${ifcEntry.color}`, color: ifcEntry.color,
        }}>
          {ifcEntry.label}
        </span>
      )}

      {/* Place type badge */}
      {ptEntry && (
        <span title={ptEntry.label} style={{
          display: 'inline-block', fontSize: 9, fontWeight: 'bold',
          padding: '1px 4px', borderRadius: 2, flexShrink: 0,
          maxWidth: 52, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          lineHeight: 1.4, cursor: 'default',
          background: ptEntry.color + '22', border: `1px solid ${ptEntry.color}`, color: ptEntry.color,
        }}>
          {ptEntry.name}
        </span>
      )}

      {/* SpatialLink source badge */}
      {linked.asSource && (
        <span title="Sends spatial links to other entities (source / child role)"
              style={{ fontSize: 10, color: '#F59E0B', flexShrink: 0, cursor: 'default' }}>
          ⟡→
        </span>
      )}

      {/* SpatialLink target badge */}
      {linked.asTarget && (
        <span title="Other entities spatially link to this (target / parent role)"
              style={{ fontSize: 10, color: '#14B8A6', flexShrink: 0, cursor: 'default' }}>
          ←⟡
        </span>
      )}

      {/* Unreferenced frame badge */}
      {type === 'frame' && unreferenced && (
        <span title="No SpatialLink references this frame"
              style={{ fontSize: 10, color: '#666', flexShrink: 0, cursor: 'default' }}>
          ⊡
        </span>
      )}

      {/* Eye — always in DOM to avoid layout shift, opacity controls visibility */}
      <span
        title={visible ? 'Hide' : 'Show'}
        onClick={e => { e.stopPropagation(); callbacks.outlinerOnVisible?.(id, !visible) }}
        style={{
          color: '#aaa', fontSize: 10, flexShrink: 0,
          opacity: hovered ? 1 : 0, transition: iconTransition,
          lineHeight: 1, padding: '0 2px', cursor: 'pointer',
        }}
      >
        👁
      </span>

      {/* Delete */}
      <button
        title="Delete"
        aria-label="Delete"
        onClick={e => { e.stopPropagation(); callbacks.outlinerOnDelete?.(id) }}
        style={{
          color: '#888', fontSize: 10, flexShrink: 0,
          opacity: hovered ? 1 : 0, transition: iconTransition,
          lineHeight: 1, padding: '0 2px', cursor: 'pointer',
          background: 'none', border: 'none',
        }}
      >
        ✕
      </button>
    </div>
  )
}

// ── Panel ─────────────────────────────────────────────────────────────────────
export function Outliner() {
  const items      = useUIStore(s => s.outlinerItems)
  const activeId   = useUIStore(s => s.outlinerActiveId)
  const drawerOpen = useUIStore(s => s.outlinerDrawerOpen)
  const callbacks  = useUIStore(s => s.callbacks)
  // Onboarding tour anchor (ADR-065 Phase 6): while the open quest points at
  // "+ Add", the button breathes — Tier A affordance motion ("act here"),
  // derived from the SAME tour state + visibility predicate as the TourCard
  // so the card and the pulsed control cannot disagree (§1.1).
  const tour          = useUIStore(s => s.tour)
  const contextActive = useUIStore(s => s.context.active)
  const demoActive    = useUIStore(s => s.demo.active)
  const galleryOpen   = useUIStore(s => s.templateGalleryOpen)
  const reduced       = useReducedMotion()
  const pulseAdd = tourVisible(tour, { contextActive, demoActive, galleryOpen })
    && tourAnchor(tour) === 'outliner-add'

  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)
  const [draggingId, setDraggingId] = useState(null)

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  const orderedItems = buildOrderedItems(items)

  // Compute which ids have children (for triangle color)
  const parentIds = new Set(items.map(i => i.parentId).filter(Boolean))

  const translate = (!isMobile || drawerOpen) ? 'translateX(0)' : 'translateX(-100%)'

  return (
    <div style={{
      position: 'fixed',
      top: 40,
      left: 0,
      width: 180,
      bottom: 26,
      background: '#1c1c1c',
      borderRight: '1px solid #111',
      color: '#e8e8e8',
      fontFamily: 'sans-serif',
      fontSize: 12,
      zIndex: 90,
      display: 'flex',
      flexDirection: 'column',
      userSelect: 'none',
      pointerEvents: 'auto',
      transform: translate,
      transition: isMobile ? 'transform 0.25s ease' : '',
    }}>
      {/* Title bar */}
      <div style={{
        padding: '5px 10px',
        background: '#2b2b2b',
        borderBottom: '1px solid #111',
        fontSize: 11,
        color: '#999',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        flexShrink: 0,
      }}>
        Scene Collection
      </div>

      {/* Object list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {orderedItems.map(({ item, depth }) => (
          <OutlinerRow
            key={item.id}
            item={item}
            depth={depth}
            active={item.id === activeId}
            hasChildren={parentIds.has(item.id)}
            callbacks={callbacks}
            draggingId={draggingId}
            setDraggingId={setDraggingId}
          />
        ))}
      </div>

      {/* Footer — Add button */}
      <div style={{
        padding: '5px 6px',
        borderTop: '1px solid #111',
        display: 'flex',
        gap: 4,
        flexShrink: 0,
      }}>
        <button
          onClick={() => callbacks.outlinerOnAdd?.()}
          onMouseEnter={e => e.currentTarget.style.background = '#4a4a4a'}
          onMouseLeave={e => e.currentTarget.style.background = '#3c3c3c'}
          style={{
            flex: 1, padding: '4px 6px',
            background: '#3c3c3c', border: '1px solid #555',
            borderRadius: 3, color: '#e8e8e8', fontSize: 11,
            cursor: 'pointer', fontFamily: 'sans-serif',
            ...activeGlow(pulseAdd, reduced),
          }}
        >
          + Add  [Shift+A]
        </button>
      </div>
    </div>
  )
}
