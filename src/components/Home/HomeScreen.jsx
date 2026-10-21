import { useState } from 'react'
import { useUIStore } from '../../store/uiStore.js'
import { LAYOUT_TEMPLATE_CATALOG } from '../../layout/LayoutTemplateCatalog.js'
import { useReducedMotion } from '../Feedback/FeedbackPrimitives.jsx'
import { enterMotion, itemEnterMotion, itemEnterDelay, tierAMotion } from '../../view/ChromeMath.js'
import { SCREEN_CLAIM, SCREEN_TIER, stageIs, tierZIndex } from '../../view/ScreenClaim.js'
import { PLAN_FRAME, planLightDelay, planTones, poolBreathTiming } from '../../view/LayoutPlanMath.js'
import { BACKDROP } from '../../view/StageMath.js'
import { COLOR, DURATION, EASING, rgba } from '../../theme/tokens.js'

/**
 * HomeScreen — the app's launch / Home overlay (ADR-089, screen S-19).
 *
 * Shown on startup (unless skipped via `ee_home`) over the BootReveal stage, so
 * the first move is *recognition* — pick a process layout — instead of *recall*
 * on a blank canvas. This is the **Layout DSL** entry, distinct from the Context
 * DSL New Project gallery (ADR-051 / TemplateGallery.jsx).
 *
 * State: the `stage` claim (`uiStore.stage`, ADR-113) — this screen is on iff it
 * is the one claim holding the stage, so it can no longer be silently covered by
 * the New Project gallery (both used to render at a hand-picked z-index 300 and
 * the winner was UIShell's mount order). The z comes from the tier owner, never
 * from a literal here. Sole writer AppController via `claimStage`/`releaseStage`.
 * This component only reads and fires callbacks:
 *   onSelectLayoutTemplate(id) — load a layout template (scene replacement)
 *   onStartEmptyProject()      — replace the scene with the default one (Empty card)
 *   onToggleHomeSkip(bool)     — persist the Blender-style skip preference
 *   onCloseHome()              — ✕ (close onto whatever scene is loaded)
 *
 * Motion (ADR-166 M4c — the motion identity in CLAUDE.md): the panel enters
 * via `enterMotion`, the cards follow in reading order (`itemEnterMotion` — no
 * lockstep), and each card's floor plan then lights outward from where the
 * light falls (`LayoutPlanMath` — Tier D delight on the one opening occasion).
 * Pointing at a card lights it with the ONE stage light (border, glow and the
 * plan's pool — Tier A affordance; the accent is not used: nothing is being
 * operated on yet). Idle, each card's pool breathes with the stage's own
 * breath, phased by the template's identity. Under reduced motion the final
 * lit state is the whole show (PHILOSOPHY #30/#11). The overlay does NOT
 * dismiss on backdrop click — a launch choice is deliberate (Empty is an
 * explicit card / ✕).
 *
 * Colours are tokens or derived from them — the scrim is the stage's own
 * backdrop (`BACKDROP`), the light is `STAGE_LIGHT` through `planTones`.
 */
export function HomeScreen() {
  const stage     = useUIStore(s => s.stage)
  const callbacks = useUIStore(s => s.callbacks)
  const plans     = useUIStore(s => s.launchHomePlans)
  const reduced   = useReducedMotion()
  const [hot, setHot] = useState(null)

  // The skip preference authority is localStorage (ee_home); mirror it into the
  // checkbox once so toggling reflects the persisted setting.
  const [skip, setSkip] = useState(() => {
    try { return localStorage.getItem('ee_home') === 'skip' } catch { return false }
  })

  if (!stageIs(stage, SCREEN_CLAIM.LAUNCH_HOME)) return null

  const select = (id) => callbacks.onSelectLayoutTemplate?.(id)
  const empty  = () => callbacks.onStartEmptyProject?.()
  const close  = () => callbacks.onCloseHome?.()
  const toggleSkip = (checked) => {
    setSkip(checked)
    callbacks.onToggleHomeSkip?.(checked)
  }

  const groups = []
  for (const t of LAYOUT_TEMPLATE_CATALOG) {
    let g = groups.find(x => x.category === t.category)
    if (!g) { g = { category: t.category, items: [] }; groups.push(g) }
    g.items.push(t)
  }
  // Cards enter in reading order across groups — one stagger, not one per group.
  const order = new Map(groups.flatMap(g => g.items).map((t, i) => [t.id, i]))
  const tones = planTones()

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: tierZIndex(SCREEN_TIER.STAGE),
        // Semi-transparent scrim so the living BootReveal stage glows behind the
        // launch screen (ADR-089 §1 — a living stage, not a dead splash).
        // The scrim IS the stage's backdrop (ADR-166 M2), held translucent — the
        // launch screen sits in the same room as the cell, not over a second sky.
        background: `radial-gradient(120% 100% at ${BACKDROP.center[0] * 100}% ${BACKDROP.center[1] * 100}%, `
          + `${rgba(COLOR.backdropCenter, 0.62)}, ${rgba(COLOR.backdropEdge, 0.82)})`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        pointerEvents: 'auto',
      }}
    >
      <div
        style={{
          width: 'min(760px, 94vw)', maxHeight: '90vh',
          display: 'flex', flexDirection: 'column',
          background: rgba(COLOR.surface, 0.96), border: `1px solid ${COLOR.border}`, borderRadius: '10px',
          // The stage light from above catches the panel's top edge.
          boxShadow: `0 12px 48px rgba(0,0,0,0.6), inset 0 1px 0 ${rgba(tones.light, 0.12)}`,
          overflow: 'hidden',
          ...enterMotion(reduced),
        }}
      >
        <div style={{
          padding: '18px 22px 14px', borderBottom: `1px solid ${COLOR.border}`,
          display: 'flex', alignItems: 'baseline',
        }}>
          <div>
            <div style={{ fontSize: '18px', fontWeight: 'bold', color: COLOR.textPrimary, letterSpacing: '0.01em' }}>
              easy-extrude
            </div>
            <div style={{ marginTop: '4px', fontSize: '12px', color: COLOR.textSecondary }}>
              Start from a process layout — pick the closest setup, then adjust
            </div>
          </div>
          <button
            onClick={close}
            title="Close (keep the current scene)"
            style={{
              marginLeft: 'auto', background: 'transparent', border: 'none',
              color: COLOR.textSecondary, cursor: 'pointer', fontSize: '20px', lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 22px' }}>
          {groups.map(group => (
            <div key={group.category} style={{ marginBottom: '18px' }}>
              <div style={{
                fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.06em',
                color: COLOR.textSecondary, marginBottom: '9px',
              }}>
                {group.category}
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                gap: '11px',
              }}>
                {group.items.map(t => {
                  const isEmpty = t.source.kind === 'empty'
                  const index   = order.get(t.id)
                  const lit     = hot === t.id
                  const plan    = isEmpty ? null : plans?.[t.source.file] ?? null
                  // Colour and glow are light → `fade` both ways; the lift is
                  // position → `land` / spring-back (tierAMotion).
                  const lift = tierAMotion({ hovered: lit, reduced })
                  const glow = `${DURATION.hover}ms ${EASING.fade}`
                  return (
                    <button
                      key={t.id}
                      onClick={() => (isEmpty ? empty() : select(t.id))}
                      onMouseEnter={() => setHot(t.id)}
                      onMouseLeave={() => setHot(h => (h === t.id ? null : h))}
                      onFocus={() => setHot(t.id)}
                      onBlur={() => setHot(h => (h === t.id ? null : h))}
                      style={{
                        textAlign: 'left', cursor: 'pointer',
                        background: isEmpty ? 'transparent' : COLOR.surfaceSunken,
                        border: `1px ${isEmpty ? 'dashed' : 'solid'} ${lit ? rgba(tones.light, 0.55) : COLOR.border}`,
                        boxShadow: lit ? `0 6px 22px ${rgba(tones.light, 0.10)}` : 'none',
                        borderRadius: '8px', padding: '13px 15px', color: COLOR.textPrimary,
                        fontFamily: 'inherit', display: 'flex', flexDirection: 'column', gap: '6px',
                        ...lift,
                        transition: reduced ? 'none'
                          : [lift.transition, `border-color ${glow}`, `box-shadow ${glow}`].filter(Boolean).join(', '),
                        ...itemEnterMotion(index, reduced),
                      }}
                    >
                      {plan && (
                        <PlanPreview id={t.id} plan={plan} lit={lit} reduced={reduced}
                          cardDelayMs={itemEnterDelay(index) + DURATION.chromeEnter} />
                      )}
                      <span style={{
                        fontSize: '14px', fontWeight: 'bold',
                        color: isEmpty ? COLOR.textSecondary : COLOR.textPrimary,
                      }}>
                        {t.name}
                      </span>
                      <span style={{ fontSize: '11.5px', color: COLOR.textSecondary, lineHeight: 1.55 }}>
                        {t.description}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        <div style={{
          padding: '11px 22px', borderTop: `1px solid ${COLOR.border}`,
          display: 'flex', alignItems: 'center', gap: '10px',
          fontSize: '11px', color: COLOR.textSecondary, lineHeight: 1.5,
        }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', userSelect: 'none' }}>
            <input
              type="checkbox"
              checked={skip}
              onChange={e => toggleSkip(e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
            Don't show on startup
          </label>
          <span style={{ marginLeft: 'auto', color: COLOR.textSecondary }}>
            Choosing a template replaces the current scene
          </span>
        </div>
      </div>
    </div>
  )
}

/**
 * The floor plan on a card (ADR-166 M4c): seen from above, lit by the one
 * stage light. Display-only — every number comes from `LayoutPlanMath`.
 *
 * Motion: each item lights (`eaLightOn`, opacity → `fade`) after its card has
 * landed, outward from where the light falls (`planLightDelay`). The pool
 * breathes with the stage's breath, phased by the template id. Pointing at the
 * card turns the pool up. Reduced → the lit plan, still.
 */
function PlanPreview({ id, plan, lit, reduced, cardDelayMs }) {
  const tones = planTones()
  const { w, h } = PLAN_FRAME
  const poolId = `ee-plan-pool-${id}`
  const lightOn = (order) => (reduced ? {} : {
    animation: `eaLightOn ${DURATION.chromeEnter}ms ${EASING.fade} both`,
    animationDelay: `${planLightDelay(cardDelayMs, order)}ms`,
  })
  const breath = poolBreathTiming(id)
  return (
    <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Floor plan"
      style={{ width: '100%', height: 'auto', display: 'block', borderRadius: '5px', marginBottom: '2px' }}>
      <defs>
        <radialGradient id={poolId} cx={plan.pool.x} cy={plan.pool.y} r={plan.pool.r} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={tones.light} stopOpacity="0.30" />
          <stop offset="1" stopColor={tones.light} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="0" y="0" width={w} height={h} fill={tones.ground} />
      <g style={lightOn(0)}>
        <g style={reduced ? {} : {
          animation: `eaPoolBreath ${breath.periodMs}ms ${EASING.loop} infinite`,
          animationDelay: `${breath.delayMs}ms`,
        }}>
          <rect x="0" y="0" width={w} height={h} fill={`url(#${poolId})`}
            style={{
              opacity: lit ? 1 : 0.6,
              transition: reduced ? 'none' : `opacity ${DURATION.hover}ms ${EASING.fade}`,
            }} />
        </g>
      </g>
      {plan.zones.map(z => (
        <polygon key={z.key} points={z.points} fill={z.tone} fillOpacity="0.08"
          stroke={z.tone} strokeOpacity="0.7" strokeWidth="0.7" strokeLinejoin="round" style={lightOn(z.order)} />
      ))}
      {plan.lines.map(l => (
        <polyline key={l.key} points={l.points} fill="none"
          stroke={l.tone} strokeOpacity="0.8" strokeWidth="0.8" strokeLinecap="round" style={lightOn(l.order)} />
      ))}
      {plan.bodies.map(b => (
        <polygon key={b.key} points={b.points} fill={tones.body} fillOpacity="0.22"
          stroke={tones.body} strokeOpacity="0.6" strokeWidth="0.5" strokeLinejoin="round" style={lightOn(b.order)} />
      ))}
      {plan.marks.map(m => (
        <circle key={m.key} cx={m.x} cy={m.y} r="1.3" fill={m.tone} style={lightOn(m.order)} />
      ))}
      {plan.robots.map(r => (
        <g key={r.key} style={lightOn(r.order)}>
          <circle cx={r.x} cy={r.y} r="3.6" fill="none" stroke={tones.light} strokeOpacity="0.5" strokeWidth="0.5" />
          <circle cx={r.x} cy={r.y} r="1.8" fill={tones.light} />
        </g>
      ))}
    </svg>
  )
}
