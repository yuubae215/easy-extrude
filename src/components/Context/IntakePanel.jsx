import { useState, useEffect, useMemo } from 'react'
import { useUIStore } from '../../store/uiStore.js'
import { extractFacts } from '../../context/NlIntake.js'
import { buildSeedIndex, describeSeedRequirement } from '../../context/SeedAnchor.js'

/**
 * IntakePanel — direct entry addition UI for blank-doc authoring (ADR-051 Phase 1).
 *
 * Shown as an 'intake' tab in ContextLayer when mode === 'negotiate'. Provides
 * compact forms to add Actors, Variables, and Requirements directly to the
 * canonical doc (Why-first: actors → variables → requirements — ADR-051 §2.0).
 *
 * Each submission fires `onAddDocEntry(type, data)` which ContextController
 * translates into a DocBuilder call + AddDocEntryCommand push (undoable).
 */

const ROLES = ['developer', 'maintainer', 'endUser', 'agent', 'customer']
const DISCIPLINES = ['', 'vision', 'robot', 'mech', 'sw', 'plan']
const CRITERION_OPS = ['>=', '<=', '>', '<', '==']
const NEGOTIABILITY = ['must', 'should']

const inputStyle = {
  background: '#1a1a1a', border: '1px solid #444', borderRadius: '3px',
  color: '#e0e0e0', padding: '3px 6px', fontSize: '11px', width: '100%',
  fontFamily: 'system-ui, -apple-system, sans-serif', boxSizing: 'border-box',
}

const labelStyle = {
  color: '#999', fontSize: '10px', display: 'block', marginBottom: '2px',
}

const btnStyle = (primary = false) => ({
  padding: '4px 10px', borderRadius: '3px', fontSize: '11px', cursor: 'pointer',
  border: 'none', fontFamily: 'system-ui, -apple-system, sans-serif',
  background: primary ? '#3a7bd5' : '#3a3a3a',
  color: primary ? '#fff' : '#ccc',
})

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: '5px' }}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  )
}

function Select({ value, onChange, options }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      style={{ ...inputStyle, padding: '2px 4px' }}>
      {options.map(o => typeof o === 'string'
        ? <option key={o} value={o}>{o || '—'}</option>
        : <option key={o.value} value={o.value}>{o.label}</option>
      )}
    </select>
  )
}

// ── Section header ─────────────────────────────────────────────────────────────

function Section({ title, count, children, open, onToggle }) {
  return (
    <div style={{ marginBottom: '8px' }}>
      <button
        onClick={onToggle}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: '6px',
          background: 'transparent', border: 'none', color: '#ccc', cursor: 'pointer',
          padding: '4px 0', fontSize: '11px', fontWeight: 'bold', textAlign: 'left',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        <span style={{ color: '#555' }}>{open ? '▾' : '▸'}</span>
        <span>{title}</span>
        {count > 0 && (
          <span style={{
            background: '#2a4a2a', color: '#22C55E', borderRadius: '7px',
            padding: '0 5px', fontSize: '9px', marginLeft: 'auto',
          }}>
            {count}
          </span>
        )}
      </button>
      {open && (
        <div style={{ paddingLeft: '10px', paddingBottom: '4px' }}>
          {children}
        </div>
      )}
    </div>
  )
}

// ── Actor form ─────────────────────────────────────────────────────────────────

function ActorForm({ actors, onAdd }) {
  const [ref, setRef]    = useState('')
  const [role, setRole]  = useState('developer')
  const [disc, setDisc]  = useState('')

  function submit() {
    const r = ref.trim()
    if (!r) return
    onAdd({ ref: r, role, ...(disc ? { discipline: disc } : {}) })
    setRef(''); setDisc('')
  }

  return (
    <div>
      {actors.length > 0 && (
        <div style={{ marginBottom: '6px' }}>
          {actors.map(a => (
            <div key={a.ref} style={{ fontSize: '10px', color: '#888', paddingBottom: '2px' }}>
              <span style={{ color: '#5a9bf5' }}>{a.ref}</span>
              {' · '}<span style={{ color: '#aaa' }}>{a.role}</span>
              {a.discipline && <span style={{ color: '#777' }}> · {a.discipline}</span>}
            </div>
          ))}
        </div>
      )}
      <Field label="ref (e.g. a_robot)">
        <input value={ref} onChange={e => setRef(e.target.value)}
          placeholder="a_robot" style={inputStyle}
          onKeyDown={e => e.key === 'Enter' && submit()} />
      </Field>
      <Field label="role">
        <Select value={role} onChange={setRole} options={ROLES} />
      </Field>
      <Field label="discipline (optional)">
        <Select value={disc} onChange={setDisc} options={DISCIPLINES} />
      </Field>
      <button onClick={submit} style={btnStyle(true)} disabled={!ref.trim()}>
        + Add Actor
      </button>
    </div>
  )
}

// ── Variable form ──────────────────────────────────────────────────────────────

function VariableForm({ variables, onAdd }) {
  const [ref, setRef]   = useState('')
  const [unit, setUnit] = useState('mm')
  const [lo, setLo]     = useState('')
  const [hi, setHi]     = useState('')
  const [desc, setDesc] = useState('')

  function submit() {
    const r = ref.trim(), u = unit.trim()
    const loN = parseFloat(lo), hiN = parseFloat(hi)
    if (!r || !u || isNaN(loN) || isNaN(hiN)) return
    onAdd({ ref: r, unit: u, domain: [loN, hiN], ...(desc.trim() ? { description: desc.trim() } : {}) })
    setRef(''); setLo(''); setHi(''); setDesc('')
  }

  return (
    <div>
      {variables.length > 0 && (
        <div style={{ marginBottom: '6px' }}>
          {variables.map(v => (
            <div key={v.ref} style={{ fontSize: '10px', color: '#888', paddingBottom: '2px' }}>
              <span style={{ color: '#5a9bf5' }}>{v.ref}</span>
              {' '}<span style={{ color: '#aaa' }}>∈ [{v.domain?.[0]}, {v.domain?.[1]}] {v.unit}</span>
            </div>
          ))}
        </div>
      )}
      <Field label="ref (e.g. v_reach)">
        <input value={ref} onChange={e => setRef(e.target.value)}
          placeholder="v_reach" style={inputStyle}
          onKeyDown={e => e.key === 'Enter' && submit()} />
      </Field>
      <Field label="unit">
        <input value={unit} onChange={e => setUnit(e.target.value)}
          placeholder="mm" style={inputStyle} />
      </Field>
      <div style={{ display: 'flex', gap: '6px' }}>
        <Field label="domain lo">
          <input value={lo} onChange={e => setLo(e.target.value)}
            placeholder="0" type="number" style={inputStyle} />
        </Field>
        <Field label="domain hi">
          <input value={hi} onChange={e => setHi(e.target.value)}
            placeholder="1000" type="number" style={inputStyle} />
        </Field>
      </div>
      <Field label="description (optional)">
        <input value={desc} onChange={e => setDesc(e.target.value)}
          placeholder="description" style={inputStyle} />
      </Field>
      <button onClick={submit} style={btnStyle(true)}
        disabled={!ref.trim() || !unit.trim() || lo === '' || hi === ''}>
        + Add Variable
      </button>
    </div>
  )
}

// ── Requirement form ───────────────────────────────────────────────────────────

function RequirementForm({ actors, variables, seedReqs = [], onAdd, onPreview }) {
  const [ref, setRef]         = useState('')
  const [by, setBy]           = useState('')
  const [kpiName, setKpiName] = useState('')
  const [kpiExpr, setKpiExpr] = useState('')
  const [kpiUnit, setKpiUnit] = useState('')
  const [op, setOp]           = useState('>=')
  const [val, setVal]         = useState('')
  const [constrains, setConst]= useState('')
  const [neg, setNeg]         = useState('must')
  const [admLo, setAdmLo]     = useState('')
  const [admHi, setAdmHi]     = useState('')

  // ADR-058 fork & tweak: pre-fill every field from a seed example requirement so
  // the user tweaks real values instead of facing a blank schema. The ref is
  // suffixed `_copy` because the forked working doc already contains the seed ref —
  // the user renames it. Values become editable anchors (the filled example IS the
  // explanation of "what to put here").
  function fillFromSeed(req) {
    setRef((req.ref ?? '') + '_copy')
    setBy(req.by ?? '')
    setKpiName(req.kpi?.name ?? '')
    setKpiExpr(req.kpi?.expr ?? '')
    setKpiUnit(req.kpi?.unit ?? '')
    setOp(req.criterion?.op ?? '>=')
    setVal(req.criterion?.value != null ? String(req.criterion.value) : '')
    setConst(req.constrains?.[0] ?? '')
    setNeg(req.negotiability ?? 'must')
    const iv = req.admissible?.interval
    setAdmLo(Array.isArray(iv) ? String(iv[0]) : '')
    setAdmHi(Array.isArray(iv) ? String(iv[1]) : '')
  }

  // Live 3D uncertainty-band preview driven by the admissible interval inputs
  // (ADR-051 Phase 3 — Entry D). Fires as [lo, hi] change; cleared on unmount
  // (tab switch / section collapse) and after a successful submit.
  const admUnit = variables.find(v => v.ref === constrains)?.unit ?? kpiUnit
  useEffect(() => {
    const loN = parseFloat(admLo), hiN = parseFloat(admHi)
    if (isNaN(loN) || isNaN(hiN) || hiN <= loN) {
      onPreview?.(null)
      return
    }
    onPreview?.({ lo: loN, hi: hiN, unit: admUnit, label: ref.trim() || 'requirement' })
  }, [admLo, admHi, admUnit, ref])
  useEffect(() => () => onPreview?.(null), [])

  function submit() {
    const r = ref.trim(), b = by.trim(), kn = kpiName.trim(), kc = constrains.trim()
    const valN = parseFloat(val), loN = parseFloat(admLo), hiN = parseFloat(admHi)
    if (!r || !b || !kn || !kc || isNaN(valN) || isNaN(loN) || isNaN(hiN)) return
    onPreview?.(null)
    onAdd({
      ref: r,
      by:  b,
      kpi: { name: kn, expr: kpiExpr.trim() || kn, unit: kpiUnit.trim() },
      criterion: { op, value: valN },
      constrains: [kc],
      negotiability: neg,
      admissible: { interval: [loN, hiN], source: 'stated' },
      evidence: [],
    })
    setRef(''); setBy(actors[0]?.ref ?? ''); setKpiName(''); setKpiExpr('')
    setKpiUnit(''); setVal(''); setConst(variables[0]?.ref ?? '')
    setAdmLo(''); setAdmHi('')
  }

  const actorOpts = actors.map(a => ({ value: a.ref, label: a.ref }))
  const varOpts   = variables.map(v => ({ value: v.ref, label: `${v.ref} (${v.unit})` }))
  const canSubmit = ref.trim() && by.trim() && kpiName.trim() && constrains.trim()
    && val !== '' && admLo !== '' && admHi !== ''

  return (
    <div>
      {seedReqs.length > 0 && (
        <div style={{ marginBottom: '7px' }}>
          <div style={{ fontSize: '9px', color: '#777', marginBottom: '3px' }}>
            ✎ From example — click to copy a filled requirement, then tweak it:
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {seedReqs.map(req => (
              <button
                key={req.ref}
                onClick={() => fillFromSeed(req)}
                title={describeSeedRequirement(req)}
                style={{
                  cursor: 'pointer', background: 'rgba(213,162,58,0.08)',
                  border: '1px dashed #d5a23a55', borderRadius: '10px',
                  color: '#d5a23a', padding: '2px 8px', fontSize: '10px',
                  fontFamily: 'system-ui, -apple-system, sans-serif',
                }}
              >
                {req.ref}
              </button>
            ))}
          </div>
        </div>
      )}
      <Field label="ref (e.g. r_reach)">
        <input value={ref} onChange={e => setRef(e.target.value)}
          placeholder="r_reach" style={inputStyle} />
      </Field>
      <Field label="by (actor)">
        {actors.length > 0
          ? <Select value={by} onChange={setBy}
              options={[{ value: '', label: '— select —' }, ...actorOpts]} />
          : <input value={by} onChange={e => setBy(e.target.value)}
              placeholder="a_robot" style={inputStyle} />
        }
      </Field>
      <Field label="KPI name">
        <input value={kpiName} onChange={e => setKpiName(e.target.value)}
          placeholder="reach" style={inputStyle} />
      </Field>
      <Field label="KPI expr (defaults to KPI name)">
        <input value={kpiExpr} onChange={e => setKpiExpr(e.target.value)}
          placeholder="arm_length" style={inputStyle} />
      </Field>
      <Field label="KPI unit">
        <input value={kpiUnit} onChange={e => setKpiUnit(e.target.value)}
          placeholder="mm" style={inputStyle} />
      </Field>
      <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-end' }}>
        <div style={{ flex: '0 0 60px' }}>
          <label style={labelStyle}>operator</label>
          <Select value={op} onChange={setOp} options={CRITERION_OPS} />
        </div>
        <Field label="threshold">
          <input value={val} onChange={e => setVal(e.target.value)}
            type="number" placeholder="400" style={inputStyle} />
        </Field>
      </div>
      <Field label="constrains (variable)">
        {variables.length > 0
          ? <Select value={constrains} onChange={setConst}
              options={[{ value: '', label: '— select —' }, ...varOpts]} />
          : <input value={constrains} onChange={e => setConst(e.target.value)}
              placeholder="v_reach" style={inputStyle} />
        }
      </Field>
      <Field label="negotiability">
        <Select value={neg} onChange={setNeg} options={NEGOTIABILITY} />
      </Field>
      <div style={{ fontSize: '9px', color: '#777', margin: '2px 0 1px' }}>
        Admissible interval — entering it shows the uncertainty band in 3D immediately
      </div>
      <div style={{ display: 'flex', gap: '6px' }}>
        <Field label="admissible lo">
          <input value={admLo} onChange={e => setAdmLo(e.target.value)}
            type="number" placeholder="400" style={inputStyle} />
        </Field>
        <Field label="admissible hi">
          <input value={admHi} onChange={e => setAdmHi(e.target.value)}
            type="number" placeholder="800" style={inputStyle} />
        </Field>
      </div>
      <button onClick={submit} style={btnStyle(true)} disabled={!canSubmit}>
        + Add Requirement
      </button>
    </div>
  )
}

// ── Natural-language intake form (ADR-051 Phase 4 — Entry C) ─────────────────────

function NlIntakeForm({ onAddFacts }) {
  const [text, setText] = useState('')

  // The extractor is pure (THREE-free) — preview is computed locally, no controller
  // round-trip. Only commit is a side effect (fires onAddFacts → undoable command).
  const { facts, unparsed } = extractFacts(text)

  function commit() {
    if (facts.length === 0) return
    onAddFacts(facts)
    setText('')
  }

  return (
    <div>
      <div style={{ fontSize: '10px', color: '#777', marginBottom: '5px', lineHeight: 1.5 }}>
        Paste an utterance or note to extract Facts. Vague values (approximate, range, unknown) are taken in
        conservatively as <span style={{ color: '#d5a23a' }}>unconfirmed</span> and resolved in Questions.
      </div>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={3}
        placeholder={'e.g.:\nCamera resolution is 2448px\nRobot reach is about 800mm\nMount height is unknown'}
        style={{ ...inputStyle, resize: 'vertical', fontFamily: 'monospace', lineHeight: 1.4 }}
      />
      {(facts.length > 0 || unparsed.length > 0) && (
        <div style={{ margin: '6px 0', maxHeight: '160px', overflowY: 'auto' }}>
          {facts.map(f => (
            <div key={f.ref} style={{
              fontSize: '10px', padding: '3px 5px', marginBottom: '3px', borderRadius: '3px',
              background: f.status === 'unknown' ? 'rgba(213,162,58,0.10)' : 'rgba(34,197,94,0.08)',
              border: `1px solid ${f.status === 'unknown' ? '#d5a23a55' : '#22C55E44'}`,
            }}>
              <span style={{ color: f.status === 'unknown' ? '#d5a23a' : '#22C55E', fontWeight: 'bold' }}>
                {f.status === 'unknown' ? 'unconfirmed' : 'asserted'}
              </span>
              <span style={{ color: '#aaa', marginLeft: '5px' }}>{f.subject}</span>
              {Object.entries(f.attrs).map(([k, v]) => (
                <span key={k} style={{ color: '#888', marginLeft: '5px' }}>
                  · {k} = {v === 'unknown' ? '?' : `${v.value}${v.unit ?? ''}`}
                </span>
              ))}
            </div>
          ))}
          {unparsed.map((u, i) => (
            <div key={`u${i}`} style={{ fontSize: '10px', color: '#777', padding: '2px 5px' }}>
              ⚠ Not parsed: {u}
            </div>
          ))}
        </div>
      )}
      <button onClick={commit} style={btnStyle(true)} disabled={facts.length === 0}>
        + Add {facts.length || ''} Fact{facts.length > 1 ? 's' : ''} to document
      </button>
    </div>
  )
}

// ── IntakePanel (public) ───────────────────────────────────────────────────────

export function IntakePanel() {
  const ctx       = useUIStore(s => s.context)
  const callbacks = useUIStore(s => s.callbacks)

  const [openNl,    setOpenNl]    = useState(false)
  const [openActor, setOpenActor] = useState(true)
  const [openVar,   setOpenVar]   = useState(false)
  const [openReq,   setOpenReq]   = useState(false)

  const actors    = ctx.actors    ?? []
  const variables = ctx.variables ?? []

  // ADR-058 — when the project was forked from an example, index the read-only
  // seed so the requirement form can offer its filled values as anchors.
  const seedIndex = useMemo(() => buildSeedIndex(ctx.authorSeed), [ctx.authorSeed])
  const seedName  = ctx.authorSeed?.meta?.name

  function onAdd(type, data) {
    callbacks.onAddDocEntry?.(type, data)
  }

  return (
    <div style={{ paddingBottom: '8px' }}>
      {seedName && (
        <div style={{
          fontSize: '10px', color: '#d5a23a', marginBottom: '8px', lineHeight: 1.5,
          background: 'rgba(213,162,58,0.08)', border: '1px dashed #d5a23a44',
          borderRadius: '4px', padding: '5px 7px',
        }}>
          ✎ Forked from <b>{seedName}</b> — its filled values are kept as anchors below. Tweak them into your own.
        </div>
      )}
      <div style={{ fontSize: '10px', color: '#666', marginBottom: '8px', lineHeight: 1.5 }}>
        Why-first — register actors and variables first, then add requirements with KPI criteria.
      </div>

      <Section
        title="Import from natural language"
        count={0}
        open={openNl}
        onToggle={() => setOpenNl(o => !o)}
      >
        <NlIntakeForm onAddFacts={facts => callbacks.onAddNlFacts?.(facts)} />
      </Section>

      <Section
        title="Actors"
        count={actors.length}
        open={openActor}
        onToggle={() => setOpenActor(o => !o)}
      >
        <ActorForm actors={actors} onAdd={d => onAdd('actor', d)} />
      </Section>

      <Section
        title="Variables"
        count={variables.length}
        open={openVar}
        onToggle={() => setOpenVar(o => !o)}
      >
        <VariableForm variables={variables} onAdd={d => onAdd('variable', d)} />
      </Section>

      <Section
        title="Requirements"
        count={ctx.conflictMatrix
          ? Object.values(ctx.conflictMatrix.variableSummary ?? {}).reduce((n, s) => n + (s.requirements?.length ?? 0), 0)
          : 0}
        open={openReq}
        onToggle={() => setOpenReq(o => !o)}
      >
        <RequirementForm
          actors={actors}
          variables={variables}
          seedReqs={seedIndex.requirements}
          onAdd={d => onAdd('requirement', d)}
          onPreview={spec => callbacks.onIntakePreview?.(spec)}
        />
      </Section>
    </div>
  )
}
