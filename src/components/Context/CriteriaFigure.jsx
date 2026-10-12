import { COLOR } from '../../theme/tokens.js'
import { FIGURE_W, FIGURE_H, criteriaFigure, arcPath } from '../../view/CriteriaFigureMath.js'

/**
 * CriteriaFigure — draws `criteriaFigure(elementKey, value)` (ADR-165 D3,
 * principle #33 (4)). Colours are roles from the token table; the geometry is
 * the pure module's.
 */
const TONE = Object.freeze({
  neutral: COLOR.textSecondary,
  info:    COLOR.infoTone,
  success: COLOR.successTone,
  reveal:  COLOR.revealTone,
  danger:  COLOR.dangerTone,
})

function Shape({ s }) {
  const stroke = TONE[s.tone]
  if (!stroke) throw new Error(`[CriteriaFigure] no colour role for tone "${s.tone}"`)
  const common = {
    stroke, strokeWidth: s.width ?? 1,
    fill: s.fill ? stroke : 'none', fillOpacity: s.fill ? 0.18 : undefined,
    strokeDasharray: s.dash ? '4 3' : undefined,
  }
  switch (s.kind) {
    case 'circle': return <circle cx={s.cx} cy={s.cy} r={s.r} {...common} />
    case 'rect':   return <rect x={s.x} y={s.y} width={s.w} height={s.h} {...common} />
    case 'line':   return <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} {...common} />
    case 'arc':    return <path d={arcPath(s)} {...common} fill="none" />
    default: throw new Error(`[CriteriaFigure] no drawing for shape kind "${s.kind}"`)
  }
}

export function CriteriaFigure({ elementKey, value }) {
  const fig = criteriaFigure(elementKey, value)
  return (
    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }} data-testid="criteria-figure">
      <svg width={FIGURE_W} height={FIGURE_H} viewBox={`0 0 ${FIGURE_W} ${FIGURE_H}`}
        style={{ flexShrink: 0, border: `1px dashed ${COLOR.border}`, borderRadius: '4px', background: COLOR.surfaceSunken }}>
        {fig.shapes.map((s, i) => <Shape key={i} s={s} />)}
      </svg>
      <div style={{ fontSize: '10px', lineHeight: 1.6, color: fig.blank ? COLOR.cautionTone : COLOR.textPrimary }}>
        {fig.caption}
      </div>
    </div>
  )
}
