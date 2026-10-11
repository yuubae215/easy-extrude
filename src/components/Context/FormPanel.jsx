import { useState } from 'react'
import { useUIStore } from '../../store/uiStore.js'
import { ANSWER_KIND } from '../../context/FormProjection.js'
import { OWNER_NONE_DECLARED } from '../../context/Ownership.js'
import { VALID_ROLES } from '../../context/ContextDslSchema.js'
import { CRITERIA_CATEGORIES, CRITERIA_CATEGORY_LABELS, CRITERIA_ELEMENTS } from '../../context/CriteriaCatalog.js'
import { CRITERION_OPS } from '../../context/IntakeVocabulary.js'
import { jobFunctionOf } from '../../context/ActorStance.js'
import { COLOR } from '../../theme/tokens.js'
import { DeltaChip, LandingFlash, usePrevOnChange } from '../Feedback/FeedbackPrimitives.jsx'
import { listDelta, settledRefs } from '../../view/FeedbackMath.js'

/**
 * FormPanel — dynamic intake form driven by `projectForm()` output (ADR-050 §4.4).
 *
 * Reads `context.form` (the list of open questions from the validator) and renders
 * an answer widget for each question. The widget type is determined by `answerKind`
 * (PHILOSOPHY #2 — type is the capability contract, applied to form questions):
 *   - quantity:     numeric value + unit input  (R1 unknown fact attribute)
 *   - actorRef:     dropdown of doc actors      (R4 unassigned obligation)
 *   - kpiCriterion: KPI expression + criterion  (R9 stated-without-kpi)
 *   - requirement:  new requirement fields       (R8 role-kpi-catalog)
 *   - owner:        actor or "none"              (R10 undeclared owner)
 *   - endUserStance:dropdown of doc actors      (R12 no end user — ADR-165 D1)
 *   - criteria:     QCD + S mix + expectation/weight per element (R12 unheard — ADR-165 D2)
 *   - jobFunction:  dropdown of job functions    (R13 — ADR-165 D1)
 *
 * Every ANSWER_KIND has exactly one widget here (FormAnswerKinds.test.js) —
 * a question shown with no input is consumed attention with nothing to do
 * (PHILOSOPHY #11; R10 shipped that way until ADR-165 PR1 counted it).
 *
 * Each "Answer" button calls `onAnswerQuestion(qRef, answer)` which the
 * ContextController handles: snapshot beforeDoc, applyQuestionAnswer(beforeDoc, q, a),
 * create + push AnswerQuestionCommand (undoable — ADR-050 §3.5).
 *
 * Completion is machine-checkable: `form` is empty exactly when all validator
 * OpenQuestions have been answered (PHILOSOPHY #11 — the form state cannot lie).
 *
 * Proof-feedback wiring (ADR-062 Phase 2): each answer already re-validates and
 * re-projects; this panel only makes that fact FELT — a run-over-run open-count
 * delta chip and a green landing flash naming the question(s) the last answer
 * closed. The sole fact source stays `projectForm()` (via `context.form`); the
 * previous snapshot is component-local presentation state, never a store field.
 */

export function FormPanel() {
  const form      = useUIStore(s => s.context.form)
  const actors    = useUIStore(s => s.context.actors)
  const callbacks = useUIStore(s => s.callbacks)

  // Previous open-question snapshot (updated only on real changes — array
  // identity churn from re-projection is absorbed by the signature).
  const { prev, tick } = usePrevOnChange(form)
  const delta   = listDelta(prev, form)
  const settled = settledRefs(prev, form) ?? []

  if (!form || form.length === 0) {
    return (
      <LandingFlash tick={tick} active={settled.length > 0}
        style={{ padding: '12px 8px', textAlign: 'center', borderRadius: '4px' }}>
        <div style={{ color: '#22C55E', fontSize: '11px' }}>
          ✓ No questions awaiting an answer
        </div>
        {settled.length > 0 && (
          <div style={{ color: '#7a9', fontSize: '9px', marginTop: '3px' }}>
            last answer closed {settled.join(', ')}
          </div>
        )}
      </LandingFlash>
    )
  }

  return (
    <div>
      <div style={{ padding: '4px 0 8px', fontSize: '10px', color: '#999', lineHeight: 1.5 }}>
        Open items found by the validator. Each answer removes one question; the form closes when all are answered.
        Every answer is committed as an undoable document change.
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', paddingBottom: '6px', fontSize: '10px', color: '#c8c8c8' }}>
        <span>{form.length} open question{form.length > 1 ? 's' : ''}</span>
        {/* fewer open questions = progress → goodWhenPositive: false */}
        <DeltaChip value={delta} goodWhenPositive={false} label="open" />
      </div>
      {settled.length > 0 && (
        <LandingFlash tick={tick} style={{ borderRadius: '4px', marginBottom: '6px' }}>
          <div style={{ fontSize: '9px', color: '#22C55E', padding: '3px 5px' }}>
            ✓ answered: {settled.join(', ')}
          </div>
        </LandingFlash>
      )}
      {form.map(q => (
        <QuestionItem
          key={q.ref}
          question={q}
          actors={actors}
          onAnswer={(answer) => callbacks.onAnswerQuestion?.(q.ref, q, answer)}
        />
      ))}
    </div>
  )
}

function QuestionItem({ question, actors, onAnswer }) {
  return (
    <div style={{
      padding: '8px', marginBottom: '8px', borderRadius: '4px',
      background: 'rgba(255,255,255,0.04)', border: '1px solid #3a3a3a',
    }}>
      <div style={{ marginBottom: '4px' }}>
        <span style={{
          background: '#4a3a20', color: '#f0a040', borderRadius: '3px',
          padding: '0 5px', fontSize: '9px', fontWeight: 'bold', marginRight: '6px',
        }}>
          {question.raisedBy}
        </span>
        <span style={{ fontSize: '11px', color: '#c8c8c8' }}>{question.prompt}</span>
      </div>
      <div style={{ fontSize: '9px', color: '#666', marginBottom: '6px', fontFamily: 'monospace' }}>
        {question.ref}
      </div>
      {question.answerKind === ANSWER_KIND.QUANTITY && (
        <QuantityWidget onAnswer={onAnswer} />
      )}
      {question.answerKind === ANSWER_KIND.ACTOR_REF && (
        <ActorRefWidget actors={actors} onAnswer={onAnswer} />
      )}
      {question.answerKind === ANSWER_KIND.KPI_CRITERION && (
        <KpiCriterionWidget onAnswer={onAnswer} />
      )}
      {question.answerKind === ANSWER_KIND.REQUIREMENT && (
        <RequirementWidget question={question} onAnswer={onAnswer} />
      )}
      {question.answerKind === ANSWER_KIND.OWNER && (
        <OwnerWidget actors={actors} onAnswer={onAnswer} />
      )}
      {question.answerKind === ANSWER_KIND.END_USER && (
        <ActorRefWidget actors={actors} onAnswer={onAnswer} />
      )}
      {question.answerKind === ANSWER_KIND.CRITERIA && (
        <CriteriaWidget onAnswer={onAnswer} />
      )}
      {question.answerKind === ANSWER_KIND.JOB_FUNCTION && (
        <JobFunctionWidget onAnswer={onAnswer} />
      )}
    </div>
  )
}

// ── Answer widgets ─────────────────────────────────────────────────────────────

function QuantityWidget({ onAnswer }) {
  const [value, setValue] = useState('')
  const [unit,  setUnit]  = useState('')
  const valid = value !== '' && !isNaN(Number(value))

  return (
    <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
      <input
        type="number"
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder="value"
        style={inputStyle}
      />
      <input
        type="text"
        value={unit}
        onChange={e => setUnit(e.target.value)}
        placeholder="unit"
        style={{ ...inputStyle, width: '60px' }}
      />
      <AnswerButton disabled={!valid} onClick={() => onAnswer({ value: Number(value), unit })} />
    </div>
  )
}

function ActorRefWidget({ actors = [], onAnswer }) {
  const [selected, setSelected] = useState(actors[0]?.ref ?? '')

  return (
    <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
      <select
        value={selected}
        onChange={e => setSelected(e.target.value)}
        style={{ ...inputStyle, cursor: 'pointer' }}
      >
        {actors.length === 0 && <option value="">— no actor —</option>}
        {actors.map(a => (
          <option key={a.ref} value={a.ref}>{a.ref} ({jobFunctionOf(a) ?? '?'})</option>
        ))}
      </select>
      <AnswerButton disabled={!selected} onClick={() => onAnswer({ actorRef: selected })} />
    </div>
  )
}

function KpiCriterionWidget({ onAnswer }) {
  const [kpiName, setKpiName]   = useState('')
  const [kpiExpr, setKpiExpr]   = useState('')
  const [kpiUnit, setKpiUnit]   = useState('')
  const [op,      setOp]        = useState('>=')
  const [val,     setVal]       = useState('')

  const valid = kpiExpr.trim() !== '' && val !== '' && !isNaN(Number(val))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <div style={{ display: 'flex', gap: '4px' }}>
        <input
          type="text"
          value={kpiName}
          onChange={e => setKpiName(e.target.value)}
          placeholder="KPI name"
          style={{ ...inputStyle, width: '90px', flexShrink: 0 }}
        />
        <input
          type="text"
          value={kpiUnit}
          onChange={e => setKpiUnit(e.target.value)}
          placeholder="unit"
          style={{ ...inputStyle, width: '50px', flexShrink: 0 }}
        />
      </div>
      <input
        type="text"
        value={kpiExpr}
        onChange={e => setKpiExpr(e.target.value)}
        placeholder="KPI expr: e.g. eoat_clearance(v_robot_base_x)"
        style={{ ...inputStyle, fontFamily: 'monospace', fontSize: '10px' }}
      />
      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
        <span style={{ fontSize: '10px', color: '#888' }}>criterion</span>
        <select
          value={op}
          onChange={e => setOp(e.target.value)}
          style={{ ...inputStyle, width: '50px', cursor: 'pointer' }}
        >
          {['>=', '<=', '>', '<', '=='].map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <input
          type="number"
          value={val}
          onChange={e => setVal(e.target.value)}
          placeholder="value"
          style={{ ...inputStyle, width: '70px' }}
        />
        <AnswerButton
          disabled={!valid}
          onClick={() => onAnswer({
            kpi:       { name: kpiName || 'kpi', expr: kpiExpr.trim(), unit: kpiUnit },
            criterion: { op, value: Number(val) },
          })}
        />
      </div>
    </div>
  )
}

function RequirementWidget({ question, onAnswer }) {
  const [ref,   setRef]   = useState(`r_added_${question.ref.replace(/^oq_/, '')}`)
  const [by,    setBy]    = useState('')
  const [desc,  setDesc]  = useState('')

  const valid = ref.trim() !== ''

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <input
        type="text"
        value={ref}
        onChange={e => setRef(e.target.value)}
        placeholder="requirement ref (r_...)"
        style={{ ...inputStyle, fontFamily: 'monospace' }}
      />
      <input
        type="text"
        value={by}
        onChange={e => setBy(e.target.value)}
        placeholder="actor ref (by)"
        style={inputStyle}
      />
      <input
        type="text"
        value={desc}
        onChange={e => setDesc(e.target.value)}
        placeholder="note"
        style={inputStyle}
      />
      <AnswerButton
        disabled={!valid}
        onClick={() => onAnswer({
          requirement: { ref: ref.trim(), by: by.trim() || undefined, note: desc.trim() || undefined },
        })}
      />
    </div>
  )
}

function OwnerWidget({ actors = [], onAnswer }) {
  const [owner, setOwner] = useState(actors[0]?.ref ?? OWNER_NONE_DECLARED)
  return (
    <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
      <select value={owner} onChange={e => setOwner(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
        {actors.map(a => <option key={a.ref} value={a.ref}>{a.ref}</option>)}
        <option value={OWNER_NONE_DECLARED}>none — it belongs to no one</option>
      </select>
      <AnswerButton disabled={!owner} onClick={() => onAnswer({ owner })} />
    </div>
  )
}

function JobFunctionWidget({ onAnswer }) {
  const [role, setRole] = useState('')
  return (
    <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
      <select value={role} onChange={e => setRole(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
        <option value="">— job function —</option>
        {VALID_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
      </select>
      <AnswerButton disabled={!role} onClick={() => onAnswer({ role })} />
    </div>
  )
}

/**
 * ADR-165 D2 — the end user's value tree in one place: the QCD + S ratio and,
 * per element, the expectation (criterion) and the weight. Only the fields
 * actually filled are sent; a blank stays blank and stays counted. This is the
 * plain form; the character-creation flow (D3) is a later stage.
 */
function CriteriaWidget({ onAnswer }) {
  const [mix, setMix] = useState({})
  const [rows, setRows] = useState(() =>
    Object.fromEntries(CRITERIA_ELEMENTS.map(e => [e.key, { op: e.op, value: '', weight: '' }])))
  const num = (v) => v !== '' && !isNaN(Number(v)) && Number(v) >= 0

  const answer = {
    mix: Object.fromEntries(CRITERIA_CATEGORIES.filter(c => num(mix[c] ?? '')).map(c => [c, Number(mix[c])])),
    elements: Object.fromEntries(CRITERIA_ELEMENTS.flatMap(e => {
      const r = rows[e.key]
      const out = {}
      if (r.value !== '' && !isNaN(Number(r.value))) out.criterion = { op: r.op, value: Number(r.value) }
      if (num(r.weight)) out.weight = Number(r.weight)
      return Object.keys(out).length ? [[e.key, out]] : []
    })),
  }
  const anything = Object.keys(answer.mix).length + Object.keys(answer.elements).length > 0
  const setRow = (key, patch) => setRows(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }} data-testid="criteria-widget">
      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
        <span style={{ fontSize: '10px', color: COLOR.textSecondary, width: '42px', flexShrink: 0 }}>ratio</span>
        {CRITERIA_CATEGORIES.map(c => (
          <input key={c} type="number" min="0" value={mix[c] ?? ''} title={CRITERIA_CATEGORY_LABELS[c]}
            onChange={e => setMix(prev => ({ ...prev, [c]: e.target.value }))}
            placeholder={c} style={{ ...inputStyle, width: '40px' }} />
        ))}
      </div>
      {CRITERIA_ELEMENTS.map(e => (
        <div key={e.key} style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          <span style={{ fontSize: '10px', color: COLOR.textSecondary, flex: 2, minWidth: 0 }} title={CRITERIA_CATEGORY_LABELS[e.category]}>
            {e.category} · {e.label}
          </span>
          <select value={rows[e.key].op} onChange={ev => setRow(e.key, { op: ev.target.value })}
            style={{ ...inputStyle, flex: 'none', width: '56px', cursor: 'pointer' }}>
            {CRITERION_OPS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
          <input type="number" value={rows[e.key].value} placeholder={`expect ${e.unit}`}
            onChange={ev => setRow(e.key, { value: ev.target.value })} style={{ ...inputStyle, width: '60px' }} />
          <input type="number" min="0" value={rows[e.key].weight} placeholder="weight"
            onChange={ev => setRow(e.key, { weight: ev.target.value })} style={{ ...inputStyle, width: '50px' }} />
        </div>
      ))}
      <div><AnswerButton disabled={!anything} onClick={() => onAnswer(answer)} /></div>
    </div>
  )
}

function AnswerButton({ disabled, onClick }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      style={{
        padding: '4px 10px', background: disabled ? '#2a2a2a' : '#1a4a1a',
        border: `1px solid ${disabled ? '#3a3a3a' : '#2a8a2a'}`,
        borderRadius: '3px', color: disabled ? '#555' : '#5af55a',
        cursor: disabled ? 'default' : 'pointer', fontSize: '11px',
        whiteSpace: 'nowrap',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      Answer
    </button>
  )
}

const inputStyle = {
  flex: 1,
  padding: '4px 6px',
  background: '#1a1a1a',
  border: '1px solid #3a3a3a',
  borderRadius: '3px',
  color: '#e0e0e0',
  fontSize: '11px',
  fontFamily: 'system-ui, -apple-system, sans-serif',
  minWidth: 0,
}
