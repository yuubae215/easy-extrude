import { useState, useEffect, useMemo } from 'react'
import { useUIStore } from '../../store/uiStore.js'
import { extractFacts } from '../../context/NlIntake.js'
import {
  buildSeedIndex,
  seedEntry,
  describeSeedRequirement,
  describeSeedActor,
  describeSeedVariable,
} from '../../context/SeedAnchor.js'

/**
 * IntakePanel — direct authoring UI for the canonical context doc (ADR-051 Phase 1,
 * ADR-058 fork & tweak).
 *
 * Shown as an 'intake' tab in ContextLayer when mode === 'negotiate'. Two motions
 * on the same forms:
 *   · **Add** — compact forms append Actors / Variables / Requirements
 *     (`onAddDocEntry(type, data)` → DocBuilder.addX + AddDocEntryCommand).
 *   · **Edit / remove in place** (ADR-058 Phase 2) — every existing entry is a
 *     click-to-edit card that softly unfolds into the same form, pre-filled and
 *     ref-locked, with Save / Cancel / Remove (`onEditDocEntry` / `onRemoveDocEntry`).
 *     The list you read IS the thing you edit — no separate "edit screen".
 *
 * All mutations go through the CommandStack (undoable) via ContextController.
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

// ── Soft-unfold + edit-mode scaffolding (ADR-058 Phase 2) ────────────────────────

// Fades + slides its children in on mount — gives the inline editor a gentle
// "unfold" instead of a hard pop when a card is clicked open.
function Reveal({ children }) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(id)
  }, [])
  return (
    <div style={{
      opacity: shown ? 1 : 0,
      transform: shown ? 'translateY(0)' : 'translateY(-5px)',
      transition: 'opacity 0.18s ease, transform 0.18s ease',
    }}>
      {children}
    </div>
  )
}

// An existing entry as an interactive card: hover lifts it and reveals the ✎
// affordance so the read-only list visibly becomes editable. `flash` briefly
// tints it green after a save, then fades (the "landed" confirmation).
function EntryCard({ children, onEdit, flash, badge, editable = true }) {
  const [hover, setHover] = useState(false)
  return (
    <div
      onClick={editable ? onEdit : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: '6px',
        fontSize: '10px', padding: '5px 7px', marginBottom: '4px',
        borderRadius: '5px', cursor: editable ? 'pointer' : 'default',
        border: `1px solid ${hover && editable ? '#3a5a8a' : '#2e2e2e'}`,
        background: flash ? 'rgba(34,197,94,0.30)'
          : hover && editable ? 'rgba(90,155,245,0.09)' : 'rgba(255,255,255,0.02)',
        transition: 'background 0.7s ease, border-color 0.15s ease',
      }}
    >
      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{children}</div>
      {badge}
      {editable && (
        <span style={{ color: hover ? '#5a9bf5' : '#4a4a4a', fontSize: '11px', transition: 'color 0.15s', flexShrink: 0 }}>✎</span>
      )}
    </div>
  )
}

// Ref shown but locked in edit mode — ref is identity; renaming is remove + re-add
// (a rename would orphan referencing by/constrains, which the validator rejects).
function LockedRef({ value }) {
  return (
    <Field label="ref · identity (remove & re-add to rename)">
      <div style={{
        ...inputStyle, background: '#151515', cursor: 'not-allowed',
        display: 'flex', alignItems: 'center', gap: '5px',
      }}>
        <span style={{ color: '#5a9bf5' }}>{value}</span>
        <span style={{ marginLeft: 'auto', color: '#555' }}>🔒</span>
      </div>
    </Field>
  )
}

// The example's original value for this entry, shown as a faint anchor while
// editing a forked entry (ADR-058 §3.2 — seed ghost). Reinforces "tweak the
// example into your own".
function SeedAnchorHint({ entry, describe }) {
  if (!entry) return null
  const text = describe(entry)
  if (!text) return null
  return (
    <div style={{
      fontSize: '9px', color: '#d5a23a', marginBottom: '6px',
      background: 'rgba(213,162,58,0.07)', border: '1px dashed #d5a23a44',
      borderRadius: '4px', padding: '3px 6px',
    }}>
      ✎ Example had: {text}
    </div>
  )
}

function EditorFooter({ onSave, canSave, onCancel, onRemove, saveLabel = 'Save' }) {
  return (
    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginTop: '4px' }}>
      <button onClick={onSave} style={btnStyle(true)} disabled={!canSave}>{saveLabel}</button>
      <button onClick={onCancel} style={btnStyle(false)}>Cancel</button>
      <button onClick={onRemove} title="Remove this entry"
        style={{ ...btnStyle(false), marginLeft: 'auto', color: '#e08585', background: 'transparent', border: '1px solid #5a3333' }}>
        🗑 Remove
      </button>
    </div>
  )
}

// ── Seed chips (ADR-058 fork & tweak) ───────────────────────────────────────────

// Renders the read-only seed entries of one kind as dashed amber chips. Clicking a
// chip floods the form with that example entry's real values (an editable anchor —
// the filled example IS the explanation of "what to put here"). Shared by the actor,
// variable, and requirement forms so all three read as one family (ADR-058 Phase 2).
function SeedChips({ entries, describe, onPick, hint }) {
  if (!entries || entries.length === 0) return null
  return (
    <div style={{ marginBottom: '7px' }}>
      <div style={{ fontSize: '9px', color: '#777', marginBottom: '3px' }}>{hint}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
        {entries.map(e => (
          <button
            key={e.ref}
            onClick={() => onPick(e)}
            title={describe(e)}
            style={{
              cursor: 'pointer', background: 'rgba(213,162,58,0.08)',
              border: '1px dashed #d5a23a55', borderRadius: '10px',
              color: '#d5a23a', padding: '2px 8px', fontSize: '10px',
              fontFamily: 'system-ui, -apple-system, sans-serif',
            }}
          >
            {e.ref}
          </button>
        ))}
      </div>
    </div>
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

// ── Actor form (dual mode: create | edit) ───────────────────────────────────────

function ActorForm({ mode = 'create', initial = null, seedActors = [], seedEntry: seed = null, onSubmit, onRemove, onCancel }) {
  const isEdit = mode === 'edit'
  const [ref, setRef]   = useState(initial?.ref ?? '')
  const [role, setRole] = useState(initial?.role ?? 'developer')
  const [disc, setDisc] = useState(initial?.discipline ?? '')

  // Create mode: copy a filled example actor, then tweak it. The ref is suffixed
  // `_copy` because the forked working doc already contains the seed ref.
  function fillFromSeed(a) {
    setRef((a.ref ?? '') + '_copy')
    setRole(a.role ?? 'developer')
    setDisc(a.discipline ?? '')
  }

  function submit() {
    const r = ref.trim()
    if (!r) return
    const next = { ...(initial ?? {}), ref: r, role }
    if (disc) next.discipline = disc; else delete next.discipline
    onSubmit(next)
    if (!isEdit) { setRef(''); setDisc('') }
  }

  return (
    <div>
      {!isEdit && (
        <SeedChips entries={seedActors} describe={describeSeedActor} onPick={fillFromSeed}
          hint="✎ From example — click to copy an actor, then tweak it:" />
      )}
      {isEdit && <SeedAnchorHint entry={seed} describe={describeSeedActor} />}
      {isEdit
        ? <LockedRef value={ref} />
        : <Field label="ref (e.g. a_robot)">
            <input value={ref} onChange={e => setRef(e.target.value)} placeholder="a_robot"
              style={inputStyle} onKeyDown={e => e.key === 'Enter' && submit()} />
          </Field>
      }
      <Field label="role">
        <Select value={role} onChange={setRole} options={ROLES} />
      </Field>
      <Field label="discipline (optional)">
        <Select value={disc} onChange={setDisc} options={DISCIPLINES} />
      </Field>
      {isEdit
        ? <EditorFooter onSave={submit} canSave={!!ref.trim()} onCancel={onCancel} onRemove={onRemove} />
        : <button onClick={submit} style={btnStyle(true)} disabled={!ref.trim()}>+ Add Actor</button>
      }
    </div>
  )
}

// ── Variable form (dual mode) ────────────────────────────────────────────────────

function VariableForm({ mode = 'create', initial = null, seedVariables = [], seedEntry: seed = null, onSubmit, onRemove, onCancel }) {
  const isEdit = mode === 'edit'
  const [ref, setRef]   = useState(initial?.ref ?? '')
  const [unit, setUnit] = useState(initial?.unit ?? 'mm')
  const [lo, setLo]     = useState(Array.isArray(initial?.domain) ? String(initial.domain[0]) : '')
  const [hi, setHi]     = useState(Array.isArray(initial?.domain) ? String(initial.domain[1]) : '')
  const [desc, setDesc] = useState(initial?.description ?? '')

  function fillFromSeed(v) {
    setRef((v.ref ?? '') + '_copy')
    setUnit(v.unit ?? 'mm')
    setLo(Array.isArray(v.domain) ? String(v.domain[0]) : '')
    setHi(Array.isArray(v.domain) ? String(v.domain[1]) : '')
    setDesc(v.description ?? '')
  }

  function submit() {
    const r = ref.trim(), u = unit.trim()
    const loN = parseFloat(lo), hiN = parseFloat(hi)
    if (!r || !u || isNaN(loN) || isNaN(hiN)) return
    const next = { ...(initial ?? {}), ref: r, unit: u, domain: [loN, hiN] }
    if (desc.trim()) next.description = desc.trim(); else delete next.description
    onSubmit(next)
    if (!isEdit) { setRef(''); setLo(''); setHi(''); setDesc('') }
  }

  const canSubmit = !!ref.trim() && !!unit.trim() && lo !== '' && hi !== ''
  return (
    <div>
      {!isEdit && (
        <SeedChips entries={seedVariables} describe={describeSeedVariable} onPick={fillFromSeed}
          hint="✎ From example — click to copy a variable, then tweak it:" />
      )}
      {isEdit && <SeedAnchorHint entry={seed} describe={describeSeedVariable} />}
      {isEdit
        ? <LockedRef value={ref} />
        : <Field label="ref (e.g. v_reach)">
            <input value={ref} onChange={e => setRef(e.target.value)} placeholder="v_reach"
              style={inputStyle} onKeyDown={e => e.key === 'Enter' && submit()} />
          </Field>
      }
      <Field label="unit">
        <input value={unit} onChange={e => setUnit(e.target.value)} placeholder="mm" style={inputStyle} />
      </Field>
      <div style={{ display: 'flex', gap: '6px' }}>
        <Field label="domain lo">
          <input value={lo} onChange={e => setLo(e.target.value)} placeholder="0" type="number" style={inputStyle} />
        </Field>
        <Field label="domain hi">
          <input value={hi} onChange={e => setHi(e.target.value)} placeholder="1000" type="number" style={inputStyle} />
        </Field>
      </div>
      <Field label="description (optional)">
        <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="description" style={inputStyle} />
      </Field>
      {isEdit
        ? <EditorFooter onSave={submit} canSave={canSubmit} onCancel={onCancel} onRemove={onRemove} />
        : <button onClick={submit} style={btnStyle(true)} disabled={!canSubmit}>+ Add Variable</button>
      }
    </div>
  )
}

// ── Requirement form (dual mode) ─────────────────────────────────────────────────

function RequirementForm({
  mode = 'create', initial = null, actors, variables, seedReqs = [],
  seedEntry: seed = null, onSubmit, onRemove, onCancel, onPreview,
}) {
  const isEdit = mode === 'edit'
  const [ref, setRef]         = useState(initial?.ref ?? '')
  const [by, setBy]           = useState(initial?.by ?? '')
  const [kpiName, setKpiName] = useState(initial?.kpi?.name ?? '')
  const [kpiExpr, setKpiExpr] = useState(initial?.kpi?.expr ?? '')
  const [kpiUnit, setKpiUnit] = useState(initial?.kpi?.unit ?? '')
  const [op, setOp]           = useState(initial?.criterion?.op ?? '>=')
  const [val, setVal]         = useState(initial?.criterion?.value != null ? String(initial.criterion.value) : '')
  const [constrains, setConst]= useState(initial?.constrains?.[0] ?? '')
  const [neg, setNeg]         = useState(initial?.negotiability ?? 'must')
  const [admLo, setAdmLo]     = useState(Array.isArray(initial?.admissible?.interval) ? String(initial.admissible.interval[0]) : '')
  const [admHi, setAdmHi]     = useState(Array.isArray(initial?.admissible?.interval) ? String(initial.admissible.interval[1]) : '')

  // Create mode: pre-fill every field from a seed example so the user tweaks real
  // values instead of a blank schema. ref suffixed `_copy` (forked doc has the ref).
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
  // (ADR-051 Phase 3). Fires in BOTH modes — editing an existing admissible moves
  // the band in 3D as you type (the "aha": text ⇄ 3D). Cleared on unmount
  // (tab switch / cancel / save) and when the interval is invalid.
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
    // Spread `initial` first so unmanaged fields (evidence, source, note…) survive
    // an edit — the form manages only the fields it shows (PHILOSOPHY #6 / #11).
    const base = initial ?? { evidence: [] }
    const admissible = { source: 'stated', ...(initial?.admissible ?? {}), interval: [loN, hiN] }
    onSubmit({
      ...base,
      ref: r,
      by:  b,
      kpi: { name: kn, expr: kpiExpr.trim() || kn, unit: kpiUnit.trim() },
      criterion: { op, value: valN },
      constrains: [kc],
      negotiability: neg,
      admissible,
    })
    if (!isEdit) {
      setRef(''); setBy(actors[0]?.ref ?? ''); setKpiName(''); setKpiExpr('')
      setKpiUnit(''); setVal(''); setConst(variables[0]?.ref ?? '')
      setAdmLo(''); setAdmHi('')
    }
  }

  const actorOpts = actors.map(a => ({ value: a.ref, label: a.ref }))
  const varOpts   = variables.map(v => ({ value: v.ref, label: `${v.ref} (${v.unit})` }))
  const canSubmit = ref.trim() && by.trim() && kpiName.trim() && constrains.trim()
    && val !== '' && admLo !== '' && admHi !== ''

  return (
    <div>
      {!isEdit && (
        <SeedChips entries={seedReqs} describe={describeSeedRequirement} onPick={fillFromSeed}
          hint="✎ From example — click to copy a filled requirement, then tweak it:" />
      )}
      {isEdit && <SeedAnchorHint entry={seed} describe={describeSeedRequirement} />}
      {isEdit
        ? <LockedRef value={ref} />
        : <Field label="ref (e.g. r_reach)">
            <input value={ref} onChange={e => setRef(e.target.value)} placeholder="r_reach" style={inputStyle} />
          </Field>
      }
      <Field label="by (actor)">
        {actors.length > 0
          ? <Select value={by} onChange={setBy} options={[{ value: '', label: '— select —' }, ...actorOpts]} />
          : <input value={by} onChange={e => setBy(e.target.value)} placeholder="a_robot" style={inputStyle} />
        }
      </Field>
      <Field label="KPI name">
        <input value={kpiName} onChange={e => setKpiName(e.target.value)} placeholder="reach" style={inputStyle} />
      </Field>
      <Field label="KPI expr (defaults to KPI name)">
        <input value={kpiExpr} onChange={e => setKpiExpr(e.target.value)} placeholder="arm_length" style={inputStyle} />
      </Field>
      <Field label="KPI unit">
        <input value={kpiUnit} onChange={e => setKpiUnit(e.target.value)} placeholder="mm" style={inputStyle} />
      </Field>
      <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-end' }}>
        <div style={{ flex: '0 0 60px' }}>
          <label style={labelStyle}>operator</label>
          <Select value={op} onChange={setOp} options={CRITERION_OPS} />
        </div>
        <Field label="threshold">
          <input value={val} onChange={e => setVal(e.target.value)} type="number" placeholder="400" style={inputStyle} />
        </Field>
      </div>
      <Field label="constrains (variable)">
        {variables.length > 0
          ? <Select value={constrains} onChange={setConst} options={[{ value: '', label: '— select —' }, ...varOpts]} />
          : <input value={constrains} onChange={e => setConst(e.target.value)} placeholder="v_reach" style={inputStyle} />
        }
      </Field>
      <Field label="negotiability">
        <Select value={neg} onChange={setNeg} options={NEGOTIABILITY} />
      </Field>
      <div style={{ fontSize: '9px', color: '#777', margin: '2px 0 1px' }}>
        Admissible interval — as you type it, the uncertainty band moves in 3D
      </div>
      <div style={{ display: 'flex', gap: '6px' }}>
        <Field label="admissible lo">
          <input value={admLo} onChange={e => setAdmLo(e.target.value)} type="number" placeholder="400" style={inputStyle} />
        </Field>
        <Field label="admissible hi">
          <input value={admHi} onChange={e => setAdmHi(e.target.value)} type="number" placeholder="800" style={inputStyle} />
        </Field>
      </div>
      {isEdit
        ? <EditorFooter onSave={submit} canSave={!!canSubmit} onCancel={onCancel} onRemove={onRemove} />
        : <button onClick={submit} style={btnStyle(true)} disabled={!canSubmit}>+ Add Requirement</button>
      }
    </div>
  )
}

// ── Entry summaries (the click-to-edit card faces) ──────────────────────────────

function ActorSummary({ a }) {
  return (
    <>
      <span style={{ color: '#5a9bf5' }}>{a.ref}</span>
      {' · '}<span style={{ color: '#aaa' }}>{a.role}</span>
      {a.discipline && <span style={{ color: '#777' }}> · {a.discipline}</span>}
    </>
  )
}

function VariableSummary({ v }) {
  return (
    <>
      <span style={{ color: '#5a9bf5' }}>{v.ref}</span>
      {' '}<span style={{ color: '#aaa' }}>∈ [{v.domain?.[0]}, {v.domain?.[1]}] {v.unit}</span>
    </>
  )
}

function RequirementSummary({ r }) {
  const iv = r.admissible?.interval
  return (
    <>
      <span style={{ color: '#5a9bf5' }}>{r.ref}</span>
      {r.kpi?.name && r.criterion && (
        <span style={{ color: '#aaa' }}> · {r.kpi.name} {r.criterion.op} {r.criterion.value}</span>
      )}
      {Array.isArray(iv) && <span style={{ color: '#777' }}> · [{iv[0]}, {iv[1]}]</span>}
      {r.by && <span style={{ color: '#666' }}> · {r.by}</span>}
    </>
  )
}

// ── NL intake (ADR-051 Phase 4 — unchanged) ─────────────────────────────────────

function NlIntakeForm({ onAddFacts }) {
  const [text, setText] = useState('')
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

  // Exactly one entry is editable at a time (composite key `${kind}:${ref}`),
  // and `flash` briefly tints the row that was just saved.
  const [editing, setEditing] = useState(null)
  const [flash, setFlash]     = useState(null)

  const actors       = ctx.actors       ?? []
  const variables    = ctx.variables    ?? []
  const requirements = ctx.requirements ?? []

  // ADR-058 — index the read-only seed (present only when forked from an example)
  // so both the create chips and the edit-mode anchor hint can read it by ref.
  const seedIndex = useMemo(() => buildSeedIndex(ctx.authorSeed), [ctx.authorSeed])
  const seedName  = ctx.authorSeed?.meta?.name

  function keyOf(kind, ref) { return `${kind}:${ref}` }
  function beginEdit(kind, ref) { setEditing(keyOf(kind, ref)) }
  function cancelEdit() { setEditing(null) }

  function onAdd(kind, data) {
    callbacks.onAddDocEntry?.(kind, data)
  }
  // Save = edit an existing entry in place, then flash + collapse (the "landed"
  // confirmation). The doc mutation is undoable (ContextController.editDocEntry);
  // the re-projection refreshes the cards through the store.
  function onSaveEdit(kind, data) {
    callbacks.onEditDocEntry?.(kind, data)
    setFlash(keyOf(kind, data.ref))
    setEditing(null)
  }
  function onRemove(kind, ref) {
    callbacks.onRemoveDocEntry?.(kind, ref)
    setEditing(null)
  }

  // Clear the save-flash after it has had time to fade.
  useEffect(() => {
    if (!flash) return
    const id = setTimeout(() => setFlash(null), 750)
    return () => clearTimeout(id)
  }, [flash])

  const reqCount = requirements.length

  return (
    <div style={{ paddingBottom: '8px' }}>
      {seedName && (
        <div style={{
          fontSize: '10px', color: '#d5a23a', marginBottom: '8px', lineHeight: 1.5,
          background: 'rgba(213,162,58,0.08)', border: '1px dashed #d5a23a44',
          borderRadius: '4px', padding: '5px 7px',
        }}>
          ✎ Forked from <b>{seedName}</b> — its filled values are kept as anchors. Tweak them into your own.
        </div>
      )}
      <div style={{ fontSize: '10px', color: '#666', marginBottom: '8px', lineHeight: 1.5 }}>
        Why-first — register actors and variables first, then requirements with KPI criteria.
        <br />
        <span style={{ color: '#5a9bf5' }}>Tip:</span> click any entry below to tweak it in place.
      </div>

      <Section title="Import from natural language" count={0} open={openNl} onToggle={() => setOpenNl(o => !o)}>
        <NlIntakeForm onAddFacts={facts => callbacks.onAddNlFacts?.(facts)} />
      </Section>

      <Section title="Actors" count={actors.length} open={openActor} onToggle={() => setOpenActor(o => !o)}>
        {actors.map(a => editing === keyOf('actor', a.ref) ? (
          <Reveal key={`edit-${a.ref}`}>
            <ActorForm
              mode="edit" initial={a}
              seedEntry={seedEntry(seedIndex, 'actor', a.ref)}
              onSubmit={d => onSaveEdit('actor', d)}
              onRemove={() => onRemove('actor', a.ref)}
              onCancel={cancelEdit}
            />
          </Reveal>
        ) : (
          <EntryCard key={a.ref} onEdit={() => beginEdit('actor', a.ref)} flash={flash === keyOf('actor', a.ref)}>
            <ActorSummary a={a} />
          </EntryCard>
        ))}
        {!isEditingKind(editing, 'actor') && (
          <div style={{ marginTop: actors.length ? '6px' : 0 }}>
            <ActorForm seedActors={seedIndex.actors} onSubmit={d => onAdd('actor', d)} />
          </div>
        )}
      </Section>

      <Section title="Variables" count={variables.length} open={openVar} onToggle={() => setOpenVar(o => !o)}>
        {variables.map(v => editing === keyOf('variable', v.ref) ? (
          <Reveal key={`edit-${v.ref}`}>
            <VariableForm
              mode="edit" initial={v}
              seedEntry={seedEntry(seedIndex, 'variable', v.ref)}
              onSubmit={d => onSaveEdit('variable', d)}
              onRemove={() => onRemove('variable', v.ref)}
              onCancel={cancelEdit}
            />
          </Reveal>
        ) : (
          <EntryCard key={v.ref} onEdit={() => beginEdit('variable', v.ref)} flash={flash === keyOf('variable', v.ref)}>
            <VariableSummary v={v} />
          </EntryCard>
        ))}
        {!isEditingKind(editing, 'variable') && (
          <div style={{ marginTop: variables.length ? '6px' : 0 }}>
            <VariableForm seedVariables={seedIndex.variables} onSubmit={d => onAdd('variable', d)} />
          </div>
        )}
      </Section>

      <Section title="Requirements" count={reqCount} open={openReq} onToggle={() => setOpenReq(o => !o)}>
        {requirements.map(r => {
          // Region requirements are edited by the 3-D widgets in Author mode — this
          // interval form can't represent a region, so show them read-only + a hint
          // (honest, PHILOSOPHY #11) instead of a lossy edit.
          const isRegion = !!r.admissible?.region && !Array.isArray(r.admissible?.interval)
          if (editing === keyOf('requirement', r.ref) && !isRegion) {
            return (
              <Reveal key={`edit-${r.ref}`}>
                <RequirementForm
                  mode="edit" initial={r} actors={actors} variables={variables}
                  seedEntry={seedEntry(seedIndex, 'requirement', r.ref)}
                  onSubmit={d => onSaveEdit('requirement', d)}
                  onRemove={() => onRemove('requirement', r.ref)}
                  onCancel={cancelEdit}
                  onPreview={spec => callbacks.onIntakePreview?.(spec)}
                />
              </Reveal>
            )
          }
          return (
            <EntryCard
              key={r.ref}
              editable={!isRegion}
              onEdit={() => beginEdit('requirement', r.ref)}
              flash={flash === keyOf('requirement', r.ref)}
              badge={isRegion ? (
                <span style={{ fontSize: '8px', color: '#888', border: '1px solid #444', borderRadius: '6px', padding: '0 4px', flexShrink: 0 }}
                  title="Edit this region in Author mode">region</span>
              ) : null}
            >
              <RequirementSummary r={r} />
            </EntryCard>
          )
        })}
        {!isEditingKind(editing, 'requirement') && (
          <div style={{ marginTop: requirements.length ? '6px' : 0 }}>
            <RequirementForm
              actors={actors}
              variables={variables}
              seedReqs={seedIndex.requirements}
              onSubmit={d => onAdd('requirement', d)}
              onPreview={spec => callbacks.onIntakePreview?.(spec)}
            />
          </div>
        )}
      </Section>
    </div>
  )
}

/** True when the currently-edited key belongs to `kind` (hides that section's add form). */
function isEditingKind(editing, kind) {
  return typeof editing === 'string' && editing.startsWith(`${kind}:`)
}
