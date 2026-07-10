/**
 * motion.js — the single reduced-motion side-effect boundary (ADR-065 Phase 1).
 *
 * MOVED here from `src/components/Feedback/FeedbackPrimitives.jsx` (ADR-064
 * Phase 4) so that BOTH layers — DOM proof-feedback primitives AND the 3D tick
 * loop (`MotionGovernor`) — consult one authority. The boundary MOVES, it never
 * FORKS (核 §1.1): the ONLY read of `matchMedia('(prefers-reduced-motion: …)')`
 * in the codebase lives in this file, pinned by the grep test in
 * `src/theme/motion.test.js`. New animated surfaces import from here (or from
 * the FeedbackPrimitives re-export); they never call matchMedia inline.
 *
 * Guarded for non-browser environments (node --test / SSR): no `matchMedia`
 * → `false` = motion allowed, leaving default rendering unchanged.
 */

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

/** @returns {boolean} true when the OS/browser asks for reduced motion. */
export function prefersReducedMotion() {
  return typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(REDUCED_MOTION_QUERY).matches
}

/**
 * Subscribe to live preference flips (a user toggling the OS setting
 * mid-session). Consumers: the `useReducedMotion` React hook and any
 * long-lived view that must degrade/re-animate without a reload.
 * @param {(reduced: boolean) => void} cb
 * @returns {() => void} unsubscribe (no-op in non-browser environments)
 */
export function onReducedMotionChange(cb) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const mq = window.matchMedia(REDUCED_MOTION_QUERY)
  const onChange = () => cb(mq.matches)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}
