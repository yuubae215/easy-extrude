import { useUIStore } from '../../store/uiStore.js'
import { COLOR } from '../../theme/tokens.js'
import { Section } from './npanelShared.jsx'
import { CONFLICT_TONE, PANEL_KIND, STATUS_MARK, panelHeadline, toneFor } from '../../view/ArrangementStatusMath.js'

/**
 * EntityRelations — the declared relations (ADR-168 `arrangements`) beside the
 * selected entity, each axis as `declared → observed` with its status (S1b).
 *
 * The 3D picture shows WHERE each word points; this section says the words.
 * Both are read from the one model `context.arrangements` (sole writer
 * ArrangementController) — the section derives nothing.
 *
 * PERMANENT slot (原則 #15): with nothing selected it lists every relation and
 * the counts, so a mismatch or a claim conflict is readable without knowing
 * which entity to click (「不一致は画面で必ず見える」— ADR-168 D4). Which zero it
 * is (no document / none declared / not readable) is the model's `kind`, and
 * the headline for each kind is declared in one table (原則 #31).
 */
export function EntityRelations() {
  const model = useUIStore(s => s.context.arrangements)
  const select = useUIStore(s => s.callbacks.onSelectRelationEntity)
  const setSpeaker = useUIStore(s => s.callbacks.onSetRelationSpeaker)
  const headline = panelHeadline(model)
  const listed = model.kind === PANEL_KIND.LISTED

  return (
    <Section title={model.focusRefs.length > 0 ? `Relations (${model.focusRefs.join(', ')})` : 'Relations'}>
      <div style={{
        fontSize: '10px', lineHeight: '1.45',
        color: listed && (model.summary.mismatched > 0 || model.summary.conflicts > 0) ? COLOR[CONFLICT_TONE] : COLOR.textSecondary,
        fontWeight: listed ? 'bold' : 'normal',
      }}>
        {headline}
      </div>

      {model.speaker && <SpeakerPicker speaker={model.speaker} onChange={setSpeaker} />}

      {model.kind === PANEL_KIND.INVALID && model.errors.map((e, i) => (
        <div key={i} style={{ fontSize: '10px', color: COLOR.cautionTone, marginTop: '3px', lineHeight: '1.35' }}>{e}</div>
      ))}

      {listed && model.focusRefs.length > 0 && model.rows.length === 0 && (
        <div style={{ fontSize: '10px', color: COLOR.textSecondary, marginTop: '4px' }}>
          No relation names the selection.
        </div>
      )}

      {model.rows.map(row => (
        <div key={row.ref} style={{ marginTop: '6px', fontSize: '10px', lineHeight: '1.4' }}>
          <div style={{ color: COLOR.textPrimary }}>
            <span style={{ color: COLOR.textSecondary }}>{row.by}:</span> <RefLink r={row.subject} select={select} />
          </div>
          {row.sides.map((side, i) => (
            <div key={i} style={{ paddingLeft: '8px', borderLeft: `1px solid ${COLOR.border}`, marginTop: '2px' }}>
              <div style={{ color: COLOR.textSecondary }}>→ <RefLink r={side.of} select={select} /></div>
              <AxisLine label="contact"   axis={side.contact} />
              <AxisLine label="direction" axis={side.toward} />
              <div style={{ color: COLOR.textSecondary }}>joint: {side.mobility}</div>
            </div>
          ))}
        </div>
      ))}

      {model.conflicts.map((c, i) => (
        <div key={`c${i}`} style={{ marginTop: '6px', fontSize: '10px', lineHeight: '1.4', color: COLOR[CONFLICT_TONE] }}>
          Conflict on {c.axis} of {c.subject} → {c.of}: {c.claims.map(k => `${k.by} says ${k.value}`).join(' / ')}
        </div>
      ))}
    </Section>
  )
}

/**
 * Who is speaking — the actor a drag's offer would be claimed by (ADR-168 S2-1).
 * "Nobody" is a choice of its own, never a pre-selected actor (原則 #31); the
 * note says why nothing is offered while nobody speaks (原則 #11).
 */
function SpeakerPicker({ speaker, onChange }) {
  return (
    <div style={{ marginTop: '6px', fontSize: '10px', lineHeight: '1.4' }}>
      <label style={{ color: COLOR.textSecondary }}>
        Speaking:{' '}
        <select
          data-testid="relation-speaker"
          value={speaker.current ?? ''}
          disabled={speaker.choices.length === 0}
          onChange={(e) => onChange?.(e.target.value === '' ? null : e.target.value)}
          style={{ fontSize: '10px', fontFamily: 'inherit', background: COLOR.surface, color: COLOR.textPrimary, border: `1px solid ${COLOR.border}` }}
        >
          <option value="">— nobody —</option>
          {speaker.choices.map(c => <option key={c.ref} value={c.ref}>{c.label}</option>)}
        </select>
      </label>
      {speaker.note && <div style={{ color: COLOR.textSecondary, marginTop: '2px' }}>{speaker.note}</div>}
    </div>
  )
}

/** A thing named in a relation; pressing it selects that thing. */
function RefLink({ r, select }) {
  return (
    <button
      onClick={() => select?.(r)}
      title={`Select ${r}`}
      style={{
        padding: 0, background: 'transparent', border: 'none', color: 'inherit',
        fontSize: 'inherit', fontFamily: 'inherit', cursor: 'pointer', textDecoration: 'underline dotted',
      }}
    >
      {r}
    </button>
  )
}

/** One axis: `mark declared (observed)`. Only the mark carries the status tone (C4). An undeclared axis says so. */
function AxisLine({ label, axis }) {
  return (
    <div style={{ color: COLOR.textPrimary }}>
      <span style={{ color: COLOR[toneFor(axis.status)], fontWeight: 'bold' }}>{STATUS_MARK[axis.status]}</span> {label}: {axis.declared ?? 'not declared'}
      <span style={{ color: COLOR.textSecondary }}> (layout: {axis.observed})</span>
    </div>
  )
}
