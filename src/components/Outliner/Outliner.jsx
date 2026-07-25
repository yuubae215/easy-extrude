import { useState, useEffect, useRef } from 'react'
import { useUIStore } from '../../store/uiStore.js'
import { IFC_CLASS_MAP } from '../../domain/IFCClassRegistry.js'
import { PLACE_TYPE_MAP } from '../../domain/PlaceTypeRegistry.js'
import { tourAnchor, tourVisible } from '../../view/TourMath.js'
import { activeGlow } from '../../view/ChromeMath.js'
import { visibilityAffordance } from '../../view/OutlinerRowMath.js'
import { useReducedMotion } from '../Feedback/FeedbackPrimitives.jsx'
import { DURATION, EASING } from '../../theme/tokens.js'
import { ROBOT_ROLE } from '../../domain/robotFrames.js'

// ── Robot placement frames (ADR-084 §2, TF tree ADR-085) ─────────────────────
// A robot's placement lives in a PAIR of CoordinateFrames (the single source
// grasp-search declares against): the base is world-parented, the tcp is its TF
// child (world → base → tcp), so moving the base carries the tcp. They look like
// any other frame in the tree, so a badge + tooltip tells the user what they are
// and how to move them — otherwise "how do I place the robot?" has no visible
// answer.
//
// Keyed by the frame's DECLARED role, not its name (ADR-090): with N robots the
// names are no longer unique (`robot_base_2`, a user rename), so a name-keyed
// badge silently stopped marking the second robot's rows.
const ROBOT_FRAME_HINT = {
  [ROBOT_ROLE.BASE]: 'Robot base — where the arm stands. Select and move with G / R or the N-panel to place the robot.',
  [ROBOT_ROLE.TCP]:  'Robot TCP — how the gripper is aimed (drives the grasp wrist-cone). Select and rotate with R or the N-panel.',
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

// ── Eye glyph ─────────────────────────────────────────────────────────────────
// Drawn rather than typed: there is no closed-eye counterpart to 👁 that renders
// consistently across platforms, and the emoji's own colour ignores the row's
// state tint. Two paths, `currentColor`, so the state derivation in
// `OutlinerRowMath` owns the colour (#4).
function EyeIcon({ open }) {
  const common = {
    width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.3,
    strokeLinecap: 'round', strokeLinejoin: 'round',
    style: { display: 'block' }, 'aria-hidden': true,
  }
  return open ? (
    <svg {...common}>
      <path d="M1.5 8S4 3.9 8 3.9 14.5 8 14.5 8 12 12.1 8 12.1 1.5 8 1.5 8Z" />
      <circle cx="8" cy="8" r="1.9" />
    </svg>
  ) : (
    <svg {...common}>
      {/* Lowered lid + lashes — a shut eye, not a struck-through one. */}
      <path d="M1.5 7.1c1.9 2.5 4.1 3.8 6.5 3.8s4.6-1.3 6.5-3.8" />
      <path d="M3.1 10.2 1.9 12" />
      <path d="M6.2 11.7 5.7 13.6" />
      <path d="m9.8 11.7.5 1.9" />
      <path d="M12.9 10.2 14.1 12" />
    </svg>
  )
}

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

  const { id, name, type, visible, locked, ifcClass, placeType, linked, unreferenced, robotRole } = item

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

  // ── Robot placement frame hint (ADR-084 §2, role-keyed per ADR-090) ───────
  const robotHint = robotRole ? ROBOT_FRAME_HINT[robotRole] : undefined

  // ── IFC badge ──────────────────────────────────────────────────────────────
  const ifcEntry = ifcClass ? IFC_CLASS_MAP.get(ifcClass) : null

  // ── Place type badge + icon color override ────────────────────────────────
  const ptEntry = placeType ? PLACE_TYPE_MAP.get(placeType) : null
  const iconDef = TYPE_ICON[type] ?? DEFAULT_ICON
  const iconColor = ptEntry ? ptEntry.color : iconDef.color

  // ── Visibility affordance (eye glyph + grey-out) ──────────────────────────
  // Single derivation point for "this row is hidden" (#4); a hidden row states
  // so without needing hover (#11) — see OutlinerRowMath.
  const vis = visibilityAffordance({ visible, hovered, active })
  const dimStyle = { opacity: vis.contentOpacity, transition: iconTransition }

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
      <span style={{ color: iconColor, fontSize: 12, flexShrink: 0, lineHeight: 1, ...dimStyle }}
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
            flex: 1, color: vis.nameColor, fontStyle: vis.nameStyle, fontSize: 12,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            transition: rowTransition,
          }}
          onDoubleClick={e => { e.stopPropagation(); startEdit() }}
        >
          {name}
        </span>
      )}

      {/* Robot placement frame badge (ADR-084 §2, declared role — ADR-090) */}
      {robotHint && (
        <span title={robotHint} style={{
          display: 'inline-block', fontSize: 9, fontWeight: 'bold',
          padding: '1px 4px', borderRadius: 2, flexShrink: 0,
          lineHeight: 1.4, cursor: 'default',
          background: '#5a9bf522', border: '1px solid #5a9bf5', color: '#5a9bf5',
          ...dimStyle,
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
          ...dimStyle,
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
          ...dimStyle,
        }}>
          {ptEntry.name}
        </span>
      )}

      {/* SpatialLink source badge */}
      {linked.asSource && (
        <span title="Sends spatial links to other entities (source / child role)"
              style={{ fontSize: 10, color: '#F59E0B', flexShrink: 0, cursor: 'default', ...dimStyle }}>
          ⟡→
        </span>
      )}

      {/* SpatialLink target badge */}
      {linked.asTarget && (
        <span title="Other entities spatially link to this (target / parent role)"
              style={{ fontSize: 10, color: '#14B8A6', flexShrink: 0, cursor: 'default', ...dimStyle }}>
          ←⟡
        </span>
      )}

      {/* Unreferenced frame badge */}
      {type === 'frame' && unreferenced && (
        <span title="No SpatialLink references this frame"
              style={{ fontSize: 10, color: '#666', flexShrink: 0, cursor: 'default', ...dimStyle }}>
          ⊡
        </span>
      )}

      {/* Eye — always in DOM to avoid layout shift. On a VISIBLE row it stays a
          hover-revealed control; on a HIDDEN row it is pinned on as the status
          glyph, because nothing else on screen says the entity is not drawn
          (#11). Opacity/colour/glyph all come from the one derivation (#4). */}
      <span
        role="button"
        aria-label={vis.eyeTitle}
        aria-pressed={vis.hidden}
        title={vis.eyeTitle}
        onClick={e => { e.stopPropagation(); callbacks.outlinerOnVisible?.(id, !visible) }}
        style={{
          color: vis.eyeColor, flexShrink: 0,
          opacity: vis.eyeOpacity, transition: iconTransition,
          lineHeight: 1, padding: '0 2px', cursor: 'pointer',
          display: 'flex', alignItems: 'center',
        }}
      >
        <EyeIcon open={vis.eyeOpen} />
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
