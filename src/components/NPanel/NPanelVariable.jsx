import { Section } from './npanelShared.jsx'
import { COLOR } from '../../theme/tokens.js'

/**
 * NPanelVariable — the N panel body for a `variables` selection (ADR-107 D6).
 *
 * The panel's content follows the SELECTION KIND, which is why this component
 * exists at all: the same one selection model now holds two kinds of element,
 * and the right-hand zone speaks about whichever is selected (v8 注釈⑤). The
 * branch that routes here is a declaration table (`NPANEL_BY_SELECTION_KIND`),
 * not an `if` chain — an undeclared kind throws before it can reach a panel.
 *
 * The `shape` line is load-bearing rather than decorative: it states what the
 * selection ANSWERED with in 3-D. A variable with a footprint gets an undecided
 * band; a scalar one whose requirements point at entities gets those entities
 * dimmed; one with neither is a legal case that must be SAID rather than left
 * silent (原則 #11) — three declared outcomes, no falsy default (原則 #31).
 *
 * Presentation only: every fact comes from the projections the controller
 * passed in (`projectMatrix` / the doc / `entitiesConstrainedBy`).
 */

const SHAPE_NOTE = {
  band:     { color: COLOR.factTone, text: '3D: 未確定帯を表示中' },
  entities: { color: COLOR.cautionTone, text: '3D: 領域を持たない量 — 束縛している実体を淡色表示中' },
  none:     { color: COLOR.textSecondary, text: '3D: この変数はまだ空間に姿を持ちません (領域も、束縛する実体もありません)' },
}

const fmtSet = (set) => Array.isArray(set)
  ? `[${set[0]}, ${set[1]})`
  : Object.entries(set ?? {}).map(([ax, s]) => `${ax}: [${s[0]}, ${s[1]})`).join('  ')

const fmtGap = fmtSet

export function NPanelVariable({ data }) {
  const variables = data?.variables ?? []
  if (variables.length === 0) return null

  return (
    <>
      {variables.map(v => (
        <div key={v.ref}>
          <Section title="Shared variable">
            <div style={{ fontFamily: 'monospace', color: COLOR.textPrimary, fontSize: '12px' }}>
              {v.ref}{v.unit ? <span style={{ color: '#888' }}> [{v.unit}]</span> : null}
            </div>
            {v.description && (
              <div style={{ color: '#aaa', fontSize: '11px', marginTop: '4px', lineHeight: 1.5 }}>
                {v.description}
              </div>
            )}
            <div style={{ color: SHAPE_NOTE[v.shape].color, fontSize: '10px', marginTop: '6px' }}>
              {SHAPE_NOTE[v.shape].text}
            </div>
          </Section>

          <Section title={`Claims (${v.claims.length})`}>
            {v.claims.length === 0
              ? <div style={{ color: '#888', fontSize: '11px' }}>誰もこの変数に主張を置いていません。</div>
              : v.claims.map(c => (
                <div key={c.requirement} style={{ fontSize: '11px', padding: '2px 0', lineHeight: 1.5 }}>
                  <span style={{ color: '#aaa' }}>{c.actor ?? '—'}</span>
                  <span style={{ color: COLOR.textPrimary, fontFamily: 'monospace', marginLeft: '4px' }}>
                    {c.admissible ? fmtSet(c.admissible) : '—'}
                  </span>
                  {c.negotiability && (
                    <span style={{ color: '#888', marginLeft: '4px' }}>({c.negotiability})</span>
                  )}
                </div>
              ))}
          </Section>

          {v.summary?.inConflict && (
            <Section title="Conflict">
              <div style={{ color: COLOR.dangerTone, fontSize: '11px', lineHeight: 1.5 }}>
                共通部分なし — gap {fmtGap(v.summary.gap)}
              </div>
              <div style={{ color: '#888', fontSize: '10px', marginTop: '3px' }}>
                between: {(v.summary.between ?? []).join(', ') || '—'}
              </div>
              {v.summary.resolvedBy && (
                <div style={{ color: v.summary.approved ? COLOR.factTone : COLOR.cautionTone, fontSize: '10px', marginTop: '3px' }}>
                  {v.summary.approved ? '✓ resolved by ' : '◐ awaiting approval — '}{v.summary.resolvedBy}
                </div>
              )}
            </Section>
          )}

          <Section title={`Constrains (${v.entities.length})`} noBorder>
            {v.entities.length === 0
              ? <div style={{ color: '#888', fontSize: '11px' }}>この変数はまだどの実体も束縛していません。</div>
              : v.entities.map(e => (
                // Back to the entity in one click: the selection kind switches,
                // it does not mix (ADR-107 D1) — and it goes through the same
                // verb every other window uses.
                <div
                  key={e.id}
                  onClick={() => v.onSelectEntity?.(e.id)}
                  // Clickability is carried by the underline + cursor, not by a
                  // colour: the accent means "what you are operating on" and this
                  // entity is precisely what you are NOT operating on right now
                  // (ADR-100 G2 — one meaning, one colour).
                  style={{
                    fontSize: '11px', padding: '2px 0', cursor: 'pointer',
                    color: COLOR.textPrimary, textDecoration: 'underline dotted',
                  }}
                >
                  {e.name}
                </div>
              ))}
          </Section>
        </div>
      ))}
    </>
  )
}
