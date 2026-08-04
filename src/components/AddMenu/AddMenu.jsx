import { useEffect, useRef } from 'react'
import { isInsideDropdown } from '../../view/DropdownContainment.js'
import { useUIStore } from '../../store/uiStore.js'
import { useReducedMotion } from '../Feedback/FeedbackPrimitives.jsx'
import { popoverEnterMotion, itemEnterMotion } from '../../view/ChromeMath.js'
import { PLACE_TOOLS } from '../../controller/place/PlaceToolController.js'
import { PARAMETRIC_CATALOG } from '../../context/ParametricAssets.js'
import { DURATION, EASING } from '../../theme/tokens.js'

export function AddMenu() {
  const addMenu    = useUIStore(s => s.addMenu)
  const hideAddMenu = useUIStore(s => s.actions.hideAddMenu)
  const reduced = useReducedMotion()
  const ref = useRef(null)

  useEffect(() => {
    if (!addMenu) return
    const onClick = (e) => {
      // These popups have no separate trigger element — the whole popup IS the
      // surface — but "does this click belong to me?" is still the ONE predicate
      // (ADR-113), so a fourth hand-rolled copy cannot drift the way the header's
      // two copies did.
      if (!isInsideDropdown(e.target, { trigger: null, surface: ref.current })) {
        hideAddMenu()
      }
    }
    setTimeout(() => document.addEventListener('click', onClick), 0)
    return () => document.removeEventListener('click', onClick)
  }, [addMenu])

  if (!addMenu) return null

  const { x, y, cbs } = addMenu

  const items = [
    cbs.onMeasure    && { label: 'Measure Line', hint: 'M',         cb: cbs.onMeasure },
    cbs.onBox        && { label: 'Box',          hint: 'Shift+A',   cb: cbs.onBox },
    cbs.onSketch     && { label: 'Sketch',       hint: null,        cb: cbs.onSketch },
    cbs.onFrame      && { label: 'Coordinate Frame', hint: null,    cb: cbs.onFrame },
    // Robot = base + tcp frame pair (ADR-090). Always offered: it is how a scene
    // with zero robots gets one, so it cannot be gated on the selection.
    cbs.onRobot      && { label: 'Robot',        hint: null,        cb: cbs.onRobot },
    cbs.onImportStep && { label: 'Import STEP',  hint: null,        cb: cbs.onImportStep },
  ].filter(Boolean)

  // The five Lynch place types (ADR-103). They used to sit in a Map Mode-only
  // left toolbar; they are ordinary scene objects, so they belong with every
  // other "place a thing" verb. The list comes from PLACE_TOOLS — the menu does
  // not keep a second copy of which tools exist (§1.1).
  const placeItems = cbs.onPlace
    ? PLACE_TOOLS.map(t => ({ label: t.label, hint: null, cb: () => cbs.onPlace(t.type) }))
    : []

  // Parametric assets (ADR-063 Phase 4) — jigs, conveyors, cell floors. They were
  // the `Assets` tab of the floor, which put "build a workbench" in the room where
  // people agree on requirements. Shaping one is MODELLING: it belongs with every
  // other "place a thing" verb (ADR-106 D3, same reasoning ADR-103 used to move
  // the five Lynch place types here). The catalog IS this group — the panel keeps
  // no second copy of which assets exist (§1.1); the sliders land in the N panel.
  const assetItems = cbs.onAsset
    ? PARAMETRIC_CATALOG.map(a => ({ label: a.name, hint: null, cb: () => cbs.onAsset(a.id) }))
    : []

  // The menu opens AT the pointer, so its own height decides whether the last
  // group is reachable. It grew a group in ADR-106 (Assets), and a pointer in the
  // lower half of the viewport pushed those items off-screen — an entry that
  // cannot be clicked is a silent dead end (原則 #11), and "discovery is a
  // deliverable" (#16) is not satisfied by an item that exists but is unreachable.
  // So the menu is anchored to whichever edge has room and scrolls if neither does.
  const flipUp = y > window.innerHeight * 0.55
  const anchor = flipUp
    ? { bottom: `${Math.max(8, window.innerHeight - y)}px` }
    : { top: `${y}px` }
  const maxHeight = (flipUp ? y : window.innerHeight - y) - 16

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        // Clamp horizontally too — a click near the right edge used to render the
        // labels past it.
        left: `${Math.max(4, Math.min(x, window.innerWidth - 180))}px`,
        ...anchor,
        background: '#2b2b2b',
        border: '1px solid #555',
        borderRadius: '4px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
        minWidth: '140px',
        maxHeight: `${Math.max(120, maxHeight)}px`,
        overflowY: 'auto',
        zIndex: 300,
        pointerEvents: 'auto',
        // Grows from the click point (Tier A, ADR-080 Phase 1)
        ...popoverEnterMotion(reduced, flipUp ? 'bottom left' : 'top left'),
      }}
    >
      <GroupLabel>Add</GroupLabel>
      {items.map((item, i) => (
        <Item key={`add-${i}`} item={item} index={i} reduced={reduced} onPick={hideAddMenu} />
      ))}
      {placeItems.length > 0 && <GroupLabel>Place</GroupLabel>}
      {placeItems.map((item, i) => (
        <Item key={`place-${i}`} item={item} index={items.length + i} reduced={reduced} onPick={hideAddMenu} />
      ))}
      {assetItems.length > 0 && <GroupLabel>Assets</GroupLabel>}
      {assetItems.map((item, i) => (
        <Item key={`asset-${i}`} item={item} index={items.length + placeItems.length + i} reduced={reduced} onPick={hideAddMenu} />
      ))}
    </div>
  )
}

function GroupLabel({ children }) {
  return (
    <div style={{
      padding: '5px 10px 4px',
      color: '#888',
      fontSize: '11px',
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
      borderBottom: '1px solid rgba(255,255,255,0.06)',
    }}>
      {children}
    </div>
  )
}

function Item({ item, index, reduced, onPick }) {
  return (
    <div
      onClick={() => { onPick(); item.cb() }}
      style={{
        padding: '7px 12px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        cursor: 'pointer',
        color: '#e8e8e8',
        fontSize: '13px',
        transition: `background ${DURATION.hover}ms ${EASING.out}`,
        // Staggered cascade — items never appear in lockstep (ADR-080)
        ...itemEnterMotion(index, reduced),
      }}
      onPointerEnter={e => { e.currentTarget.style.background = '#3a3a3a' }}
      onPointerLeave={e => { e.currentTarget.style.background = 'transparent' }}
    >
      <span>{item.label}</span>
      {item.hint && (
        <span style={{ color: '#888', fontSize: '11px', marginLeft: '12px' }}>
          {item.hint}
        </span>
      )}
    </div>
  )
}
