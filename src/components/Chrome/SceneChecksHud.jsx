import { useEffect, useState } from 'react'
import { useUIStore } from '../../store/uiStore.js'
import { COLOR, Z, rgba } from '../../theme/tokens.js'
import { CHECKS_KIND, checksDeclaration } from '../../context/DiscoverySummary.js'
import { leftEdgeOffset, belowHeaderOffset } from '../../view/EdgeOccupancy.js'

/**
 * SceneChecksHud — scene-scope acceptance verdicts, on the 3-D view (ADR-105 D1 / D3).
 *
 * ## What moved, and why it had to
 *
 * The shared KPI used to be the `Checks` tab of `ContextLayer`, and that tab only
 * *existed* when `ctx.checks?.length > 0` — i.e. the most widely-shared fact in the
 * app was in the most document-bound place on screen (`02-grouping-criteria.md`).
 * A document with no acceptance checks made the whole thing vanish, which reads
 * exactly like a document whose checks all passed.
 *
 * ## Four states, four different next moves (D3)
 *
 * | kind            | what happened                       | next move          |
 * |-----------------|-------------------------------------|--------------------|
 * | `unexamined`    | no document adopted                 | adopt one          |
 * | `none-declared` | document adopted, no checks in it   | declare a check    |
 * | `all-pass`      | checks exist and all passed         | nothing            |
 * | `failing`       | some check did not pass             | open the floor     |
 *
 * `all-pass` is the **only** branch allowed to say "✓". Saying it for
 * `none-declared` is a lie; saying nothing at all is a Fixed-Slots violation
 * (PHILOSOPHY #15). The slot is always here; what changes is the sentence in it.
 *
 * Reads the union's `kind` — never `ctx.active`, never `checks.length` (ADR-105 D1,
 * enforced by `DiscoveryOutsideTheFloor.test.js`).
 */

const TONE = {
  quiet:    COLOR.textSecondary,
  settled:  COLOR.factTone,
  caution:  COLOR.cautionTone,
}

const GLYPH = {
  [CHECKS_KIND.UNEXAMINED]:    '◌',
  [CHECKS_KIND.NONE_DECLARED]: '◌',
  [CHECKS_KIND.ALL_PASS]:      '✓',
  [CHECKS_KIND.FAILING]:       '!',
}

export function SceneChecksHud() {
  const summary   = useUIStore(s => s.context.checksSummary)
  const callbacks = useUIStore(s => s.callbacks)
  const isMobile  = useIsMobile()

  // Throws on an undeclared kind (PHILOSOPHY #31) — the declaration table is the
  // single place that decides what each branch says and where it points.
  const decl  = checksDeclaration(summary)
  const glyph = GLYPH[summary.kind]
  if (!glyph) {
    throw new Error(`SceneChecksHud: 未宣言の種 "${summary.kind}" — GLYPH に行を足すこと (原則 #31)`)
  }

  const tone = TONE[decl.tone] ?? TONE.quiet
  const onExit = summary.kind === CHECKS_KIND.UNEXAMINED
    ? callbacks.onOpenTemplateGallery
    : callbacks.onContextNegotiate

  return (
    <div
      style={{
        position:      'fixed',
        // The left edge's occupancy is computed by ONE owner (原則 #26 / D6):
        // desktop sits beside the Outliner, mobile owns the edge (drawer).
        top:           `${belowHeaderOffset()}px`,
        left:          `${leftEdgeOffset({ isMobile })}px`,
        maxWidth:      '244px',
        padding:       '5px 9px',
        background:    rgba(COLOR.surface, 0.86),
        border:        `1px solid ${COLOR.border}`,
        borderRadius:  '5px',
        color:         COLOR.textPrimary,
        fontFamily:    'system-ui, -apple-system, sans-serif',
        fontSize:      '11px',
        lineHeight:    '1.35',
        zIndex:        Z.gizmo,
        pointerEvents: 'auto',
      }}
      title={decl.detail}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
        <span style={{ color: tone, fontWeight: 'bold' }}>{glyph}</span>
        <span style={{ color: tone, fontWeight: 'bold' }}>{decl.headline}</span>
        {summary.kind === CHECKS_KIND.ALL_PASS && (
          <span style={{ color: TONE.quiet }}>{summary.total} checks</span>
        )}
        {summary.kind === CHECKS_KIND.FAILING && (
          <span style={{ color: TONE.quiet }}>
            {summary.failed} failed · {summary.blocked} blocked · {summary.passed}/{summary.total} pass
          </span>
        )}
      </div>
      {/* A stated zero always names its exit — never a silent dead end (#11). */}
      {decl.exit && (
        <button
          onClick={() => onExit?.()}
          style={{
            marginTop:  '3px',
            padding:    '0',
            background: 'transparent',
            border:     'none',
            color:      TONE.quiet,
            fontSize:   '10px',
            fontFamily: 'inherit',
            textAlign:  'left',
            cursor:     'pointer',
            textDecoration: 'underline dotted',
            pointerEvents: 'auto',
          }}
        >
          {decl.exit}
        </button>
      )}
    </div>
  )
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return isMobile
}
