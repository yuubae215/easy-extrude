import { useState, useEffect } from 'react'
import { refsSignature, flashStyle } from '../../view/FeedbackMath.js'
import { prefersReducedMotion, onReducedMotionChange } from '../../theme/motion.js'
import { COLOR, rgba } from '../../theme/tokens.js'

/**
 * FeedbackPrimitives — the shared vocabulary of proof-feedback presentation
 * (ADR-062 Phase 1).
 *
 * These are the playful primitives proven in the grasp / intake threads
 * (ADR-058 save flash, ADR-061 delta chips), extracted so every input surface
 * wires the same loop: fact → pure derivation → visible "it worked".
 *
 * DISCIPLINE (PHILOSOPHY #29 / ADR-062):
 *   - Inputs are always *facts* (validator output, contract fields) or pure
 *     derivations over them (FeedbackMath). Nothing here judges, only shows.
 *   - Presentation history (the previous snapshot behind a delta / flash) is
 *     component-local React state — never a uiStore field (ADR-062 §2, same
 *     rule that keeps grasp hover out of the `context.grasp` union).
 *   - Zero / null change renders nothing (no chip, no flash) — silence is the
 *     honest rendering of "no change", not a failure (#11).
 */

// Keyframes shared by every landing flash (inline styles cannot express them).
// Green = a committed / settled fact landed; amber = an example flooded the
// form (the ADR-058 seed tint family). Mount `FeedbackDefs` once per overlay
// root; duplicate mounts are harmless (identical keyframes).
const FEEDBACK_CSS = `
@keyframes eaFlashGreen {
  0%   { background: ${rgba(COLOR.fxGreen, 0.28)}; }
  100% { background: transparent; }
}
@keyframes eaFlashAmber {
  0%   { background: ${rgba(COLOR.fxAmber, 0.3)}; }
  100% { background: transparent; }
}
`

export function FeedbackDefs() {
  return <style>{FEEDBACK_CSS}</style>
}

/**
 * Reduced-motion detection (ADR-064 Phase 4). The single side-effect boundary
 * MOVED to `src/theme/motion.js` (ADR-065 Phase 1) so the 3D tick loop's
 * MotionGovernor shares the same authority; re-exported here so every existing
 * DOM consumer keeps its import path — the boundary moved, it did not fork.
 */
export { prefersReducedMotion }

/**
 * Hook form: re-renders the consumer when the preference flips (a user toggling
 * the OS setting mid-session), so a live view degrades or re-animates without a
 * reload.
 */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(prefersReducedMotion)
  useEffect(() => onReducedMotionChange(setReduced), [])
  return reduced
}

/**
 * Inline-style fragment replaying the landing-flash animation. Merge into an
 * existing element's style when a wrapper div would break the layout
 * (e.g. IntakePanel's EntryCard). Reads `prefers-reduced-motion` at call time,
 * so under reduced motion it returns a static tint instead of a fade
 * (ADR-064 Phase 4). Shape derivation lives in the pure `flashStyle`.
 */
export function flashAnim(tone = 'green') {
  return flashStyle(tone, prefersReducedMotion())
}

/**
 * Landing-flash wrapper: replays the flash whenever `tick` changes while
 * `active` is true. `tick` should be a value that changes exactly when the
 * underlying facts change (e.g. the FeedbackMath refs signature) — the key
 * remount is what replays the CSS animation. Under reduced motion the wrapper
 * shows the static tint instead (the hook keeps it live across a preference
 * change).
 */
export function LandingFlash({ tick, active = true, tone = 'green', style, children }) {
  const reduced = useReducedMotion()
  return (
    <div key={tick ?? 'idle'} style={{ ...(active && tick != null ? flashStyle(tone, reduced) : {}), ...style }}>
      {children}
    </div>
  )
}

/**
 * Run-over-run delta chip: "did my input work?" at a glance (proven in the
 * ADR-061 grasp funnel). For "open items" style facts fewer is better
 * (goodWhenPositive=false); for "feasible candidates" more is. 0 / null
 * renders nothing — no change is no noise.
 */
export function DeltaChip({ value, goodWhenPositive, label }) {
  if (!value) return null
  const good = goodWhenPositive ? value > 0 : value < 0
  const arrow = value > 0 ? '▲' : '▼'
  return (
    <span style={{
      fontSize: '9px', padding: '0 4px', borderRadius: '3px', whiteSpace: 'nowrap',
      color: good ? '#8d8' : '#d88',
      background: good ? '#1c2e1c' : '#2e1c1c',
    }}>{arrow}{Math.abs(value)}{label ? ` ${label}` : ''}</span>
  )
}

/**
 * The previous snapshot of a fact list, updated only when the list *really*
 * changes (signature comparison absorbs the store's array-identity churn on
 * re-projection). Returns:
 *   - `prev` — the snapshot before the last real change (`null` until one lands;
 *     then it persists until the next change, like the grasp `prevDiagnostics`
 *     carry-over — the delta stays readable, it does not evaporate on rerender)
 *   - `tick` — the current signature; changes exactly when the facts change,
 *     so it doubles as the LandingFlash replay key
 *
 * An unkeyable list (signature null) never records history — no guessed deltas.
 */
export function usePrevOnChange(cur) {
  const sig = refsSignature(cur)
  const [h, setH] = useState({ sig, cur, prev: null })
  if (sig !== h.sig) setH({ sig, cur, prev: sig === null || h.sig === null ? null : h.cur })
  const changedNow = sig !== h.sig
  const prev = changedNow ? (sig === null || h.sig === null ? null : h.cur) : h.prev
  return { prev, tick: sig }
}
