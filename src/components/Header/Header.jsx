import { useUIStore } from '../../store/uiStore.js'
import { ModeDropdown } from './ModeDropdown.jsx'
import { COLOR } from '../../theme/tokens.js'
import { tierAMotion, lockedStyle } from '../../view/ChromeMath.js'
import { gateUndo, gateRedo } from '../../view/ChromeGates.js'
import { useReducedMotion } from '../Feedback/FeedbackPrimitives.jsx'
import { useHoverPress, useIsNarrowViewport } from '../Chrome/ChromePrimitives.jsx'
import { HEADER_METRICS } from '../../view/EdgeOccupancy.js'
import { DiscoveryCounters } from '../Chrome/DiscoveryCounters.jsx'
import { VerbMenu, MoreMenu } from './HeaderMenus.jsx'
import { iconFor } from './HeaderIcons.js'
import {
  HEADER_VERB, SURFACE, surfaceToggleFor, availabilityOf,
} from '../../view/HeaderEntrances.js'

/**
 * Header — React replacement for UIView's 40px top bar.
 *
 * ## Entrances are verbs, not objects (ADR-108)
 *
 * The header used to carry the **product** `動詞 × 対象`: two file verbs times
 * three targets was six flat buttons, and "start" times five kinds was five
 * more. That grows without bound — every new target lengthens the bar — so the
 * product was folded: the objects became **arguments** inside one entrance per
 * verb, and the entrance count is now a function of the verb enum alone.
 *
 * Which elements here count as entrances is declared in
 * `src/view/HeaderEntrances.js` and counted by `src/HeaderEntranceCensus.test.js`
 * (the population is derived from this file's JSX, not from a hand-written
 * list — ADR-102). The count is ratcheted: it fails if it rises **or** falls.
 *
 * Mobile layout  (<768px):  [☰] [↩] [↪] [Mode▾] [··spacer··] [◌] [⋯] [N]
 * Desktop layout (≥768px):  [Mode▾] [Nodes] [··status··] [Start▾] [Export▾] [Import▾] [◌] [Context▾]
 *
 * Nothing here disappears with the BFF connection any more: `Nodes`, `Save`,
 * `Load` are shown with their reason when unavailable (原則 #15 / #11), so the
 * entrance count does not depend on the connection state.
 *
 * ## 入口は数えるだけでなく**届かなければならない** (ADR-114)
 *
 * `overflow:hidden` は下の popup が逃げる前提であって、**入口を切る許可ではない**。
 * 住人の合計幅が最小対応幅を超えると、右端の入口 (N パネルのトグル) が 1px も
 * 画面に出ないまま DOM には在り続け、census は 7 個を数えて緑を出す。したがって
 * 寸法は自分で決めず `HEADER_METRICS` から読み、合計は `TOP_EDGE_OCCUPANTS` の
 * 予算が持つ (原則 #26 — 端は共有資源で、占有量の計算は 1 箇所)。
 *
 * 狭レイアウトで落とすのは**文字ラベルだけ**で、入口そのものは落とさない
 * (原則 #15)。落ちた語は `title` / `aria-label` に残るので、読み上げと長押しでは
 * 同じことが言える。
 */
export function Header() {
  const narrow = useIsNarrowViewport()

  return (
    <header style={{
      position:    'fixed',
      top:         '0',
      left:        '0',
      right:       '0',
      height:      '40px',
      background:  '#242424',
      borderBottom:'1px solid #141414',
      display:     'flex',
      alignItems:  'center',
      padding:     `0 ${HEADER_METRICS.padX}px`,
      gap:         `${narrow ? HEADER_METRICS.gap.narrow : HEADER_METRICS.gap.wide}px`,
      zIndex:      '100',
      overflow:    'hidden',
      userSelect:  'none',
      fontFamily:  'system-ui, -apple-system, sans-serif',
      pointerEvents: 'auto',
      boxSizing:   'border-box',
    }}>
      {narrow ? <MobileHeaderContents /> : <DesktopHeaderContents />}
    </header>
  )
}

// ── Mobile header ─────────────────────────────────────────────────────────

function MobileHeaderContents() {
  const callbacks   = useUIStore(s => s.callbacks)
  const pushToast   = useUIStore(s => s.actions.pushToast)
  const undoEnabled = useUIStore(s => s.undoEnabled)
  const redoEnabled = useUIStore(s => s.redoEnabled)
  // disabled-as-quest (ADR-065 named rule 5): the disable flag AND its reason
  // come from the same gate-predicate return value.
  const gUndo = gateUndo(undoEnabled)
  const gRedo = gateRedo(redoEnabled)
  return (
    <>
      <IconBtn icon="hamburger" label="Toggle outliner"       onClick={() => callbacks.onOutlinerToggle?.()} narrow />
      <IconBtn icon="undo"      label="Undo"                  onClick={() => callbacks.onUndoClick?.()}      border narrow disabled={!gUndo.enabled} reason={gUndo.reason} onLockedTap={(r) => pushToast(r, 'info')} />
      <IconBtn icon="redo"      label="Redo"                  onClick={() => callbacks.onRedoClick?.()}      border narrow disabled={!gRedo.enabled} reason={gRedo.reason} onLockedTap={(r) => pushToast(r, 'info')} />
      <ModeDropdown compact />
      {/* Invisible flex:1 spacer — keeps ⋯ and N right-aligned (matching UIView's visibility:hidden pattern) */}
      <div style={{ flex: '1', visibility: 'hidden' }} />
      {/* Compact on mobile: glyphs + numbers, no words. Present on BOTH layouts —
          "the small screen can skip it" would make the circular dependency
          ADR-105 closed come back for exactly the users with the least room to
          go looking (ADR-105 D1). */}
      <DiscoveryCounters compact />
      <MoreMenu />
      <IconBtn icon="npanel" label="Toggle properties panel" onClick={() => callbacks.onNPanelToggle?.()} narrow />
    </>
  )
}

// ── Desktop header ────────────────────────────────────────────────────────

function DesktopHeaderContents() {
  return (
    <>
      <ModeDropdown />
      {/* D4 — the Node Editor is a SECOND EDITOR, not a file action. It used to
          sit beside Save / Load because all three shared the display condition
          "only while the BFF is connected"; a shared display condition is not a
          reason to share an address. Its verb is `toggle-surface`. */}
      <SurfaceToggle surface={SURFACE.NODE_EDITOR} />
      <HeaderStatus />
      <VerbMenu verb={HEADER_VERB.START} />
      <VerbMenu verb={HEADER_VERB.EXPORT} />
      <VerbMenu verb={HEADER_VERB.IMPORT} />
      {/* The discovery aggregate is PERMANENT chrome (ADR-105 D1) — it must be
          readable without opening the floor, because its whole job is to tell you
          whether the floor needs opening. It sits next to Context ▾ (the floor's
          entrance) so the reading and the door are one glance apart. */}
      <DiscoveryCounters compact />
      <VerbMenu verb={HEADER_VERB.OPEN_FLOOR} />
    </>
  )
}

// ── Shared sub-components ─────────────────────────────────────────────────

// The `Map` button was removed by ADR-103. It was a single control that changed
// four things at once — camera orientation, projection, the left toolbar and the
// top-level mode — so none of them could be chosen independently. Its parts went
// back to controls that already existed: orientation → the world gizmo,
// projection → ProjectionToggle beside it, drawing tools → the `+ Add` menu.

// Robot placement moved out of the header in ADR-084 §2: the robot geometry is
// now the `robot_base` / `tcp` CoordinateFrame entities (edited via the CF gizmo
// / N-panel), so the former X/Y header inputs were removed. The show/hide toggle
// was removed too (ADR-087): the robot skeleton is the geometry of the
// `robot_base` entity, so its visibility is governed by that entity's Outliner
// eye icon (原則 #4 — one owner), the same control every other entity uses.

function HeaderStatus() {
  const parts = useUIStore(s => s.statusParts)
  return (
    <div style={{
      flex:           '1',
      display:        'flex',
      alignItems:     'center',
      justifyContent: 'center',
      gap:            '2px',
      fontSize:       '12px',
      fontFamily:     'system-ui, -apple-system, sans-serif',
      pointerEvents:  'none',
      overflow:       'hidden',
      minWidth:       '0',
    }}>
      {parts.map((part, i) => (
        <span key={i} style={{ display: 'flex', alignItems: 'center' }}>
          {i > 0 && <span style={{ color: '#4a4a4a', margin: '0 4px' }}>·</span>}
          <span style={{
            color:         part.color ?? '#c8c8c8',
            fontWeight:    part.bold ? 'bold' : 'normal',
            letterSpacing: part.bold ? '0.02em' : 'normal',
          }}>
            {part.text}
          </span>
        </span>
      ))}
    </div>
  )
}

function IconBtn({ icon, label, onClick, border = false, disabled = false, reason = null, onLockedTap = null, narrow = false }) {
  const reduced = useReducedMotion()
  const { hovered, pressed, handlers } = useHoverPress()
  // 横 padding は自分で決めない — 上端の幅は共有資源で、予算と描画は同じ数を読む
  // (原則 #26 / ADR-114)。縦は端の資源ではないので従来どおり。
  const padX = narrow ? HEADER_METRICS.iconPadX.narrow : HEADER_METRICS.iconPadX.wide
  // disabled-as-quest: the locked state is stylized (dashed border, legible
  // glyph) and a tap surfaces the gate reason — never a silent no-op (#11).
  function handleClick() {
    if (disabled) {
      if (reason && onLockedTap) onLockedTap(reason)
      return
    }
    onClick?.()
  }
  return (
    <button
      aria-label={label}
      aria-disabled={disabled || undefined}
      title={disabled && reason ? reason : undefined}
      onClick={handleClick}
      {...(disabled ? {} : handlers)}
      style={{
        padding:      `5px ${padX}px`,
        background:   !disabled && hovered ? 'rgba(255,255,255,0.07)' : 'transparent',
        border:       border ? '1px solid #3a3a3a' : 'none',
        borderRadius: '6px',
        color:        disabled ? '#5f5f5f' : '#c0c0c0',
        cursor:       disabled ? 'help' : 'pointer',
        lineHeight:   '1',
        display:      'flex',
        alignItems:   'center',
        justifyContent: 'center',
        flexShrink:   '0',
        pointerEvents:'auto',
        ...(disabled
          ? (border ? lockedStyle() : { cursor: 'help' })
          : tierAMotion({ hovered, pressed, reduced })),
      }}
      dangerouslySetInnerHTML={{ __html: iconFor(icon) }}
    />
  )
}

function SmallBtn({ onClick, title, children, active = false, icon, disabled = false, reason = null }) {
  const reduced = useReducedMotion()
  const { hovered, pressed, handlers } = useHoverPress()
  const pushToast = useUIStore(s => s.actions.pushToast)
  return (
    <button
      onClick={() => { if (disabled) { if (reason) pushToast(reason, 'info') } else onClick?.() }}
      title={disabled && reason ? reason : title}
      aria-disabled={disabled || undefined}
      {...(disabled ? {} : handlers)}
      style={{
        padding:      '4px 8px',
        background:   hovered ? 'rgba(255,255,255,0.07)' : 'transparent',
        border:       `1px solid ${active ? COLOR.infoTone : hovered ? '#4a4a4a' : '#3a3a3a'}`,
        borderRadius: '5px',
        color:        active ? '#5a9bf5' : hovered ? '#ccc' : '#aaa',
        cursor:       disabled ? 'help' : 'pointer',
        fontSize:     '11px',
        fontFamily:   'system-ui, -apple-system, sans-serif',
        lineHeight:   '1',
        flexShrink:   '0',
        display:      'flex',
        alignItems:   'center',
        gap:          '4px',
        pointerEvents:'auto',
        ...(disabled ? lockedStyle() : tierAMotion({ hovered, pressed, reduced })),
      }}
    >
      {icon && <span dangerouslySetInnerHTML={{ __html: iconFor(icon) }} style={{ display: 'flex', opacity: disabled ? 0.5 : 1 }} />}
      {children}
    </button>
  )
}

// ── Surface toggles (ADR-108 D4) ──────────────────────────────────────────

/**
 * A workspace surface's switch. Its verb is `toggle-surface`, so it is **not**
 * folded into a menu: a toggle is the visible state of its surface, and hiding
 * it behind a menu costs both a step and the state read (原則 #15 / #4).
 *
 * It is also never removed. When the surface's requirement is unmet the button
 * stays and carries the reason — that is what keeps the entrance count
 * independent of the BFF connection.
 */
function SurfaceToggle({ surface }) {
  const decl        = surfaceToggleFor(surface)   // throws on an undeclared surface
  const callbacks   = useUIStore(s => s.callbacks)
  const bffConnected = useUIStore(s => s.bffConnected)
  const active      = useUIStore(s => s[decl.activeFlag])
  const { enabled, reason } = availabilityOf(decl, { bffConnected, contextLoaded: false, finePointer: true })
  return (
    <SmallBtn
      onClick={() => callbacks[decl.callback]?.()}
      title={decl.title}
      active={!!active && enabled}
      icon={decl.icon}
      disabled={!enabled}
      reason={reason}
    >
      {decl.label}
    </SmallBtn>
  )
}

// ── Retired here, declared elsewhere ──────────────────────────────────────
//
// `ContextDropdown` and the flat `MoreMenu` used to live in this file, each
// listing its own hand-written `item(...)` rows. Two bespoke dropdowns meant
// two places to add the next object to — which is exactly how six flat file
// buttons and five separate "start" doors accumulated. Both are now one
// component (`HeaderMenus.jsx`) driven by one declaration
// (`src/view/HeaderEntrances.js`), so an object can only be added as an
// ARGUMENT of a verb, never as a new entrance (ADR-108 D1/D2).

// ── Hook ─────────────────────────────────────────────────────────────────
//
// `useIsMobile()` はここに在った。同じ実装が `NPanel` と `MobileToolbar` にも
// コピーされており、さらに `UIShell` と `AppController` は購読を持たない生の
// `window.innerWidth < 768` を書いていた。判定は `view/Viewport.js`、購読は
// `Chrome/ChromePrimitives.jsx` の `useIsNarrowViewport()` ただ 1 つ (ADR-114 / §1.1)。
