import { useState, useEffect } from 'react'
import { CHROME_CSS } from '../../view/ChromeMath.js'
import { isNarrowViewport, NARROW_MEDIA_QUERY } from '../../view/Viewport.js'

/**
 * ChromePrimitives — the shared Tier A (affordance-motion) vocabulary for the
 * chrome layer (ADR-065 Phase 3), sibling of Feedback/FeedbackPrimitives.jsx
 * (Tier F). Style *shapes* are derived by the pure `ChromeMath`; this file
 * holds only the React-side plumbing (keyframe mount, interaction-state hook).
 *
 * Tier A discipline (PHILOSOPHY #30): everything here speaks about capability
 * ("pressable / engaged / locked"), never about a result; it is stateless with
 * respect to the domain — interaction state lives in component-local hooks.
 */

/** Keyframes shared by every Tier A chrome surface. Mount once per React root. */
export function ChromeDefs() {
  return <style>{CHROME_CSS}</style>
}

/**
 * Component-local hover/press interaction state + the pointer handlers that
 * drive it. Spread `handlers` onto the interactive element and feed
 * `hovered`/`pressed` (with `useReducedMotion()`) into `tierAMotion`.
 */
export function useHoverPress() {
  const [hovered, setHovered] = useState(false)
  const [pressed, setPressed] = useState(false)
  const handlers = {
    onPointerEnter:  () => setHovered(true),
    onPointerLeave:  () => { setHovered(false); setPressed(false) },
    onPointerDown:   () => setPressed(true),
    onPointerUp:     () => setPressed(false),
    onPointerCancel: () => setPressed(false),
  }
  return { hovered, pressed, handlers }
}

/**
 * 「この画面は狭いレイアウトか」— **React 側の唯一の購読口** (ADR-114)。
 *
 * 同じ実装が `Header` / `NPanel` / `MobileToolbar` に各自コピーされていた。
 * 判定そのものは `view/Viewport.js` が持ち、ここはその購読だけを持つ
 * (述語を 2 度書かない — §1.1)。
 */
export function useIsNarrowViewport() {
  const [narrow, setNarrow] = useState(isNarrowViewport)
  useEffect(() => {
    const mq = window.matchMedia(NARROW_MEDIA_QUERY)
    const handler = (e) => setNarrow(e.matches)
    mq.addEventListener('change', handler)
    // 購読を張るまでのあいだに幅が変わっていることがある (初期化は render 時)。
    setNarrow(mq.matches)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return narrow
}
