/**
 * HeaderMenus — the header's verb entrances (ADR-108 D1).
 *
 * One component renders every verb menu, because the difference between
 * `Export ▾` and `Start ▾` is **data, not code**: the trigger row and the
 * argument list both come from `src/view/HeaderEntrances.js`. Writing a second
 * bespoke dropdown is how the flat six grew in the first place — each one was
 * cheap on its own day.
 *
 * Two shapes live here:
 *
 *   - `VerbMenu` — desktop. One trigger per verb; the objects are its items.
 *   - `MoreMenu` — mobile `⋯`. Two levels: **verbs first**, then that verb's
 *     objects. The narrow screen folds the verbs themselves, but the set of
 *     verbs is the same one desktop shows (`OVERFLOW_VERBS`), so the two
 *     layouts cannot drift apart.
 *
 * Unavailable arguments are **disabled with their reason**, never removed
 * (原則 #15 / #11) — `Save`/`Load` used to disappear whole when the BFF was
 * down, which made the entrance count a function of the connection state.
 *
 * @see docs/adr/ADR-108-entrances-are-verbs-not-objects.md
 * @module components/Header/HeaderMenus
 */

import { useState, useRef, useEffect } from 'react'
import { useUIStore } from '../../store/uiStore.js'
import { COLOR } from '../../theme/tokens.js'
import { tierAMotion, enterMotion } from '../../view/ChromeMath.js'
import { useReducedMotion } from '../Feedback/FeedbackPrimitives.jsx'
import { useHoverPress } from '../Chrome/ChromePrimitives.jsx'
import { iconFor } from './HeaderIcons.js'
import { menuFor, availabilityOf, OVERFLOW_VERBS } from '../../view/HeaderEntrances.js'
import { DISCOVERY_KIND } from '../../context/DiscoverySummary.js'

// ── shared dropdown plumbing ──────────────────────────────────────────────

/**
 * Open state + fixed positioning + outside-click close.
 *
 * The panel is positioned with `position:fixed` off the trigger's rect rather
 * than nested inside the header, because the header sets `overflow:hidden`
 * (Yellow Card: "Overflow-escaping popups belong on body").
 */
function useDropdown() {
  const [open, setOpen] = useState(false)
  const btnRef = useRef(null)
  const [pos, setPos] = useState({ top: 40, right: 8 })

  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (!btnRef.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [open])

  function toggle(e) {
    e.stopPropagation()
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      setPos({ top: rect.bottom, right: window.innerWidth - rect.right })
    }
    setOpen(o => !o)
  }

  return { open, setOpen, btnRef, pos, toggle }
}

function MenuSurface({ pos, minWidth = '230px', children }) {
  const reduced = useReducedMotion()
  return (
    <div style={{
      position: 'fixed', top: pos.top, right: pos.right,
      background: COLOR.surfaceSunken, border: '1px solid #555', borderRadius: '6px',
      overflow: 'hidden', zIndex: '200', minWidth,
      boxShadow: '0 4px 16px rgba(0,0,0,0.6)', pointerEvents: 'auto',
      ...enterMotion(reduced),
    }}>
      {children}
    </div>
  )
}

/**
 * One argument row. `enabled` and `reason` arrive from the same predicate
 * return value (`availabilityOf`) — the row cannot show a lock without also
 * being able to say why (原則 #11 / #25).
 */
function MenuRow({ icon, label, shortcut, enabled, reason, trailing, onSelect }) {
  const pushToast = useUIStore(s => s.actions.pushToast)
  return (
    <button
      key={label}
      onClick={() => { if (enabled) { onSelect() } else if (reason) { pushToast(reason, 'info') } }}
      aria-disabled={!enabled || undefined}
      title={enabled ? undefined : reason ?? undefined}
      style={{
        display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
        padding: '9px 14px', background: 'transparent',
        border: 'none', borderBottom: '1px solid #3a3a3a',
        color: enabled ? COLOR.textPrimary : COLOR.textSecondary,
        cursor: enabled ? 'pointer' : 'help',
        fontSize: '13px', fontFamily: 'system-ui, -apple-system, sans-serif',
        textAlign: 'left', pointerEvents: 'auto',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = '#3a3a3a' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
    >
      <span dangerouslySetInnerHTML={{ __html: iconFor(icon) }} style={{ display: 'flex', opacity: enabled ? 1 : 0.5 }} />
      <span style={{ flex: '1' }}>{label}</span>
      {shortcut && <span style={{ color: COLOR.textSecondary, fontSize: '11px' }}>{shortcut}</span>}
      {trailing && <span style={{ color: COLOR.textSecondary, fontSize: '11px' }}>{trailing}</span>}
    </button>
  )
}

/** The facts every `requires` gate is resolved against — read in one place. */
function useAvailabilityFacts() {
  const bffConnected  = useUIStore(s => s.bffConnected)
  // "Is a document adopted?" is derived from the ONE projection `ContextService`
  // drives (ADR-105 D2's discovery union), never from a store mirror of the same
  // fact (ADR-106 D4). This line used to read `context.loaded` — a field with one
  // writer and zero readers, which ADR-106 retired precisely because an unused
  // second source drifts the moment it acquires its first reader. It acquired one
  // here, in the very next PR, which is the falsification ADR-106's GSN named:
  // the answer is not to bring the mirror back but to read the projection.
  const contextLoaded = useUIStore(s => s.context.discovery.kind !== DISCOVERY_KIND.UNEXAMINED)
  // A coarse pointer has no quest tour (ADR-065 seeds it for fine pointers only).
  const finePointer = typeof window !== 'undefined' && window.matchMedia
    ? !window.matchMedia('(pointer: coarse)').matches
    : true
  return { bffConnected, contextLoaded, finePointer }
}

/** Trigger button shared by every verb menu (and by the ⋯ overflow). */
function MenuTrigger({ btnRef, open, onClick, icon, label, title, ariaLabel }) {
  const reduced = useReducedMotion()
  const { hovered, pressed, handlers } = useHoverPress()
  return (
    <button
      ref={btnRef}
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
      aria-expanded={open}
      {...handlers}
      style={{
        padding: '4px 8px', background: hovered ? 'rgba(255,255,255,0.07)' : 'transparent',
        border: `1px solid ${open ? COLOR.infoTone : hovered ? '#4a4a4a' : '#3a3a3a'}`,
        borderRadius: '5px',
        color: open ? '#5a9bf5' : hovered ? '#ccc' : '#aaa',
        cursor: 'pointer', fontSize: '11px',
        fontFamily: 'system-ui, -apple-system, sans-serif', lineHeight: '1',
        flexShrink: '0', display: 'flex', alignItems: 'center', gap: '4px',
        pointerEvents: 'auto',
        ...tierAMotion({ hovered, pressed, reduced }),
      }}
    >
      <span dangerouslySetInnerHTML={{ __html: iconFor(icon) }} style={{ display: 'flex' }} />
      <span>{label} ▾</span>
    </button>
  )
}

// ── desktop: one entrance per verb ────────────────────────────────────────

/**
 * A verb entrance. `verb` is the only prop — everything else is declared.
 *
 * The census (`src/HeaderEntranceCensus.test.js`) reads this call site's
 * `verb={HEADER_VERB.X}` straight out of the JSX, so a new entrance cannot
 * appear in the header without also appearing in `HEADER_ENTRANCES`.
 */
export function VerbMenu({ verb }) {
  const callbacks = useUIStore(s => s.callbacks)
  const { open, setOpen, btnRef, pos, toggle } = useDropdown()
  const facts = useAvailabilityFacts()
  const menu  = menuFor(verb)   // throws on an undeclared verb

  return (
    <>
      <MenuTrigger btnRef={btnRef} open={open} onClick={toggle}
                   icon={menu.icon} label={menu.label} title={menu.title} />
      {open && (
        <MenuSurface pos={pos}>
          {menu.items.map(item => {
            const { enabled, reason } = availabilityOf(item, facts)
            return (
              <MenuRow key={item.key} icon={menu.icon} label={item.label}
                       shortcut={item.shortcut} enabled={enabled} reason={reason}
                       onSelect={() => { setOpen(false); callbacks[item.callback]?.() }} />
            )
          })}
        </MenuSurface>
      )}
    </>
  )
}

// ── mobile: the verbs themselves are folded, the objects stay arguments ───

/**
 * `⋯` — two levels: verbs, then that verb's objects.
 *
 * Flattening every object into one list (what this menu used to do, 11 rows)
 * reproduces the product on the small screen, where there is even less room
 * to read it. Nesting by verb keeps the first screen at four rows and keeps
 * the mobile entrance set equal to the desktop one.
 */
export function MoreMenu() {
  const callbacks = useUIStore(s => s.callbacks)
  const { open, setOpen, btnRef, pos, toggle } = useDropdown()
  const [verb, setVerb] = useState(null)
  const facts = useAvailabilityFacts()
  const reduced = useReducedMotion()

  function close() { setOpen(false); setVerb(null) }
  const menu = verb ? menuFor(verb) : null

  return (
    <>
      <button
        ref={btnRef}
        aria-label="More actions"
        aria-expanded={open}
        onClick={toggle}
        style={{
          padding: '6px', background: 'transparent', border: 'none',
          color: '#c0c0c0', cursor: 'pointer', lineHeight: '1',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: '0', borderRadius: '6px', pointerEvents: 'auto',
          ...tierAMotion({ hovered: false, pressed: false, reduced }),
        }}
        dangerouslySetInnerHTML={{ __html: iconFor('more') }}
      />
      {open && (
        <MenuSurface pos={pos} minWidth="220px">
          {menu === null
            ? OVERFLOW_VERBS.map(v => {
                const m = menuFor(v)
                return (
                  <MenuRow key={v} icon={m.icon} label={m.label} enabled reason={null}
                           trailing="›" onSelect={() => setVerb(v)} />
                )
              })
            : (
              <>
                <MenuRow icon="back" label={menu.label} enabled reason={null}
                         onSelect={() => setVerb(null)} />
                {menu.items.map(item => {
                  const { enabled, reason } = availabilityOf(item, facts)
                  return (
                    <MenuRow key={item.key} icon={menu.icon} label={item.label}
                             shortcut={item.shortcut} enabled={enabled} reason={reason}
                             onSelect={() => { close(); callbacks[item.callback]?.() }} />
                  )
                })}
              </>
            )}
        </MenuSurface>
      )}
    </>
  )
}
