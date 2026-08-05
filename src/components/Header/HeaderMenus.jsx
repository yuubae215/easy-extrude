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

import { useState, useRef, useEffect, useCallback } from 'react'
import { useUIStore } from '../../store/uiStore.js'
import { COLOR } from '../../theme/tokens.js'
import { tierAMotion, enterMotion } from '../../view/ChromeMath.js'
import { useReducedMotion } from '../Feedback/FeedbackPrimitives.jsx'
import { useHoverPress } from '../Chrome/ChromePrimitives.jsx'
import { iconFor } from './HeaderIcons.js'
import { menuFor, availabilityOf, OVERFLOW_VERBS } from '../../view/HeaderEntrances.js'
import { documentAdopted } from '../../view/DocPresence.js'
import { isInsideDropdown } from '../../view/DropdownContainment.js'
import {
  CLOSED, isMenuOpen, toggleMenu, closeMenu, descendTo, ascend, verbOf,
} from '../../view/OverflowMenuState.js'

// ── shared dropdown plumbing ──────────────────────────────────────────────

/**
 * Open state + fixed positioning + outside-click close.
 *
 * The panel is positioned with `position:fixed` off the trigger's rect rather
 * than nested inside the header, because the header sets `overflow:hidden`
 * (Yellow Card: "Overflow-escaping popups belong on body").
 *
 * Because the panel is not nested inside the trigger, "did this click land
 * inside me?" needs BOTH elements. Asking the trigger alone (what this hook
 * used to do) makes every in-panel click read as an outside click — invisible
 * on desktop, where selecting a row wants to close anyway, and fatal on the
 * two-level `⋯`, where the first level's rows only change the level. The
 * predicate has one owner now (`view/DropdownContainment.js`), so the second
 * implementation in `ModeDropdown` cannot drift away from it (§1.1).
 *
 * The hook does NOT own whether the menu is open — the caller does, because the
 * `⋯` menu's "open" is not a boolean but a level (`view/OverflowMenuState.js`).
 * Keeping a private `open` here as well would be the same fact in two places
 * (§1.1), and it is exactly that split that let `{closed, verb:'export'}` exist.
 *
 * @param {object} opts
 * @param {boolean} opts.open           is the caller's menu open right now
 * @param {() => void} opts.onToggle    trigger pressed
 * @param {() => void} opts.onOutsideClick  a click landed outside trigger+surface
 */
function useDropdown({ open, onToggle, onOutsideClick }) {
  const btnRef     = useRef(null)
  const surfaceRef = useRef(null)
  const [pos, setPos] = useState({ top: 40, right: 8 })

  // `pointerdown`, not `click`: by the time a `click` listener on `document`
  // runs, React has already flushed the state change the row's own onClick
  // made, so the clicked row can be **detached from the document** — and a
  // detached node is inside nothing, which reads as an outside click no matter
  // how good the predicate is. Deciding on pointerdown asks the question while
  // the target is still in the tree. (Same reason `ModalLayer` and
  // `Onboarding` dismiss on pointerdown.)
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (!isInsideDropdown(e.target, { trigger: btnRef.current, surface: surfaceRef.current })) {
        onOutsideClick()
      }
    }
    document.addEventListener('pointerdown', handler)
    return () => document.removeEventListener('pointerdown', handler)
  }, [open, onOutsideClick])

  function toggle(e) {
    e.stopPropagation()
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      setPos({ top: rect.bottom, right: window.innerWidth - rect.right })
    }
    onToggle()
  }

  return { btnRef, surfaceRef, pos, toggle }
}

function MenuSurface({ pos, minWidth = '230px', surfaceRef, children }) {
  const reduced = useReducedMotion()
  return (
    <div ref={surfaceRef} style={{
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
  //
  // The comparison itself moved to `documentAdopted` when ADR-111 gave it a
  // second reader (the navigator's semantic side): one derivation written twice
  // is a second source too, even when both copies happen to agree today (§1.1).
  const contextLoaded = useUIStore(documentAdopted)
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
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const { btnRef, surfaceRef, pos, toggle } = useDropdown({
    open, onToggle: () => setOpen(o => !o), onOutsideClick: close,
  })
  const facts = useAvailabilityFacts()
  const menu  = menuFor(verb)   // throws on an undeclared verb

  return (
    <>
      <MenuTrigger btnRef={btnRef} open={open} onClick={toggle}
                   icon={menu.icon} label={menu.label} title={menu.title} />
      {open && (
        <MenuSurface pos={pos} surfaceRef={surfaceRef}>
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
 *
 * The level is part of ONE state (`view/OverflowMenuState.js`), not a second
 * `verb` field beside a boolean. Held apart, the pair could express
 * `{closed, verb:'export'}` — and did: pressing `Export ›` closed the menu
 * without descending, and the next press of `⋯` opened straight into Export's
 * objects. Reopening starts at the verbs level *by construction* now, so no
 * future close path has to remember to reset it.
 */
export function MoreMenu() {
  const callbacks = useUIStore(s => s.callbacks)
  const [menuState, setMenuState] = useState(CLOSED)
  const close = useCallback(() => setMenuState(closeMenu()), [])
  const { btnRef, surfaceRef, pos, toggle } = useDropdown({
    open: isMenuOpen(menuState),
    onToggle: () => setMenuState(toggleMenu),
    onOutsideClick: close,
  })
  const facts = useAvailabilityFacts()
  const reduced = useReducedMotion()

  const open = isMenuOpen(menuState)
  const verb = verbOf(menuState)
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
        <MenuSurface pos={pos} minWidth="220px" surfaceRef={surfaceRef}>
          {menu === null
            ? OVERFLOW_VERBS.map(v => {
                const m = menuFor(v)
                return (
                  <MenuRow key={v} icon={m.icon} label={m.label} enabled reason={null}
                           trailing="›" onSelect={() => setMenuState(s => descendTo(s, v))} />
                )
              })
            : (
              <>
                <MenuRow icon="back" label={menu.label} enabled reason={null}
                         onSelect={() => setMenuState(ascend)} />
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
