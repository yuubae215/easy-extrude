import { useState } from 'react'
import { CRITERIA_CATEGORIES, CRITERIA_ELEMENTS } from '../../context/CriteriaCatalog.js'
import { LINE_STATUS, LINE_CHANGE } from '../../context/CriteriaLine.js'
import { COLOR } from '../../theme/tokens.js'

const TONE = {
  settled: COLOR.factTone,
  pending: COLOR.cautionTone,
  danger:  COLOR.dangerTone,
  muted:   COLOR.textSecondary,
  text:    COLOR.textPrimary,
  border:  COLOR.border,
  sunken:  COLOR.surfaceSunken,
}

const STATUS_LABEL = {
  [LINE_STATUS.HEARING]:         'hearing',
  [LINE_STATUS.AGREED]:          'agreed',
  [LINE_STATUS.CHANGE_PROPOSED]: 'change proposed',
}

const CHANGE_LABEL = {
  [LINE_CHANGE.LOOSENED]:       'loosened',
  [LINE_CHANGE.TIGHTENED]:      'tightened',
  [LINE_CHANGE.CHANGED]:        'changed',
  [LINE_CHANGE.WEIGHT_RAISED]:  'raised the weight of',
  [LINE_CHANGE.WEIGHT_LOWERED]: 'lowered the weight of',
  [LINE_CHANGE.MIX_CHANGED]:    'changed the QCD+S ratio',
}

const ELEMENT_LABEL = Object.fromEntries(CRITERIA_ELEMENTS.map(e => [e.key, e.label]))

/** A line field as a person reads it ("takt — expectation", "mix"). */
function fieldLabel(t) {
  if (t.field === 'mix') return `${t.actor} · QCD+S ratio`
  return `${t.actor} · ${ELEMENT_LABEL[t.element] ?? t.element} — ${t.field === 'criterion' ? 'expectation' : 'weight'}`
}

const fmt = (v) => (v && typeof v === 'object' && 'value' in v ? `${v.op} ${v.value}` : JSON.stringify(v))

/**
 * CriteriaLineSection — the agreed line on the floor (ADR-165 D4 / D5).
 *
 * Renders `ContextService.criteriaLine()` and derives nothing: the status,
 * the version, who agreed, the direction of each change and whether safety
 * was cut all come from the pure layer (`CriteriaLine.projectCriteriaLine`).
 *
 * Three parts:
 *   1. **Status** — hearing / agreed vN / change proposed, and who agreed.
 *      Agreeing itself is a form answer (R12 unagreed — FormPanel), so the
 *      gate to design has one entry.
 *   2. **Propose a change** — once agreed, a line field moves only by a
 *      proposal the other end users approve, even for its owner. The menu is
 *      the frozen fields (`targets`).
 *   3. **History** — every line proposal after agreement, with who, what,
 *      which way, and who approved. "Safety cut" is marked, never hidden.
 */
export function CriteriaLineSection({ line, actors, keyring, onPropose }) {
  const [open, setOpen] = useState(false)
  if (!line || line.endUsers.length === 0) return null

  const statusColor = line.status === LINE_STATUS.HEARING ? TONE.pending : TONE.settled
  return (
    <div style={{ padding: '6px 10px', borderBottom: `1px solid ${TONE.border}` }} data-testid="criteria-line">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
        <span style={{ fontSize: '11px', color: TONE.text }}>Criteria line</span>
        <span data-testid="criteria-line-status" style={{ marginLeft: 'auto', fontSize: '10px', color: statusColor }}>
          {STATUS_LABEL[line.status]}{line.version !== null ? ` · v${line.version}` : ''}
        </span>
      </div>
      <div style={{ fontSize: '10px', color: TONE.muted, marginTop: '2px' }}>
        {line.status === LINE_STATUS.HEARING
          ? (line.heardInFull
              ? `Heard in full — agreed by ${line.agreedBy.length} of ${line.endUsers.length}${line.rehearing ? ' (the end users changed — everyone re-agrees)' : ''}`
              : 'Still hearing — the line can be agreed once nothing is unheard')
          : `Agreed by ${line.agreedBy.join(', ')}. A change needs every other end user's approval.`}
      </div>

      {line.targets.length > 0 && (
        open
          ? <ProposeForm line={line} actors={actors} keyring={keyring}
              onSubmit={(spec) => { onPropose(spec); setOpen(false) }}
              onCancel={() => setOpen(false)} />
          : (
            <button
              onClick={() => setOpen(true)} data-testid="line-propose-open"
              style={{ marginTop: '4px', background: 'transparent', border: `1px solid ${TONE.border}`, color: TONE.muted, borderRadius: '3px', padding: '2px 8px', fontSize: '11px', cursor: 'pointer' }}
            >
              Propose a line change…
            </button>
          )
      )}

      {line.history.length > 0 && (
        <div style={{ marginTop: '6px' }} data-testid="line-history">
          {line.history.map(h => (
            <div key={h.ref} style={{ fontSize: '10px', color: TONE.muted, lineHeight: '1.5' }}>
              {h.version !== null ? `v${h.version} · ` : ''}
              <span style={{ color: TONE.text }}>{h.by}</span> {CHANGE_LABEL[h.change]}{' '}
              {h.field === 'mix' ? `(${h.actor})` : `${ELEMENT_LABEL[h.element] ?? h.element} (${h.actor})`}{' '}
              <code>{fmt(h.from)}</code> → <code>{fmt(h.to)}</code>
              {' · '}{h.state}
              {h.state === 'approved' && (h.required.length === 0 ? ' · no other end user — recorded only' : ` by ${h.approvals.join(', ')}`)}
              {h.state === 'rejected' && ` by ${h.rejectedBy.join(', ')}`}
              {h.safetyCut && <span data-testid={`safety-cut-${h.ref}`} style={{ color: TONE.danger, marginLeft: '4px' }}>⚠ safety cut</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ProposeForm({ line, actors, keyring, onSubmit, onCancel }) {
  const [i, setI] = useState(0)
  const t = line.targets[i]
  const [value, setValue] = useState('')
  const [mix, setMix] = useState({})
  const [why, setWhy] = useState('')
  const [by, setBy] = useState(keyring[0] ?? line.endUsers[0] ?? actors[0]?.ref ?? '')

  const to = t.field === 'mix'
    ? { ...(t.value ?? {}), ...Object.fromEntries(Object.entries(mix).filter(([, v]) => v !== '').map(([c, v]) => [c, Number(v)])) }
    : value === '' ? null
    : t.field === 'criterion' ? { ...t.value, value: Number(value) }
    : Number(value)
  const ready = to !== null && why.trim() !== ''

  const input = { background: TONE.sunken, color: TONE.text, border: `1px solid ${TONE.border}`, fontSize: '11px', padding: '2px' }
  return (
    <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '4px' }} data-testid="line-propose-form">
      <select value={i} onChange={e => { setI(Number(e.target.value)); setValue(''); setMix({}) }} style={input}>
        {line.targets.map((x, k) => <option key={k} value={k}>{fieldLabel(x)} (now {fmt(x.value)})</option>)}
      </select>
      {t.field === 'mix'
        ? (
          <div style={{ display: 'flex', gap: '4px' }}>
            {CRITERIA_CATEGORIES.map(c => (
              <input key={c} type="number" min="0" placeholder={`${c} ${t.value?.[c] ?? ''}`}
                value={mix[c] ?? ''} onChange={e => setMix(m => ({ ...m, [c]: e.target.value }))}
                style={{ ...input, width: '48px' }} />
            ))}
          </div>
        )
        : (
          <input type="number" value={value} data-testid="line-propose-value"
            placeholder={t.field === 'criterion' ? `new expectation (${t.value?.op} …)` : 'new weight'}
            onChange={e => setValue(e.target.value)} style={input} />
        )}
      <select value={by} onChange={e => setBy(e.target.value)} style={input} title="Who proposes">
        {actors.map(a => <option key={a.ref} value={a.ref}>{a.ref}</option>)}
      </select>
      <textarea value={why} onChange={e => setWhy(e.target.value)} rows={2} data-testid="line-propose-why"
        placeholder="Why move the line? (becomes the receipt's rationale)" style={{ ...input, resize: 'vertical' }} />
      <div style={{ display: 'flex', gap: '6px' }}>
        <button
          disabled={!ready} data-testid="line-propose-submit"
          title={ready ? 'Put this on the floor for the other end users' : 'A line change needs a new value and a reason'}
          onClick={() => onSubmit({ target: t.target, from: t.value, to, rationale: why, by })}
          style={{
            flex: 1, borderRadius: '3px', padding: '3px', fontSize: '11px',
            background: 'transparent', border: `1px solid ${ready ? `${TONE.settled}77` : TONE.border}`,
            color: ready ? TONE.settled : TONE.muted, cursor: ready ? 'pointer' : 'not-allowed',
          }}
        >
          Propose
        </button>
        <button onClick={onCancel}
          style={{ background: 'transparent', border: `1px solid ${TONE.border}`, color: TONE.muted, borderRadius: '3px', padding: '3px 8px', fontSize: '11px', cursor: 'pointer' }}>
          Cancel
        </button>
      </div>
    </div>
  )
}
