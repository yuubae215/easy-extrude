import { useUIStore } from '../../store/uiStore.js'
import { ContextInspector } from './ContextInspector.jsx'
import { DecisionCard } from './DecisionCard.jsx'
import { StoryBar } from './StoryBar.jsx'

/**
 * ContextDemoLayer — root of the Context DSL demo overlay (ADR-047).
 * Renders nothing unless the demo is active; all three children read the
 * `demo` slice and fire `callbacks.onDemo*` registered by ContextDemoController.
 */
export function ContextDemoLayer() {
  const active = useUIStore(s => s.demo.active)
  if (!active) return null
  return (
    <>
      <ContextInspector />
      <DecisionCard />
      <StoryBar />
    </>
  )
}
