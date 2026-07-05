import { useMemo } from 'react'
import { useUIStore } from '../../store/uiStore.js'
import {
  WIZARD_CATALOG,
  wizardStepGaps,
  wizardTrail,
} from '../../context/WizardCatalog.js'
import { buildSeedIndex } from '../../context/SeedAnchor.js'
import {
  IntakeSharedDefs,
  ActorForm,
  VariableForm,
  RequirementForm,
  EntryCard,
  ActorSummary,
  VariableSummary,
  RequirementSummary,
} from './IntakePanel.jsx'

/**
 * WizardPanel — the guided-intake wizard tab (ADR-063 Phase 3, "選択優先
 * インテーク"). The canonical entry route for a user who cannot yet fill the
 * blank forms: each step asks ONE question, embeds the SAME intake form the
 * Intake tab uses (same submit predicate, same `onAddDocEntry` commit path —
 * the wizard is an ordered vessel, not a new write path), and gates "Next" on
 * the pure WizardCatalog step predicate whose reasons are always printed
 * (no silent disabled — PHILOSOPHY #11).
 *
 * The panel only READS `context.wizard` and fires onWizard* callbacks;
 * ContextController is the sole writer of the FSM state via the pure
 * transition functions (same discipline as the grasp tab — ADR-057).
 * Step drafts live inside the embedded form components (transient), and every
 * "+ Add" commit lands in the doc immediately through the CommandStack, so
 * leaving mid-wizard keeps all progress (partial progress IS the deliverable).
 */

const btnStyle = (primary = false, disabled = false) => ({
  padding: '5px 14px', borderRadius: '3px', fontSize: '11px',
  cursor: disabled ? 'default' : 'pointer', border: 'none',
  fontFamily: 'system-ui, -apple-system, sans-serif',
  background: primary ? (disabled ? '#2a4a72' : '#3a7bd5') : '#3a3a3a',
  color: primary ? (disabled ? '#89a5c5' : '#fff') : '#ccc',
  opacity: disabled ? 0.7 : 1,
})

// ── Progress trail (chips per step + review) ───────────────────────────────────

function Trail({ nodes }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '3px', marginBottom: '10px', flexWrap: 'wrap' }}>
      {nodes.map((n, i) => (
        <div key={n.id} style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
          {i > 0 && <span style={{ color: '#555', fontSize: '9px' }}>→</span>}
          <span style={{
            fontSize: '9px', borderRadius: '9px', padding: '1px 7px',
            color:  n.status === 'current' ? '#5a9bf5' : n.status === 'done' ? '#22C55E' : '#777',
            border: `1px solid ${n.status === 'current' ? '#3a7bd5' : n.status === 'done' ? '#22C55E44' : '#3a3a3a'}`,
            background: n.status === 'current' ? 'rgba(58,123,213,0.12)' : 'transparent',
          }}>
            {n.status === 'done' ? '✓ ' : `${i + 1}. `}{n.id}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Start screen (wizard inactive) ─────────────────────────────────────────────

function StartScreen({ onStart }) {
  return (
    <div>
      <div style={{ fontSize: '11px', color: '#bbb', lineHeight: 1.6, marginBottom: '10px' }}>
        The guided intake asks one question at a time — <b>who</b> is involved,
        <b> what</b> is being decided, and <b>what must hold</b> — and every field
        starts from a list, a catalog chip, or an example. You never face a blank form.
      </div>
      <div style={{ fontSize: '10px', color: '#777', lineHeight: 1.6, marginBottom: '12px' }}>
        Each step commits immediately (undoable) — you can leave at any point and
        everything added so far stays in the document. Prefer free-form entry?
        The Intake tab keeps the full expert forms.
      </div>
      <button onClick={onStart} style={btnStyle(true)}>▶ Start guided intake</button>
    </div>
  )
}

// ── Committed-entry readout for the current step ───────────────────────────────

function CommittedList({ kind, actors, variables, requirements }) {
  const items = kind === 'actor' ? actors : kind === 'variable' ? variables : requirements
  if (!items || items.length === 0) return null
  return (
    <div style={{ marginBottom: '8px' }}>
      <div style={{ fontSize: '9px', color: '#22C55E', marginBottom: '3px' }}>
        ✓ added in this document:
      </div>
      {items.map(e => (
        <EntryCard key={e.ref} editable={false}>
          {kind === 'actor'    && <ActorSummary a={e} />}
          {kind === 'variable' && <VariableSummary v={e} />}
          {kind === 'requirement' && <RequirementSummary r={e} />}
        </EntryCard>
      ))}
    </div>
  )
}

// ── Step screen ────────────────────────────────────────────────────────────────

function StepScreen({ def, wizard, actors, variables, requirements, seedIndex, callbacks }) {
  const step = def.steps[wizard.index]
  const docLike = { actors, variables, requirements }
  const gaps = wizardStepGaps(def, wizard, docLike)
  const isLast = wizard.index === def.steps.length - 1

  const onAdd = data => callbacks.onAddDocEntry?.(step.kind, data)

  return (
    <div>
      <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#e0e0e0', marginBottom: '3px' }}>
        {step.title}
      </div>
      <div style={{ fontSize: '10px', color: '#999', lineHeight: 1.6, marginBottom: '8px' }}>
        {step.prompt}
      </div>

      <CommittedList kind={step.kind} actors={actors} variables={variables} requirements={requirements} />

      {step.kind === 'actor' && (
        <ActorForm actors={actors} seedActors={seedIndex.actors} onAdd={onAdd} />
      )}
      {step.kind === 'variable' && (
        <VariableForm variables={variables} seedVariables={seedIndex.variables} onAdd={onAdd} />
      )}
      {step.kind === 'requirement' && (
        <RequirementForm
          actors={actors} variables={variables} requirements={requirements}
          seedReqs={seedIndex.requirements}
          onAdd={onAdd}
          onPreview={spec => callbacks.onIntakePreview?.(spec)}
        />
      )}

      {/* Step gate — the same pure predicate the controller enforces on Next;
          the reason line and the disabled button are two projections of it. */}
      {gaps.length > 0 && (
        <div style={{ fontSize: '9px', color: '#c99a3a', margin: '8px 0 4px', lineHeight: 1.4 }}>
          ⚠ {gaps.join(' · ')}
        </div>
      )}
      <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
        <button onClick={() => callbacks.onWizardBack?.()} style={btnStyle(false)}
          disabled={wizard.index === 0}>
          ← Back
        </button>
        <button onClick={() => callbacks.onWizardNext?.()} style={btnStyle(true, gaps.length > 0)}
          disabled={gaps.length > 0}>
          {isLast ? 'Review →' : 'Next →'}
        </button>
        <button onClick={() => callbacks.onWizardExit?.()} title="Leave the wizard — added entries stay"
          style={{ ...btnStyle(false), marginLeft: 'auto', background: 'transparent', border: '1px solid #3a3a3a', color: '#888' }}>
          Exit
        </button>
      </div>
    </div>
  )
}

// ── Review screen ──────────────────────────────────────────────────────────────

function ReviewScreen({ actors, variables, requirements, callbacks }) {
  return (
    <div>
      <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#e0e0e0', marginBottom: '3px' }}>
        Review
      </div>
      <div style={{ fontSize: '10px', color: '#999', lineHeight: 1.6, marginBottom: '8px' }}>
        Everything below is already committed to the document (each addition is
        undoable). Finish to open the conflict matrix — or go back to add more.
      </div>
      <div style={{ fontSize: '10px', color: '#bbb', marginBottom: '4px' }}>
        {actors.length} actor{actors.length !== 1 ? 's' : ''} · {variables.length} variable{variables.length !== 1 ? 's' : ''} · {requirements.length} requirement{requirements.length !== 1 ? 's' : ''}
      </div>
      {actors.map(a => <EntryCard key={`a-${a.ref}`} editable={false}><ActorSummary a={a} /></EntryCard>)}
      {variables.map(v => <EntryCard key={`v-${v.ref}`} editable={false}><VariableSummary v={v} /></EntryCard>)}
      {requirements.map(r => <EntryCard key={`r-${r.ref}`} editable={false}><RequirementSummary r={r} /></EntryCard>)}
      <div style={{ display: 'flex', gap: '6px', marginTop: '10px' }}>
        <button onClick={() => callbacks.onWizardBack?.()} style={btnStyle(false)}>← Back</button>
        <button onClick={() => callbacks.onWizardFinish?.()} style={btnStyle(true)}>✓ Finish</button>
      </div>
    </div>
  )
}

// ── WizardPanel (public) ───────────────────────────────────────────────────────

export function WizardPanel() {
  const ctx       = useUIStore(s => s.context)
  const callbacks = useUIStore(s => s.callbacks)

  const actors       = ctx.actors       ?? []
  const variables    = ctx.variables    ?? []
  const requirements = ctx.requirements ?? []
  const seedIndex    = useMemo(() => buildSeedIndex(ctx.authorSeed), [ctx.authorSeed])

  const wizard = ctx.wizard
  const def    = wizard ? WIZARD_CATALOG[wizard.defId] : null

  return (
    <div style={{ paddingBottom: '8px' }}>
      <IntakeSharedDefs />
      {!wizard || !def ? (
        <StartScreen onStart={() => callbacks.onWizardStart?.()} />
      ) : (
        <>
          <Trail nodes={wizardTrail(def, wizard, { actors, variables, requirements })} />
          {wizard.status === 'step' ? (
            <StepScreen
              def={def} wizard={wizard}
              actors={actors} variables={variables} requirements={requirements}
              seedIndex={seedIndex} callbacks={callbacks}
            />
          ) : (
            <ReviewScreen
              actors={actors} variables={variables} requirements={requirements}
              callbacks={callbacks}
            />
          )}
        </>
      )}
    </div>
  )
}
