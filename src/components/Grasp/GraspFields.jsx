import { useEffect, useState } from 'react'
import { COLOR } from '../../theme/tokens.js'

/**
 * GraspFields — the small inputs every declaration editor shares (ADR-164 D1).
 *
 * They used to be private to `GraspSearchPanel.jsx` because every declaration
 * lived there. ADR-164 moved each declaration to the panel of the entity that
 * owns it (the object, the tcp, the robot), so the inputs moved out to one module
 * rather than being copied into each owner's panel (§1.1).
 */

/**
 * A number field that commits on blur / Enter (one undoable edit per change,
 * not per keystroke). A blank or unreadable entry is not written — it reverts
 * (Number('') === 0 is not a value the user typed).
 */
export function CommitField({ label, value, onCommit, step = '1', allowNegative = false }) {
  const [text, setText] = useState(value == null ? '' : String(value))
  useEffect(() => { setText(value == null ? '' : String(value)) }, [value])
  const commit = () => {
    const n = Number(text)
    if (text.trim() === '' || !Number.isFinite(n) || (!allowNegative && n < 0)) { setText(value == null ? '' : String(value)); return }
    if (n !== value) onCommit(n)
  }
  return (
    <label style={{ fontSize: '10px', color: COLOR.textSecondary, display: 'flex', flexDirection: 'column', gap: '3px' }}>
      {label}
      <input
        type="number" value={text} step={step} min="0"
        onChange={e => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit() }}
        style={{
          width: '64px', padding: '4px 6px', borderRadius: '4px',
          border: `1px solid ${COLOR.border}`, background: COLOR.surfaceSunken, color: COLOR.textPrimary, fontSize: '12px',
        }}
      />
    </label>
  )
}

export function NumField({ label, value, onChange, step, min, disabled = false, title }) {
  return (
    <label title={title} style={{ fontSize: '10px', color: disabled ? '#666' : '#aaa', display: 'flex', flexDirection: 'column', gap: '3px' }}>
      {label}
      <input
        type="number" value={value} step={step} min={min} disabled={disabled}
        onChange={e => onChange(e.target.value)}
        style={{
          width: '64px', padding: '4px 6px', borderRadius: '4px',
          border: '1px solid #444', background: '#1a1a1a', color: '#e0e0e0', fontSize: '12px',
        }}
      />
    </label>
  )
}

export function SortChip({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: '10px', padding: '2px 7px', borderRadius: '10px', cursor: 'pointer',
        border: `1px solid ${active ? '#3a7bd5' : '#444'}`,
        background: active ? '#1d3a5f' : 'transparent',
        color: active ? '#9cf' : '#aaa', fontFamily: 'inherit',
      }}
    >{label}</button>
  )
}

/**
 * Preset chip row (fork & tweak — ADR-063/058): picking a chip seeds the
 * card's fields; the active chip is DERIVED by value equality
 * (`matchingPresetId`), so any edit forks to "custom" with no stored flag.
 */
export function PresetChips({ presets, activeId, onPick }) {
  return (
    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '6px', alignItems: 'center' }}>
      <span style={{ fontSize: '10px', color: '#888' }}>preset:</span>
      {presets.map(p => (
        <SortChip key={p.id} label={p.label} active={p.id === activeId} onClick={() => onPick(p)} />
      ))}
      {activeId == null && <span style={{ fontSize: '9px', color: '#997' }}>custom (forked)</span>}
    </div>
  )
}

/** A small toggle chip — the face vocabulary and the two declaration verbs. */
export function FaceChip({ label, active, onClick, disabled, grow }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: grow ? 1 : undefined,
        fontSize: '10px', padding: '3px 6px', borderRadius: '4px',
        cursor: disabled ? 'default' : 'pointer',
        background: active ? COLOR.accentSoft : COLOR.surfaceSunken,
        color: disabled ? '#666' : active ? COLOR.accent : '#bbb',
        border: `1px solid ${active ? COLOR.accent : '#444'}`,
      }}
    >
      {label}
    </button>
  )
}

/**
 * The shared shape of both premise pickers (ADR-117).
 *
 * The robot picker and the object picker ask the same question about the two
 * halves of the same premise — "which one, of 0 / 1 / N?" — and the answer is
 * rendered identically down to the placeholder wording. Writing the second one
 * as a copy would have duplicated six colour literals along with the markup,
 * which is what the ADR-100 ratchet objected to; sharing the row removes the
 * duplication instead of declaring a budget for it.
 *
 * Shared from here (ADR-164 D2) because the grasp-spec editor moved to the grasp
 * relation's own panel and still draws its inputs in the same vessel.
 */
export const PICKER = Object.freeze({
  row:    { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' },
  label:  { fontSize: '10px', color: '#889', minWidth: '38px' },
  muted:  { fontSize: '10px', color: '#caa' },
  chosen: { fontSize: '11px', color: '#cde' },
  hint:   { color: '#9ad' },
  select: {
    background: '#1f2530', color: '#dceaff', border: '1px solid #3a4a60',
    borderRadius: '4px', fontSize: '11px', padding: '2px 4px', flex: 1,
  },
})
