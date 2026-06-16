import { useState, useEffect } from 'react'
import { useUIStore } from '../../store/uiStore.js'
import { extractFacts } from '../../context/NlIntake.js'

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
      <Field label="ref (例: a_robot)">
        <input value={ref} onChange={e => setRef(e.target.value)}
          placeholder="a_robot" style={inputStyle}
          onKeyDown={e => e.key === 'Enter' && submit()} />
      </Field>
      <Field label="role">
        <Select value={role} onChange={setRole} options={ROLES} />
      </Field>
      <Field label="discipline (省略可)">
        <Select value={disc} onChange={setDisc} options={DISCIPLINES} />
      </Field>
      <button onClick={submit} style={btnStyle(true)} disabled={!ref.trim()}>
        + Actor を追加
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
      <Field label="ref (例: v_reach)">
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
      <Field label="description (省略可)">
        <input value={desc} onChange={e => setDesc(e.target.value)}
          placeholder="説明" style={inputStyle} />
      </Field>
      <button onClick={submit} style={btnStyle(true)}
        disabled={!ref.trim() || !unit.trim() || lo === '' || hi === ''}>
        + Variable を追加
      </button>
    </div>
  )
}

// ── Requirement form ───────────────────────────────────────────────────────────

function RequirementForm({ actors, variables, onAdd, onPreview }) {
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
      <Field label="ref (例: r_reach)">
        <input value={ref} onChange={e => setRef(e.target.value)}
          placeholder="r_reach" style={inputStyle} />
      </Field>
      <Field label="by (actor)">
        {actors.length > 0
          ? <Select value={by} onChange={setBy}
              options={[{ value: '', label: '— 選択 —' }, ...actorOpts]} />
          : <input value={by} onChange={e => setBy(e.target.value)}
              placeholder="a_robot" style={inputStyle} />
        }
      </Field>
      <Field label="KPI 名">
        <input value={kpiName} onChange={e => setKpiName(e.target.value)}
          placeholder="reach" style={inputStyle} />
      </Field>
      <Field label="KPI 式 (省略時: KPI名)">
        <input value={kpiExpr} onChange={e => setKpiExpr(e.target.value)}
          placeholder="arm_length" style={inputStyle} />
      </Field>
      <Field label="KPI 単位">
        <input value={kpiUnit} onChange={e => setKpiUnit(e.target.value)}
          placeholder="mm" style={inputStyle} />
      </Field>
      <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-end' }}>
        <div style={{ flex: '0 0 60px' }}>
          <label style={labelStyle}>判定</label>
          <Select value={op} onChange={setOp} options={CRITERION_OPS} />
        </div>
        <Field label="基準値">
          <input value={val} onChange={e => setVal(e.target.value)}
            type="number" placeholder="400" style={inputStyle} />
        </Field>
      </div>
      <Field label="constrains (variable)">
        {variables.length > 0
          ? <Select value={constrains} onChange={setConst}
              options={[{ value: '', label: '— 選択 —' }, ...varOpts]} />
          : <input value={constrains} onChange={e => setConst(e.target.value)}
              placeholder="v_reach" style={inputStyle} />
        }
      </Field>
      <Field label="negotiability">
        <Select value={neg} onChange={setNeg} options={NEGOTIABILITY} />
      </Field>
      <div style={{ fontSize: '9px', color: '#777', margin: '2px 0 1px' }}>
        許容区間 — 入力すると不確実バンドが 3D に即時表示されます (Entry D)
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
        + Requirement を追加
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
        発話・メモを貼り付けると Fact を抽出します。あいまいな値（約・範囲・不明）は
        <span style={{ color: '#d5a23a' }}> 未確定</span> として保守的に取り込み、Questions で確定します
        (ADR-051 §Negative)。
      </div>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={3}
        placeholder={'例:\nカメラの解像度は2448px\nロボットのリーチは約800mm\n架台の高さは不明'}
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
                {f.status === 'unknown' ? '未確定' : 'asserted'}
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
              ⚠ 未解釈: {u}
            </div>
          ))}
        </div>
      )}
      <button onClick={commit} style={btnStyle(true)} disabled={facts.length === 0}>
        + {facts.length || ''} Fact をドキュメントに追加
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
  const requirements = (ctx.decisions != null)
    ? []  // counts shown via matrix; list not needed here
    : []

  function onAdd(type, data) {
    callbacks.onAddDocEntry?.(type, data)
  }

  return (
    <div style={{ paddingBottom: '8px' }}>
      <div style={{ fontSize: '10px', color: '#666', marginBottom: '8px', lineHeight: 1.5 }}>
        Why ファースト — まずアクター・変数を登録し、次に KPI 基準付き要件を追加してください (ADR-051 §2.0)。
      </div>

      <Section
        title="自然言語から取り込み"
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
          onAdd={d => onAdd('requirement', d)}
          onPreview={spec => callbacks.onIntakePreview?.(spec)}
        />
      </Section>
    </div>
  )
}
