import { useState, useEffect, useMemo, useRef } from 'react'
import { useUIStore } from '../../store/uiStore.js'
import { extractFacts } from '../../context/NlIntake.js'
import {
  buildSeedIndex,
  seedEntry,
  describeSeedRequirement,
  describeSeedActor,
  describeSeedVariable,
} from '../../context/SeedAnchor.js'
import {
  isInterval,
  refStatus,
  suggestRef,
  matchesSeed,
  actorGaps,
  variableGaps,
  requirementGaps,
  kpiCatalogChips,
  kpiCardLines,
  seedCardLines,
} from '../../context/IntakeAssist.js'
import { instantiateKpiExpr } from '../../context/RoleKpiCatalog.js'
import {
  ROLES,
  DISCIPLINES,
  CRITERION_OPS,
  NEGOTIABILITY,
  UNITS,
} from '../../context/IntakeVocabulary.js'

/**
 * IntakePanel — direct entry addition UI for blank-doc authoring (ADR-051 Phase 1).
 *
 * Shown as an 'intake' tab in ContextLayer when mode === 'negotiate'. Provides
 * compact forms to add Actors, Variables, and Requirements directly to the
 * canonical doc (Why-first: actors → variables → requirements — ADR-051 §2.0).
 *
 * Each submission fires `onAddDocEntry(type, data)` which ContextController
 * translates into a DocBuilder call + AddDocEntryCommand push (undoable).
 *
 * ADR-058 "UX 具体化": everything playful in here (seed flood flash, seed-diff
 * tint, ref suggestions, dual-handle admissible slider, KPI catalog chips,
 * Why-first trail) is client-side derivation via the pure IntakeAssist module.
 * None of it writes the doc — the commit boundary stays the single
 * `onAddDocEntry` path (§B-3), and every live check calls the validator's own
 * predicates (§B-2), so peeling this layer off never changes doc semantics.
 */

// Selection vocabularies come from the pure IntakeVocabulary module (ADR-063
// Phase 2 — one source; the schema enums and the KPI catalog feed it). The
// leading '' keeps discipline optional in the actor form.
const DISCIPLINE_OPTIONS = ['', ...DISCIPLINES]
/** Shared datalist id: unit fields suggest, never restrict (expert escape hatch). */
const UNIT_LIST_ID = 'ea-unit-suggestions'

const inputStyle = {
  background: '#1a1a1a', border: '1px solid #444', borderRadius: '3px',
  color: '#e0e0e0', padding: '3px 6px', fontSize: '11px', width: '100%',
  fontFamily: 'system-ui, -apple-system, sans-serif', boxSizing: 'border-box',
}

// Seed-diff tint (ADR-058 §A-2): a field still holding the flooded example
// value keeps a faint dashed amber underline; overriding it drops back to the
// normal style — visible progress of "making the example yours".
const seedTint = {
  borderBottom: '1px dashed #d5a23a',
  background: 'rgba(213,162,58,0.05)',
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

// Keyframes + dual-range thumb styling (inline styles cannot express either).
const INTAKE_CSS = `
@keyframes eaIntakeFlash {
  0%   { background: rgba(213,162,58,0.30); }
  100% { background: transparent; }
}
@keyframes eaBadgePulse {
  0%   { transform: scale(1.5); }
  100% { transform: scale(1); }
}
.ea-dual-range {
  -webkit-appearance: none; appearance: none;
  position: absolute; left: 0; right: 0; top: 0; width: 100%; height: 100%;
  margin: 0; background: transparent; pointer-events: none;
}
.ea-dual-range::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none; pointer-events: auto;
  width: 12px; height: 12px; border-radius: 50%;
  background: #3a7bd5; border: 1px solid #9cc0f0; cursor: pointer;
}
.ea-dual-range::-moz-range-thumb {
  pointer-events: auto; width: 11px; height: 11px; border-radius: 50%;
  background: #3a7bd5; border: 1px solid #9cc0f0; cursor: pointer;
}
.ea-dual-range::-moz-range-track { background: transparent; }
`

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: '5px' }}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  )
}

function Select({ value, onChange, options, style }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      style={{ ...inputStyle, padding: '2px 4px', ...style }}>
      {options.map(o => typeof o === 'string'
        ? <option key={o} value={o}>{o || '—'}</option>
        : <option key={o.value} value={o.value}>{o.label}</option>
      )}
    </select>
  )
}

// ── Ref field with live uniqueness + free-number suggestion (ADR-058 §A-3) ─────

// The check is informative, never blocking (play side); the commit boundary is
// what enforces. Status and suggestion come from the pure IntakeAssist helpers.
function RefField({ label, value, onChange, placeholder, existingRefs, tint, onEnter }) {
  const status = refStatus(existingRefs, value)
  const suggestion = status === 'taken' ? suggestRef(existingRefs, value) : null
  return (
    <div style={{ marginBottom: '5px' }}>
      <label style={labelStyle}>{label}</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
        <input value={value} onChange={e => onChange(e.target.value)}
          placeholder={placeholder} style={{ ...inputStyle, ...(tint ? seedTint : {}) }}
          onKeyDown={e => e.key === 'Enter' && onEnter?.()} />
        {status === 'free'  && <span style={{ color: '#22C55E', fontSize: '11px' }} title="ref is unused">✓</span>}
        {status === 'taken' && <span style={{ color: '#e05555', fontSize: '11px' }} title="ref already exists in the document">●</span>}
      </div>
      {suggestion && (
        <button onClick={() => onChange(suggestion)} style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: '#5a9bf5', fontSize: '10px', padding: '1px 0',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}>
          → use free ref “{suggestion}”
        </button>
      )}
    </div>
  )
}

// ── Missing-reason line (ADR-058 §B-1: no silent disabled) ─────────────────────

// Prints the same gap list that disables the submit button — one predicate,
// two projections (PHILOSOPHY #11: a grey button with no reason is a silent no-op).
function GapNote({ gaps }) {
  if (gaps.length === 0) return null
  return (
    <div style={{ fontSize: '9px', color: '#c99a3a', margin: '3px 0 4px', lineHeight: 1.4 }}>
      ⚠ {gaps.join(' · ')}
    </div>
  )
}

// ── Seed chips (ADR-058 fork & tweak) ───────────────────────────────────────────

// Renders the read-only seed entries of one kind as dashed amber chips. Clicking a
// chip floods the form with that example entry's real values (an editable anchor —
// the filled example IS the explanation of "what to put here"). Hovering pops a
// mini-card with all the entry's filled values so examples can be browsed BEFORE
// picking (ADR-058 §A-1). Shared by the actor, variable, and requirement forms.
function SeedChips({ kind, entries, describe, onPick, hint }) {
  const [hovered, setHovered] = useState(null)
  if (!entries || entries.length === 0) return null
  const cardLines = hovered ? seedCardLines(kind, hovered) : []
  return (
    <div style={{ marginBottom: '7px', position: 'relative' }}>
      <div style={{ fontSize: '9px', color: '#777', marginBottom: '3px' }}>{hint}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
        {entries.map(e => (
          <button
            key={e.ref}
            onClick={() => { setHovered(null); onPick(e) }}
            onMouseEnter={() => setHovered(e)}
            onMouseLeave={() => setHovered(h => (h === e ? null : h))}
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
      {hovered && cardLines.length > 0 && (
        <div style={{
          position: 'absolute', left: 0, right: 0, top: '100%', zIndex: 20,
          background: '#242018', border: '1px dashed #d5a23a66', borderRadius: '4px',
          padding: '6px 8px', marginTop: '3px', pointerEvents: 'none',
          boxShadow: '0 4px 10px rgba(0,0,0,0.5)',
        }}>
          {cardLines.map(l => (
            <div key={l.label} style={{ fontSize: '9px', lineHeight: 1.6 }}>
              <span style={{ color: '#8a7440' }}>{l.label}</span>
              <span style={{ color: '#d8c9a0', marginLeft: '6px' }}>{l.value}</span>
            </div>
          ))}
          <div style={{ fontSize: '8px', color: '#776a4a', marginTop: '2px' }}>
            click to flood the form with these values
          </div>
        </div>
      )}
    </div>
  )
}

// ── KPI expression asset chips (ADR-063 Phase 1) ───────────────────────────────

// The recognition-over-recall answer to "KPI がすぐには思い付かない": each chip is
// a curated, ready-to-use expression asset from RoleKpiCatalog (role-kpi/2.0).
// Clicking fills name/unit/expr/op — the user tweaks only the parameters.
// Hovering pops a mini-card (pure kpiCardLines) listing what the pick fills and
// which parameters stay theirs, so assets can be browsed BEFORE picking.
function KpiAssetChips({ chips, onPick }) {
  const [hovered, setHovered] = useState(null)
  if (!chips || chips.length === 0) return null
  const cardLines = hovered ? kpiCardLines(hovered) : []
  return (
    <div style={{ margin: '2px 0 5px', position: 'relative' }}>
      <div style={{ fontSize: '9px', color: '#777', marginBottom: '3px' }}>
        KPI catalog — pick a ready expression, then tweak its parameters:
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
        {chips.map(c => (
          <button key={`${c.discipline}:${c.name}`}
            onClick={() => { setHovered(null); onPick(c) }}
            onMouseEnter={() => setHovered(c)}
            onMouseLeave={() => setHovered(h => (h === c ? null : h))}
            style={{
              cursor: 'pointer', background: 'rgba(90,155,245,0.08)',
              border: '1px solid #5a9bf544', borderRadius: '10px',
              color: '#8ab4f0', padding: '2px 8px', fontSize: '9px',
              fontFamily: 'system-ui, -apple-system, sans-serif',
            }}>
            {c.discipline} · {c.name}
          </button>
        ))}
      </div>
      {hovered && cardLines.length > 0 && (
        <div style={{
          position: 'absolute', left: 0, right: 0, top: '100%', zIndex: 20,
          background: '#181e2a', border: '1px solid #5a9bf566', borderRadius: '4px',
          padding: '6px 8px', marginTop: '3px', pointerEvents: 'none',
          boxShadow: '0 4px 10px rgba(0,0,0,0.5)',
        }}>
          {cardLines.map(l => (
            <div key={l.label} style={{ fontSize: '9px', lineHeight: 1.6 }}>
              <span style={{ color: '#4a6a9a', whiteSpace: 'nowrap' }}>{l.label}</span>
              <span style={{ color: '#a9c4ea', marginLeft: '6px' }}>{l.value}</span>
            </div>
          ))}
          <div style={{ fontSize: '8px', color: '#4a5a72', marginTop: '2px' }}>
            click to fill KPI name / unit / expr — parameters stay yours to tweak
          </div>
        </div>
      )}
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
          // key={count} remounts the badge on every change so the pulse
          // animation replays — a new entry is felt, not just re-read (§A-5).
          <span key={count} style={{
            background: '#2a4a2a', color: '#22C55E', borderRadius: '7px',
            padding: '0 5px', fontSize: '9px', marginLeft: 'auto',
            animation: 'eaBadgePulse 450ms ease-out',
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

// ── Why-first trail (ADR-058 §A-5) ─────────────────────────────────────────────

// Replaces the static intro sentence with a 3-step progress trail derived
// entirely from doc contents (counts) — no state of its own.
function WhyTrail({ actorCount, varCount, reqCount }) {
  const steps = [
    { label: 'actors', n: actorCount },
    { label: 'variables', n: varCount },
    { label: 'requirements', n: reqCount },
  ]
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '8px' }}>
      {steps.map((s, i) => (
        <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {i > 0 && <span style={{ color: '#555', fontSize: '10px' }}>→</span>}
          <span style={{
            fontSize: '10px',
            color: s.n > 0 ? '#22C55E' : '#777',
            border: `1px solid ${s.n > 0 ? '#22C55E44' : '#3a3a3a'}`,
            borderRadius: '9px', padding: '1px 7px',
          }}>
            {s.n > 0 ? '✓ ' : `${i + 1}. `}{s.label}{s.n > 0 ? ` (${s.n})` : ''}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Dual-handle admissible slider (ADR-058 §A-4) ───────────────────────────────

// Rendered only when the constrained variable's domain is a valid interval
// (checked via the validator's own isInterval). Writes the SAME admLo/admHi
// state as the numeric inputs (no second source); the existing onPreview effect
// then drives the 3D uncertainty band — stroking the slider moves the band live.
function DualRange({ domain, lo, hi, onLo, onHi }) {
  const [dLo, dHi] = domain
  const span = dHi - dLo
  const loN = isNaN(parseFloat(lo)) ? dLo : Math.min(Math.max(parseFloat(lo), dLo), dHi)
  const hiN = isNaN(parseFloat(hi)) ? dHi : Math.min(Math.max(parseFloat(hi), dLo), dHi)
  const pct = v => ((v - dLo) / span) * 100
  const step = span / 200
  return (
    <div style={{ margin: '2px 0 6px' }}>
      <div style={{ position: 'relative', height: '18px' }}>
        <div style={{
          position: 'absolute', left: 0, right: 0, top: '7px', height: '4px',
          background: '#333', borderRadius: '2px',
        }} />
        <div style={{
          position: 'absolute', top: '7px', height: '4px', borderRadius: '2px',
          left: `${pct(Math.min(loN, hiN))}%`, width: `${Math.abs(pct(hiN) - pct(loN))}%`,
          background: 'rgba(58,123,213,0.65)',
        }} />
        <input type="range" className="ea-dual-range" min={dLo} max={dHi} step={step}
          value={loN} onChange={e => onLo(e.target.value)} aria-label="admissible lo" />
        <input type="range" className="ea-dual-range" min={dLo} max={dHi} step={step}
          value={hiN} onChange={e => onHi(e.target.value)} aria-label="admissible hi" />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '8px', color: '#666' }}>
        <span>{dLo}</span>
        <span>variable domain</span>
        <span>{dHi}</span>
      </div>
    </div>
  )
}

// ── In-place editing scaffolding (ADR-058 Phase 2) ──────────────────────────────

// Fades + slides its children in on mount — gives the inline editor a gentle
// "unfold" when an existing-entry card is clicked open (soft, not a hard pop).
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
// affordance so the read-only list visibly becomes editable. `flash` replays the
// same eaIntakeFlash animation the add form uses, as the "landed" confirmation.
function EntryCard({ children, onEdit, flash, badge, editable = true }) {
  const [hover, setHover] = useState(false)
  return (
    <div
      onClick={editable ? onEdit : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px',
        padding: '5px 7px', marginBottom: '4px', borderRadius: '5px',
        cursor: editable ? 'pointer' : 'default',
        border: `1px solid ${hover && editable ? '#3a5a8a' : '#2e2e2e'}`,
        background: hover && editable ? 'rgba(90,155,245,0.09)' : 'rgba(255,255,255,0.02)',
        transition: 'border-color 0.15s ease, background 0.15s ease',
        ...(flash ? { animation: 'eaIntakeFlash 700ms ease-out' } : {}),
      }}
    >
      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{children}</div>
      {badge}
      {editable && (
        <span style={{ color: hover ? '#5a9bf5' : '#4a4a4a', fontSize: '11px', flexShrink: 0 }}>✎</span>
      )}
    </div>
  )
}

// Ref shown but locked in edit mode — ref is identity; renaming would orphan
// referencing by/constrains, so a rename is remove + re-add, not an edit.
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

// The example's original value for a forked entry, shown as a faint anchor while
// editing (ADR-058 §3.2 seed ghost) — reinforces "tweak the example into yours".
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

// Save / Cancel / Remove footer shown in edit mode instead of the "+ Add" button.
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

// Compact summaries shown on the click-to-edit cards.
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

/** True when the currently-edited key belongs to `kind` (hides that section's add form). */
function isEditingKind(editing, kind) {
  return typeof editing === 'string' && editing.startsWith(`${kind}:`)
}

// ── Actor form (dual mode: create | edit) ───────────────────────────────────────

function ActorForm({ mode = 'create', initial = null, actors, seedActors = [], seedEntry = null, onAdd, onSave, onRemove, onCancel }) {
  const isEdit = mode === 'edit'
  const [ref, setRef]    = useState(initial?.ref ?? '')
  const [role, setRole]  = useState(initial?.role ?? 'developer')
  const [disc, setDisc]  = useState(initial?.discipline ?? '')
  // §A-2: snapshot of what the last-picked seed chip flooded in (null = no seed
  // picked); drives the per-field tint. flashTick remounts the field block so
  // the flood flash animation replays.
  const [seedFill, setSeedFill] = useState(null)
  const [flashTick, setFlashTick] = useState(0)

  const existingRefs = actors.map(a => a.ref)
  const gaps = actorGaps({ ref })

  // ADR-058 Phase 2: copy a filled example actor, then tweak it. The ref is
  // suffixed `_copy` because the forked working doc already contains the seed ref.
  function fillFromSeed(a) {
    const fill = { ref: (a.ref ?? '') + '_copy', role: a.role ?? 'developer', disc: a.discipline ?? '' }
    setRef(fill.ref); setRole(fill.role); setDisc(fill.disc)
    setSeedFill(fill); setFlashTick(t => t + 1)
  }

  function submit() {
    if (gaps.length > 0) return
    if (isEdit) {
      const next = { ...initial, ref: ref.trim(), role }
      if (disc) next.discipline = disc; else delete next.discipline
      onSave(next)
      return
    }
    onAdd({ ref: ref.trim(), role, ...(disc ? { discipline: disc } : {}) })
    setRef(''); setDisc(''); setSeedFill(null)
  }

  return (
    <div>
      {!isEdit && (
        <SeedChips
          kind="actor"
          entries={seedActors}
          describe={describeSeedActor}
          onPick={fillFromSeed}
          hint="✎ From example — click to copy an actor, then tweak it:"
        />
      )}
      {isEdit && <SeedAnchorHint entry={seedEntry} describe={describeSeedActor} />}
      <div key={flashTick} style={flashTick > 0 ? { animation: 'eaIntakeFlash 700ms ease-out' } : undefined}>
        {isEdit
          ? <LockedRef value={ref} />
          : <RefField label="ref (e.g. a_robot)" value={ref} onChange={setRef}
              placeholder="a_robot" existingRefs={existingRefs}
              tint={matchesSeed(seedFill?.ref, ref)} onEnter={submit} />
        }
        <Field label="role">
          <Select value={role} onChange={setRole} options={ROLES}
            style={matchesSeed(seedFill?.role, role) ? seedTint : undefined} />
        </Field>
        <Field label="discipline (optional)">
          <Select value={disc} onChange={setDisc} options={DISCIPLINE_OPTIONS}
            style={matchesSeed(seedFill?.disc, disc) ? seedTint : undefined} />
        </Field>
      </div>
      <GapNote gaps={gaps} />
      {isEdit
        ? <EditorFooter onSave={submit} canSave={gaps.length === 0} onCancel={onCancel} onRemove={onRemove} />
        : <button onClick={submit} style={btnStyle(true)} disabled={gaps.length > 0}>+ Add Actor</button>
      }
    </div>
  )
}

// ── Variable form ──────────────────────────────────────────────────────────────

function VariableForm({ mode = 'create', initial = null, variables, seedVariables = [], seedEntry = null, onAdd, onSave, onRemove, onCancel }) {
  const isEdit = mode === 'edit'
  const [ref, setRef]   = useState(initial?.ref ?? '')
  const [unit, setUnit] = useState(initial?.unit ?? 'mm')
  const [lo, setLo]     = useState(Array.isArray(initial?.domain) ? String(initial.domain[0]) : '')
  const [hi, setHi]     = useState(Array.isArray(initial?.domain) ? String(initial.domain[1]) : '')
  const [desc, setDesc] = useState(initial?.description ?? '')
  const [seedFill, setSeedFill] = useState(null)
  const [flashTick, setFlashTick] = useState(0)

  const existingRefs = variables.map(v => v.ref)
  const gaps = variableGaps({ ref, unit, lo, hi })

  // ADR-058 Phase 2: copy a filled example variable, then tweak it. The ref is
  // suffixed `_copy` because the forked working doc already contains the seed ref.
  function fillFromSeed(v) {
    const fill = {
      ref:  (v.ref ?? '') + '_copy',
      unit: v.unit ?? 'mm',
      lo:   Array.isArray(v.domain) ? String(v.domain[0]) : '',
      hi:   Array.isArray(v.domain) ? String(v.domain[1]) : '',
      desc: v.description ?? '',
    }
    setRef(fill.ref); setUnit(fill.unit); setLo(fill.lo); setHi(fill.hi); setDesc(fill.desc)
    setSeedFill(fill); setFlashTick(t => t + 1)
  }

  function submit() {
    if (gaps.length > 0) return
    if (isEdit) {
      const next = { ...initial, ref: ref.trim(), unit: unit.trim(), domain: [parseFloat(lo), parseFloat(hi)] }
      if (desc.trim()) next.description = desc.trim(); else delete next.description
      onSave(next)
      return
    }
    onAdd({
      ref: ref.trim(), unit: unit.trim(), domain: [parseFloat(lo), parseFloat(hi)],
      ...(desc.trim() ? { description: desc.trim() } : {}),
    })
    setRef(''); setLo(''); setHi(''); setDesc(''); setSeedFill(null)
  }

  const tintOf = (k, v) => (matchesSeed(seedFill?.[k], v) ? seedTint : {})

  return (
    <div>
      {!isEdit && (
        <SeedChips
          kind="variable"
          entries={seedVariables}
          describe={describeSeedVariable}
          onPick={fillFromSeed}
          hint="✎ From example — click to copy a variable, then tweak it:"
        />
      )}
      {isEdit && <SeedAnchorHint entry={seedEntry} describe={describeSeedVariable} />}
      <div key={flashTick} style={flashTick > 0 ? { animation: 'eaIntakeFlash 700ms ease-out' } : undefined}>
        {isEdit
          ? <LockedRef value={ref} />
          : <RefField label="ref (e.g. v_reach)" value={ref} onChange={setRef}
              placeholder="v_reach" existingRefs={existingRefs}
              tint={matchesSeed(seedFill?.ref, ref)} onEnter={submit} />
        }
        <Field label="unit">
          <input value={unit} onChange={e => setUnit(e.target.value)} list={UNIT_LIST_ID}
            placeholder="mm" style={{ ...inputStyle, ...tintOf('unit', unit) }} />
        </Field>
        <div style={{ display: 'flex', gap: '6px' }}>
          <Field label="domain lo">
            <input value={lo} onChange={e => setLo(e.target.value)}
              placeholder="0" type="number" style={{ ...inputStyle, ...tintOf('lo', lo) }} />
          </Field>
          <Field label="domain hi">
            <input value={hi} onChange={e => setHi(e.target.value)}
              placeholder="1000" type="number" style={{ ...inputStyle, ...tintOf('hi', hi) }} />
          </Field>
        </div>
        <Field label="description (optional)">
          <input value={desc} onChange={e => setDesc(e.target.value)}
            placeholder="description" style={{ ...inputStyle, ...tintOf('desc', desc) }} />
        </Field>
      </div>
      <GapNote gaps={gaps} />
      {isEdit
        ? <EditorFooter onSave={submit} canSave={gaps.length === 0} onCancel={onCancel} onRemove={onRemove} />
        : <button onClick={submit} style={btnStyle(true)} disabled={gaps.length > 0}>+ Add Variable</button>
      }
    </div>
  )
}

// ── Requirement form ───────────────────────────────────────────────────────────

function RequirementForm({ mode = 'create', initial = null, actors, variables, requirements = [], seedReqs = [], seedEntry = null, onAdd, onSave, onRemove, onCancel, onPreview }) {
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
  const [seedFill, setSeedFill] = useState(null)
  const [flashTick, setFlashTick] = useState(0)

  const existingRefs = requirements.map(r => r.ref)
  const gaps = requirementGaps({ ref, by, kpiName, kpiExpr, constrains, val, admLo, admHi })

  // ADR-063 Phase 1: pick a curated KPI expression asset, then tweak only its
  // parameters. The chip fills name/unit/expr/op from the catalog (single
  // source); `pickedKpi` remembers the asset so a later variable selection can
  // finish a still-pristine `{var}` placeholder for the user.
  const [pickedKpi, setPickedKpi] = useState(null)
  function fillFromKpiAsset(chip) {
    setKpiName(chip.name)
    if (chip.unit) setKpiUnit(chip.unit)
    if (chip.exprTemplate) setKpiExpr(instantiateKpiExpr(chip, constrains))
    if (chip.suggestedOp) setOp(chip.suggestedOp)
    setPickedKpi(chip.exprTemplate ? chip : null)
  }
  // Re-instantiate `{var}` when the constrained variable changes while the expr
  // is still exactly the pristine instantiation for the previous selection —
  // the user's own edits are never rewritten (same ownership rule as seed tint).
  const prevConstrains = useRef(constrains)
  useEffect(() => {
    const prev = prevConstrains.current
    prevConstrains.current = constrains
    if (!pickedKpi || prev === constrains) return
    if (kpiExpr === instantiateKpiExpr(pickedKpi, prev)) {
      setKpiExpr(instantiateKpiExpr(pickedKpi, constrains))
    }
  }, [constrains])

  // ADR-058 fork & tweak: pre-fill every field from a seed example requirement so
  // the user tweaks real values instead of facing a blank schema. The ref is
  // suffixed `_copy` because the forked working doc already contains the seed ref —
  // the user renames it. Values become editable anchors (the filled example IS the
  // explanation of "what to put here").
  function fillFromSeed(req) {
    const iv = req.admissible?.interval
    const fill = {
      ref:     (req.ref ?? '') + '_copy',
      by:      req.by ?? '',
      kpiName: req.kpi?.name ?? '',
      kpiExpr: req.kpi?.expr ?? '',
      kpiUnit: req.kpi?.unit ?? '',
      op:      req.criterion?.op ?? '>=',
      val:     req.criterion?.value != null ? String(req.criterion.value) : '',
      const:   req.constrains?.[0] ?? '',
      neg:     req.negotiability ?? 'must',
      admLo:   Array.isArray(iv) ? String(iv[0]) : '',
      admHi:   Array.isArray(iv) ? String(iv[1]) : '',
    }
    setRef(fill.ref); setBy(fill.by); setKpiName(fill.kpiName); setKpiExpr(fill.kpiExpr)
    setKpiUnit(fill.kpiUnit); setOp(fill.op); setVal(fill.val); setConst(fill.const)
    setNeg(fill.neg); setAdmLo(fill.admLo); setAdmHi(fill.admHi)
    setSeedFill(fill); setPickedKpi(null); setFlashTick(t => t + 1)
  }

  // Live 3D uncertainty-band preview driven by the admissible interval inputs
  // (ADR-051 Phase 3 — Entry D). Fires as [lo, hi] change; cleared on unmount
  // (tab switch / section collapse) and after a successful submit.
  const constVar = variables.find(v => v.ref === constrains)
  const admUnit = constVar?.unit ?? kpiUnit
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
    if (gaps.length > 0) return
    onPreview?.(null)
    const managed = {
      ref: ref.trim(),
      by:  by.trim(),
      kpi: { name: kpiName.trim(), expr: kpiExpr.trim() || kpiName.trim(), unit: kpiUnit.trim() },
      criterion: { op, value: parseFloat(val) },
      constrains: [constrains.trim()],
      negotiability: neg,
    }
    if (isEdit) {
      // Spread `initial` first so unmanaged fields (evidence, note, source…) survive
      // the edit — the form manages only the fields it shows (PHILOSOPHY #6 / #11).
      onSave({
        ...initial,
        ...managed,
        admissible: { source: 'stated', ...(initial?.admissible ?? {}), interval: [parseFloat(admLo), parseFloat(admHi)] },
      })
      return
    }
    onAdd({
      ...managed,
      admissible: { interval: [parseFloat(admLo), parseFloat(admHi)], source: 'stated' },
      evidence: [],
    })
    setRef(''); setBy(actors[0]?.ref ?? ''); setKpiName(''); setKpiExpr('')
    setKpiUnit(''); setVal(''); setConst(variables[0]?.ref ?? '')
    setAdmLo(''); setAdmHi(''); setSeedFill(null); setPickedKpi(null)
  }

  const actorOpts = actors.map(a => ({ value: a.ref, label: a.ref }))
  const varOpts   = variables.map(v => ({ value: v.ref, label: `${v.ref} (${v.unit})` }))
  const tintOf = (k, v) => (matchesSeed(seedFill?.[k], v) ? seedTint : {})
  // §A-6: KPI catalog chips — RoleKpiCatalog stays the source of truth; a chip
  // fills the KPI name only (the catalog carries no units/exprs — none invented).
  const kpiChips = useMemo(() => kpiCatalogChips(), [])

  return (
    <div>
      {!isEdit && (
        <SeedChips
          kind="requirement"
          entries={seedReqs}
          describe={describeSeedRequirement}
          onPick={fillFromSeed}
          hint="✎ From example — click to copy a filled requirement, then tweak it:"
        />
      )}
      {isEdit && <SeedAnchorHint entry={seedEntry} describe={describeSeedRequirement} />}
      <div key={flashTick} style={flashTick > 0 ? { animation: 'eaIntakeFlash 700ms ease-out' } : undefined}>
        {isEdit
          ? <LockedRef value={ref} />
          : <RefField label="ref (e.g. r_reach)" value={ref} onChange={setRef}
              placeholder="r_reach" existingRefs={existingRefs}
              tint={matchesSeed(seedFill?.ref, ref)} />
        }
        <Field label="by (actor)">
          {actors.length > 0
            ? <Select value={by} onChange={setBy}
                options={[{ value: '', label: '— select —' }, ...actorOpts]}
                style={tintOf('by', by)} />
            : <input value={by} onChange={e => setBy(e.target.value)}
                placeholder="a_robot" style={{ ...inputStyle, ...tintOf('by', by) }} />
          }
        </Field>
        <KpiAssetChips chips={kpiChips} onPick={fillFromKpiAsset} />
        <Field label="KPI name">
          <input value={kpiName} onChange={e => setKpiName(e.target.value)}
            placeholder="reach" style={{ ...inputStyle, ...tintOf('kpiName', kpiName) }} />
        </Field>
        <Field label="KPI expr (defaults to KPI name)">
          <input value={kpiExpr} onChange={e => setKpiExpr(e.target.value)}
            placeholder="arm_length" style={{ ...inputStyle, ...tintOf('kpiExpr', kpiExpr) }} />
        </Field>
        <Field label="KPI unit">
          <input value={kpiUnit} onChange={e => setKpiUnit(e.target.value)} list={UNIT_LIST_ID}
            placeholder="mm" style={{ ...inputStyle, ...tintOf('kpiUnit', kpiUnit) }} />
        </Field>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-end' }}>
          <div style={{ flex: '0 0 60px' }}>
            <label style={labelStyle}>operator</label>
            <Select value={op} onChange={setOp} options={CRITERION_OPS}
              style={tintOf('op', op)} />
          </div>
          <Field label="threshold">
            <input value={val} onChange={e => setVal(e.target.value)}
              type="number" placeholder="400" style={{ ...inputStyle, ...tintOf('val', val) }} />
          </Field>
        </div>
        <Field label="constrains (variable)">
          {variables.length > 0
            ? <Select value={constrains} onChange={setConst}
                options={[{ value: '', label: '— select —' }, ...varOpts]}
                style={tintOf('const', constrains)} />
            : <input value={constrains} onChange={e => setConst(e.target.value)}
                placeholder="v_reach" style={{ ...inputStyle, ...tintOf('const', constrains) }} />
          }
        </Field>
        <Field label="negotiability">
          <Select value={neg} onChange={setNeg} options={NEGOTIABILITY}
            style={tintOf('neg', neg)} />
        </Field>
        <div style={{ fontSize: '9px', color: '#777', margin: '2px 0 1px' }}>
          Admissible interval — stroke the slider and the 3D uncertainty band follows live
        </div>
        {constVar && isInterval(constVar.domain) && (
          <DualRange domain={constVar.domain} lo={admLo} hi={admHi}
            onLo={setAdmLo} onHi={setAdmHi} />
        )}
        <div style={{ display: 'flex', gap: '6px' }}>
          <Field label="admissible lo">
            <input value={admLo} onChange={e => setAdmLo(e.target.value)}
              type="number" placeholder="400" style={{ ...inputStyle, ...tintOf('admLo', admLo) }} />
          </Field>
          <Field label="admissible hi">
            <input value={admHi} onChange={e => setAdmHi(e.target.value)}
              type="number" placeholder="800" style={{ ...inputStyle, ...tintOf('admHi', admHi) }} />
          </Field>
        </div>
      </div>
      <GapNote gaps={gaps} />
      {isEdit
        ? <EditorFooter onSave={submit} canSave={gaps.length === 0} onCancel={onCancel} onRemove={onRemove} />
        : <button onClick={submit} style={btnStyle(true)} disabled={gaps.length > 0}>+ Add Requirement</button>
      }
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

  // In-place editing (ADR-058 Phase 2): exactly one entry is editable at a time
  // (composite key `${kind}:${ref}`); `flash` replays the save-landed animation.
  const [editing, setEditing] = useState(null)
  const [flash, setFlash]     = useState(null)

  const actors       = ctx.actors       ?? []
  const variables    = ctx.variables    ?? []
  const requirements = ctx.requirements ?? []

  // ADR-058 — when the project was forked from an example, index the read-only
  // seed so the forms can offer / anchor its filled values.
  const seedIndex = useMemo(() => buildSeedIndex(ctx.authorSeed), [ctx.authorSeed])
  const seedName  = ctx.authorSeed?.meta?.name

  const keyOf = (kind, ref) => `${kind}:${ref}`
  const beginEdit = (kind, ref) => setEditing(keyOf(kind, ref))
  const cancelEdit = () => setEditing(null)

  function onAdd(type, data) {
    callbacks.onAddDocEntry?.(type, data)
  }
  // Save = edit an existing entry in place, then flash + collapse. Undoable via
  // ContextController.editDocEntry; re-projection refreshes the cards.
  function onSaveEdit(kind, data) {
    callbacks.onEditDocEntry?.(kind, data)
    setFlash(keyOf(kind, data.ref))
    setEditing(null)
  }
  function onRemove(kind, ref) {
    callbacks.onRemoveDocEntry?.(kind, ref)
    setEditing(null)
  }

  // Clear the save-flash after the animation has had time to play.
  useEffect(() => {
    if (!flash) return
    const id = setTimeout(() => setFlash(null), 800)
    return () => clearTimeout(id)
  }, [flash])

  return (
    <div style={{ paddingBottom: '8px' }}>
      <style>{INTAKE_CSS}</style>
      {/* Shared unit suggestions (ADR-063 Phase 2): every unit field offers the
          vocabulary as a datalist — suggestions, never a straitjacket. */}
      <datalist id={UNIT_LIST_ID}>
        {UNITS.map(u => <option key={u} value={u} />)}
      </datalist>
      {seedName && (
        <div style={{
          fontSize: '10px', color: '#d5a23a', marginBottom: '8px', lineHeight: 1.5,
          background: 'rgba(213,162,58,0.08)', border: '1px dashed #d5a23a44',
          borderRadius: '4px', padding: '5px 7px',
        }}>
          ✎ Forked from <b>{seedName}</b> — its filled values are kept as anchors below. Tweak them into your own.
        </div>
      )}
      <WhyTrail actorCount={actors.length} varCount={variables.length} reqCount={requirements.length} />
      <div style={{ fontSize: '9px', color: '#5a9bf5', marginBottom: '8px' }}>
        Tip: click any entry to tweak it in place.
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
        {actors.map(a => editing === keyOf('actor', a.ref) ? (
          <Reveal key={`edit-${a.ref}`}>
            <ActorForm
              mode="edit" initial={a} actors={actors}
              seedEntry={seedEntry(seedIndex, 'actor', a.ref)}
              onSave={d => onSaveEdit('actor', d)}
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
            <ActorForm actors={actors} seedActors={seedIndex.actors} onAdd={d => onAdd('actor', d)} />
          </div>
        )}
      </Section>

      <Section
        title="Variables"
        count={variables.length}
        open={openVar}
        onToggle={() => setOpenVar(o => !o)}
      >
        {variables.map(v => editing === keyOf('variable', v.ref) ? (
          <Reveal key={`edit-${v.ref}`}>
            <VariableForm
              mode="edit" initial={v} variables={variables}
              seedEntry={seedEntry(seedIndex, 'variable', v.ref)}
              onSave={d => onSaveEdit('variable', d)}
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
            <VariableForm variables={variables} seedVariables={seedIndex.variables} onAdd={d => onAdd('variable', d)} />
          </div>
        )}
      </Section>

      <Section
        title="Requirements"
        count={requirements.length}
        open={openReq}
        onToggle={() => setOpenReq(o => !o)}
      >
        {requirements.map(r => {
          // Region requirements are edited by the 3-D widgets in Author mode — the
          // interval form can't represent a region, so show them read-only + a hint
          // (honest, PHILOSOPHY #11) instead of a lossy edit.
          const isRegion = !!r.admissible?.region && !Array.isArray(r.admissible?.interval)
          if (editing === keyOf('requirement', r.ref) && !isRegion) {
            return (
              <Reveal key={`edit-${r.ref}`}>
                <RequirementForm
                  mode="edit" initial={r} actors={actors} variables={variables} requirements={requirements}
                  seedEntry={seedEntry(seedIndex, 'requirement', r.ref)}
                  onSave={d => onSaveEdit('requirement', d)}
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
              requirements={requirements}
              seedReqs={seedIndex.requirements}
              onAdd={d => onAdd('requirement', d)}
              onPreview={spec => callbacks.onIntakePreview?.(spec)}
            />
          </div>
        )}
      </Section>
    </div>
  )
}
