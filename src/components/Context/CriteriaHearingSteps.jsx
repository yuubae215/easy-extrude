import { useState } from 'react'
import { VALID_ROLES } from '../../context/ContextDslSchema.js'
import {
  CRITERIA_CATEGORIES, CRITERIA_CATEGORY_LABELS, CRITERIA_ELEMENTS, MIX_ARCHETYPES,
} from '../../context/CriteriaCatalog.js'
import { CriteriaFigure } from './CriteriaFigure.jsx'
import { CRITERION_OPS } from '../../context/IntakeVocabulary.js'
import { endUsersOf, isEndUser, jobFunctionOf } from '../../context/ActorStance.js'
import { answersOf, countUnheard } from '../../context/CriteriaElicitation.js'
import { lineStatus, LINE_STATUS, LINE_CHANGE } from '../../context/CriteriaLine.js'
import { hearingHistory, isRespondentFrozen, trialsOfActor } from '../../context/CriteriaHearing.js'
import { COLOR } from '../../theme/tokens.js'

/**
 * CriteriaHearingSteps — the step bodies of the criteria hearing (ADR-165 D3,
 * flow v4: who → ratio → expectation and weight → try it → agree).
 *
 * Reads only `context.criteriaDoc` (the document slice projected on the
 * document edge) and fires `onHearing*` callbacks; ContextController writes
 * through the same pure transforms the floor's form uses. Drafts are
 * component-local and never a second source (ADR-063 §4).
 *
 * **No total score is shown anywhere** — how weights combine into one number
 * is core/'s score function (ADR-165 D3, CLAUDE.md 軸 1).
 */

const text = (size, color = COLOR.textSecondary) => ({ fontSize: size, color, lineHeight: 1.6 })
const input = {
  padding: '3px 5px', background: COLOR.surfaceSunken, border: `1px solid ${COLOR.border}`,
  borderRadius: '3px', color: COLOR.textPrimary, fontSize: '11px', minWidth: 0,
  fontFamily: 'system-ui, -apple-system, sans-serif',
}
const chip = (on) => ({
  fontSize: '10px', borderRadius: '10px', padding: '2px 9px', cursor: 'pointer',
  border: `1px solid ${on ? COLOR.accent : COLOR.border}`,
  background: on ? COLOR.accentSoft : 'transparent', color: on ? COLOR.textPrimary : COLOR.textSecondary,
  fontFamily: 'system-ui, -apple-system, sans-serif',
})
const button = (disabled) => ({
  padding: '4px 10px', borderRadius: '3px', fontSize: '11px', cursor: disabled ? 'default' : 'pointer',
  border: `1px solid ${COLOR.border}`, background: COLOR.surfaceRaised,
  color: disabled ? COLOR.textSecondary : COLOR.textPrimary, opacity: disabled ? 0.6 : 1,
  fontFamily: 'system-ui, -apple-system, sans-serif',
})

const CHANGE_WORD = Object.freeze({
  [LINE_CHANGE.LOOSENED]:       'loosened',
  [LINE_CHANGE.TIGHTENED]:      'tightened',
  [LINE_CHANGE.CHANGED]:        'changed',
  [LINE_CHANGE.WEIGHT_RAISED]:  'weight raised',
  [LINE_CHANGE.WEIGHT_LOWERED]: 'weight lowered',
  [LINE_CHANGE.MIX_CHANGED]:    'ratio changed',
})
const elementLabel = (key) => CRITERIA_ELEMENTS.find(e => e.key === key)?.label ?? key
const show = (v) => (v && typeof v === 'object' && 'op' in v) ? `${v.op} ${v.value}` : JSON.stringify(v)

/** Who is answering Steps 2–4 — the respondent switch (flow v4's top bar). */
export function RespondentBar({ doc, respondent, callbacks }) {
  const users = endUsersOf(doc)
  if (users.length === 0) return null
  return (
    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '8px' }} data-testid="hearing-respondents">
      <span style={text('9px')}>answering:</span>
      {users.map(u => (
        <button key={u.ref} style={chip(u.ref === respondent)} onClick={() => callbacks.onHearingRespondent?.(u.ref)}>
          {u.name ?? u.ref}{isRespondentFrozen(doc, u.ref) ? ' · agreed' : ''}
        </button>
      ))}
    </div>
  )
}

/** Step 1 — who stands as an end user. Job function and stance are separate facts (D1). */
export function EndUsersStep({ doc, respondent, callbacks }) {
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const ref = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  const others = (doc.actors ?? []).filter(a => !isEndUser(a))
  return (
    <div>
      <RespondentBar doc={doc} respondent={respondent} callbacks={callbacks} />
      {others.length > 0 && (
        <div style={{ marginBottom: '8px' }}>
          <div style={text('9px')}>Already in the document — does this person stand as an end user here?</div>
          {others.map(a => (
            <div key={a.ref} style={{ display: 'flex', gap: '6px', alignItems: 'center', marginTop: '3px' }}>
              <span style={text('10px', COLOR.textPrimary)}>{a.name ?? a.ref} <span style={text('9px')}>({jobFunctionOf(a) ?? 'job not declared'})</span></span>
              <button style={button(false)} onClick={() => callbacks.onHearingStandAsEndUser?.(a.ref)}>Stands as end user</button>
            </div>
          ))}
        </div>
      )}
      <div style={text('9px')}>Add a person who stands as an end user:</div>
      <div style={{ display: 'flex', gap: '4px', marginTop: '3px' }}>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="name" style={{ ...input, flex: 2 }} aria-label="end user name" />
        <select value={role} onChange={e => setRole(e.target.value)} style={{ ...input, flex: 1 }} aria-label="job function">
          <option value="">job — later</option>
          {VALID_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <button style={button(ref === '')} disabled={ref === ''} aria-label="add end user"
          onClick={() => { callbacks.onHearingAddEndUser?.({ ref, name: name.trim(), role: role || undefined }); setName('') }}>
          + Add
        </button>
      </div>
    </div>
  )
}

function FrozenNote({ who }) {
  return (
    <div style={{ ...text('10px'), border: `1px dashed ${COLOR.border}`, borderRadius: '4px', padding: '5px 7px' }}>
      {who}'s line is agreed. A change now is a proposal the other end users approve — raise it on the floor (Agenda → criteria line).
    </div>
  )
}

/** Step 2 — the QCD + S ratio. All four are asked; nothing is pre-filled for them. */
export function MixStep({ doc, respondent, callbacks }) {
  const actor = (doc.actors ?? []).find(a => a.ref === respondent)
  const [draft, setDraft] = useState({})
  if (!actor) return <RespondentBar doc={doc} respondent={respondent} callbacks={callbacks} />
  const frozen = isRespondentFrozen(doc, respondent)
  const value = (c) => draft[c] ?? (typeof actor.mix?.[c] === 'number' ? String(actor.mix[c]) : '')
  const ok = (v) => v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0
  const changed = CRITERIA_CATEGORIES.filter(c => draft[c] !== undefined && ok(draft[c]) && Number(draft[c]) !== actor.mix?.[c])
  return (
    <div>
      <RespondentBar doc={doc} respondent={respondent} callbacks={callbacks} />
      {frozen ? <FrozenNote who={actor.name ?? actor.ref} /> : (
        <>
          {/* Start from a type (flow v4 Step 2). Picking one only fills the
              draft — the ratio is the person's answer once they save it. */}
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '6px' }} data-testid="mix-archetypes">
            <span style={text('9px')}>start from a type:</span>
            {MIX_ARCHETYPES.map(a => (
              <button key={a.key} style={chip(CRITERIA_CATEGORIES.every(c => Number(value(c)) === a.mix[c]))}
                title={CRITERIA_CATEGORIES.map(c => `${c} ${a.mix[c]}`).join(' · ')}
                onClick={() => setDraft(Object.fromEntries(CRITERIA_CATEGORIES.map(c => [c, String(a.mix[c])])))}>
                {a.label}
              </button>
            ))}
          </div>
          {CRITERIA_CATEGORIES.map(c => (
            <div key={c} style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '3px' }}>
              <span style={{ ...text('10px', value(c) === '' ? COLOR.cautionTone : COLOR.textPrimary), flex: 1 }}>
                {CRITERIA_CATEGORY_LABELS[c]}{value(c) === '' ? ' — not asked yet' : ''}
              </span>
              <input type="number" min="0" value={value(c)} aria-label={`ratio ${c}`}
                onChange={e => setDraft(d => ({ ...d, [c]: e.target.value }))} style={{ ...input, width: '64px' }} />
            </div>
          ))}
          <button style={button(changed.length === 0)} disabled={changed.length === 0}
            onClick={() => { callbacks.onHearingAnswer?.({ mix: Object.fromEntries(changed.map(c => [c, Number(draft[c])])) }); setDraft({}) }}>
            Save ratio
          </button>
        </>
      )}
    </div>
  )
}

/** Step 3 — every element as the same pair: expectation (= criterion) and weight. */
export function ExpectationsStep({ doc, respondent, callbacks }) {
  const [draft, setDraft] = useState({})
  // The row whose picture is shown (flow v4: tap a row, the figure follows).
  const [focus, setFocus] = useState(CRITERIA_ELEMENTS[0].key)
  const actor = (doc.actors ?? []).find(a => a.ref === respondent)
  if (!actor) return <RespondentBar doc={doc} respondent={respondent} callbacks={callbacks} />
  const frozen = isRespondentFrozen(doc, respondent)
  const stored = (key) => {
    const rows = answersOf(doc, respondent, key)
    return rows.length === 1 ? rows[0] : null
  }
  const field = (e, f) => {
    const d = draft[e.key]?.[f]
    if (d !== undefined) return d
    const r = stored(e.key)
    if (f === 'op') return r?.criterion?.op ?? e.op
    if (f === 'value') return typeof r?.criterion?.value === 'number' ? String(r.criterion.value) : ''
    return typeof r?.weight === 'number' ? String(r.weight) : ''
  }
  const set = (key, f, v) => setDraft(d => ({ ...d, [key]: { ...(d[key] ?? {}), [f]: v } }))
  const num = (v) => v !== '' && Number.isFinite(Number(v))

  const answer = { elements: {} }
  for (const e of CRITERIA_ELEMENTS) {
    if (!draft[e.key]) continue
    const r = stored(e.key)
    const out = {}
    const op = field(e, 'op'), value = field(e, 'value'), weight = field(e, 'weight')
    if (num(value) && (r?.criterion?.op !== op || r?.criterion?.value !== Number(value))) out.criterion = { op, value: Number(value) }
    if (num(weight) && Number(weight) >= 0 && r?.weight !== Number(weight)) out.weight = Number(weight)
    if (Object.keys(out).length) answer.elements[e.key] = out
  }
  const any = Object.keys(answer.elements).length > 0

  return (
    <div>
      <RespondentBar doc={doc} respondent={respondent} callbacks={callbacks} />
      {frozen ? <FrozenNote who={actor.name ?? actor.ref} /> : (
        <>
          {CRITERIA_ELEMENTS.map(e => {
            const blank = field(e, 'value') === '' || field(e, 'weight') === ''
            return (
              <div key={e.key} onClick={() => setFocus(e.key)} data-testid={`criteria-row-${e.key}`}
                style={{ border: `1px ${blank ? 'dashed' : 'solid'} ${focus === e.key ? COLOR.accent : blank ? COLOR.cautionTone : COLOR.border}`, borderRadius: '4px', padding: '4px 6px', marginBottom: '4px', cursor: 'pointer' }}>
                <div style={text('10px', COLOR.textPrimary)}>{e.category} · {e.label} <span style={text('9px')}>({e.unit}, {e.op === '<=' ? 'lower is better' : 'higher is better'})</span></div>
                <div style={{ display: 'flex', gap: '4px', marginTop: '2px', alignItems: 'center' }}>
                  <span style={text('9px')}>expect</span>
                  <select value={field(e, 'op')} onChange={ev => set(e.key, 'op', ev.target.value)} style={{ ...input, width: '52px' }} aria-label={`${e.key} op`}>
                    {CRITERION_OPS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                  <input type="number" value={field(e, 'value')} onChange={ev => set(e.key, 'value', ev.target.value)} style={{ ...input, width: '70px' }} aria-label={`${e.key} expectation`} />
                  <span style={text('9px')}>weight</span>
                  <input type="number" min="0" value={field(e, 'weight')} onChange={ev => set(e.key, 'weight', ev.target.value)} style={{ ...input, width: '52px' }} aria-label={`${e.key} weight`} />
                </div>
                {focus === e.key && (
                  <div style={{ marginTop: '4px' }}>
                    <CriteriaFigure elementKey={e.key} value={num(field(e, 'value')) ? Number(field(e, 'value')) : null} />
                  </div>
                )}
              </div>
            )
          })}
          <button style={button(!any)} disabled={!any}
            onClick={() => { callbacks.onHearingAnswer?.(answer); setDraft({}) }}>
            Save expectations
          </button>
        </>
      )}
    </div>
  )
}

/** The rounds "changed after trial n" for one or all end users (D4, before agreement). */
export function HearingHistory({ doc, actor }) {
  const rounds = hearingHistory(doc).filter(r => !actor || r.actor === actor)
  if (rounds.length === 0) return null
  return (
    <div style={{ marginTop: '8px' }} data-testid="hearing-history">
      <div style={text('9px')}>Changed after seeing a trial:</div>
      {rounds.map(r => (
        <div key={`${r.actor}-${r.afterTrial}`} style={{ borderLeft: `3px solid ${r.safetyCut ? COLOR.dangerTone : COLOR.border}`, padding: '2px 7px', margin: '3px 0', ...text('10px', COLOR.textPrimary) }}>
          {r.safetyCut && <b style={{ color: COLOR.dangerTone }}>⚠ safety was cut · </b>}
          {r.actor}, after trial {r.afterTrial}{r.seen.length ? ` (saw ${r.seen.join(', ')})` : ' (no candidates were shown)'}:{' '}
          {r.changes.map(c => `${c.element ? elementLabel(c.element) : 'ratio'} ${c.field === 'weight' ? 'weight ' : ''}${CHANGE_WORD[c.change] ?? c.change} (${show(c.from)} → ${show(c.to)})`).join('; ')}
        </div>
      ))}
    </div>
  )
}

/**
 * Step 4 — try it. The candidates are core/'s (generating a cell and its
 * actual values is an idea — 軸 1), and the service that returns them is
 * 後続 PR (ADR-165 PR4, DEF-064) together with the ☺ ○ ☹ against expectations. Until then the step says so instead of drawing
 * numbers nobody computed; the trial itself — what was held when looking —
 * is still recorded, and changes after it are still history.
 */
export function TrialStep({ doc, respondent, callbacks }) {
  const actor = (doc.actors ?? []).find(a => a.ref === respondent)
  if (!actor) return <RespondentBar doc={doc} respondent={respondent} callbacks={callbacks} />
  const trials = trialsOfActor(doc, respondent)
  return (
    <div>
      <RespondentBar doc={doc} respondent={respondent} callbacks={callbacks} />
      <div style={{ ...text('10px'), border: `1px dashed ${COLOR.border}`, borderRadius: '4px', padding: '6px 8px' }} data-testid="trial-candidates">
        No candidates to compare yet — the solver that turns a line into candidate cells is not connected.
        What you hold now is recorded{trials.length ? ` as trial ${trials.length}` : ''}: go back and change an
        expectation, and it is kept as "after trial {trials.length || 1}".
      </div>
      <HearingHistory doc={doc} actor={respondent} />
    </div>
  )
}

/** Step 5 — heard in full? → agree. Agreeing is each end user's own act (their key). */
export function AgreementReview({ doc, callbacks }) {
  const census = countUnheard(doc)
  const line = lineStatus(doc)
  const agreed = line.status !== LINE_STATUS.HEARING
  return (
    <div data-testid="hearing-review">
      <div style={text('10px', COLOR.textPrimary)}>
        {agreed ? `The line is agreed (v${line.version}). A change is now a proposal on the floor.`
          : census.complete ? 'Everything is heard. The line becomes v1 when every end user agrees.'
          : census.started ? `${census.count} answers are still blank — the line cannot be agreed yet.`
          : 'No one stands as an end user yet.'}
      </div>
      {endUsersOf(doc).map(u => {
        const blanks = census.blanks.filter(b => b.actor === u.ref).length
        const done = line.agreedBy.includes(u.ref)
        const g = !agreed && !done ? (callbacks.onCriteriaAgreementGuards?.(u.ref) ?? { ok: false, reasons: [] }) : null
        return (
          <div key={u.ref} style={{ display: 'flex', gap: '6px', alignItems: 'center', marginTop: '4px', flexWrap: 'wrap' }}>
            <span style={{ ...text('10px', COLOR.textPrimary), flex: 1 }}>
              {u.name ?? u.ref} — {blanks ? `${blanks} blank` : 'heard'}{done ? ' · agreed' : ''}
            </span>
            {g && (
              <button style={button(!g.ok)} disabled={!g.ok} title={g.reasons.join(' ')} onClick={() => callbacks.onHearingAgree?.(u.ref)}>
                Agree as {u.ref}
              </button>
            )}
            {g && !g.ok && <div style={{ ...text('9px', COLOR.cautionTone), width: '100%' }}>{g.reasons.join(' ')}</div>}
          </div>
        )
      })}
      <HearingHistory doc={doc} />
    </div>
  )
}
