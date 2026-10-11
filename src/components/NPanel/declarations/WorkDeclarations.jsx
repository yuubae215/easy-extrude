import { useState } from 'react'
import { useUIStore } from '../../../store/uiStore.js'
import { COLOR } from '../../../theme/tokens.js'
import { GRIPPER_KIND } from '../../../context/GraspDeclarationCatalog.js'
import { CENTER_OF_MASS_KIND, MASS_DECLARATION_STATE, suctionHoldMissing } from '../../../domain/targetMass.js'
import { centerOfMassPresentation } from '../../../view/GraspDeclarationMath.js'
import { CommitField, NumField, FaceChip } from '../../Grasp/GraspFields.jsx'
import { Section } from '../npanelShared.jsx'

/**
 * WorkDeclarations — what the selected OBJECT declares about itself: its mass
 * and where that mass sits (ADR-164 D1, the WORK domain).
 *
 * These used to be edited inside the grasp-search panel opened from the selected
 * ROBOT — a workpiece's facts under a subject that is not the workpiece. They are
 * the object's own fields in the document (ADR-121 / ADR-156), so they live on
 * the object's own panel: select the object, and its mass is there.
 *
 * `work` is null when the selection is not something a grasp can be for; the
 * section is then absent (there is nothing to declare), which is different from
 * "declared nothing" — that state is spelled out by the editor itself.
 */
export function WorkDeclarations({ work }) {
  const callbacks = useUIStore(s => s.callbacks)
  if (!work) return null
  return (
    <Section title="Declarations (object)">
      <MassEditor
        work={work}
        onSet={(ref, key, value) => callbacks.onSetMassDeclaration?.(ref, key, value)}
      />
      <GraspRelationLink objectRef={work.ref} onSelect={(ref) => callbacks.onSelectGraspRelation?.(ref)} />
    </Section>
  )
}

/**
 * MassEditor — what THIS object weighs and where that weight sits
 * (ADR-121 / ADR-156). Both are declarations on the document. Absent stays
 * absent: no mass is guessed, and the centre of mass is never the centroid unless
 * the user CHOOSES "assumed (centroid)" — which is then drawn and labelled as an
 * assumption. States the missing inputs for suction hold instead of a silent gap.
 */
function MassEditor({ work, onSet }) {
  const ref = work?.ref ?? null
  const mp = work?.massProperties ?? null
  const hand = work?.hand ?? null
  const [draft, setDraft] = useState({ mass: '', x: '', y: '', z: '' })
  if (!ref || !mp) return null
  const mass = mp.mass
  const com = mp.centerOfMass
  const missing = hand?.kind === GRIPPER_KIND.SUCTION ? suctionHoldMissing({ hand, massProperties: mp }) : []
  const measuredReady = ['x', 'y', 'z'].every(k => draft[k] !== '' && Number.isFinite(Number(draft[k])))
  const massReady = draft.mass !== '' && Number(draft.mass) > 0
  const label = { fontSize: '10px', color: COLOR.textSecondary, marginBottom: '3px' }
  return (
    <div data-testid="mass-editor" data-declaration="mass" style={{ margin: '6px 0', padding: '6px', border: `1px solid ${COLOR.border}`, borderRadius: '4px' }}>
      <div style={label}>
        mass {mass.state === MASS_DECLARATION_STATE.UNDECLARED && '— not declared'}
      </div>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '6px' }}>
        {mass.state === MASS_DECLARATION_STATE.DECLARED ? (
          <>
            <CommitField label="mass (kg)" value={mass.kg} step="0.1" onCommit={(v) => v > 0 && onSet(ref, 'mass', v)} />
            <FaceChip label="clear mass" active={false} onClick={() => onSet(ref, 'mass', null)} />
          </>
        ) : (
          <>
            <NumField label="mass (kg)" value={draft.mass} step="0.1" min="0" onChange={(v) => setDraft(d => ({ ...d, mass: v }))} />
            <FaceChip label="declare mass" active={false} disabled={!massReady}
              onClick={() => massReady && onSet(ref, 'mass', Number(draft.mass))} />
          </>
        )}
      </div>

      <div style={label} data-declaration="centerOfMass">
        centre of mass{' '}
        {com.state === MASS_DECLARATION_STATE.DECLARED
          ? <span style={{ color: '#9ad' }}>— {centerOfMassPresentation(com.kind).caption}</span>
          : com.state === MASS_DECLARATION_STATE.UNDECLARED ? '— not declared (not the centroid)' : ''}
      </div>
      <div style={{ display: 'flex', gap: '3px', marginBottom: '4px', flexWrap: 'wrap' }}>
        <FaceChip label="not declared" active={com.state === MASS_DECLARATION_STATE.UNDECLARED}
          onClick={() => onSet(ref, 'centerOfMass', null)} />
        <FaceChip label="assumed (centroid)" active={com.kind === CENTER_OF_MASS_KIND.ASSUMED_HOMOGENEOUS}
          onClick={() => onSet(ref, 'centerOfMass', { kind: CENTER_OF_MASS_KIND.ASSUMED_HOMOGENEOUS })} />
      </div>
      <div style={{ fontSize: '10px', color: '#778', marginBottom: '3px' }}>
        measured — object frame, mm (origin = its centre)
      </div>
      <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        {com.kind === CENTER_OF_MASS_KIND.MEASURED
          ? ['x', 'y', 'z'].map((k, i) => (
            <CommitField key={k} label={k} value={com.local[k]} allowNegative
              onCommit={(v) => {
                const p = [com.local.x, com.local.y, com.local.z]
                p[i] = v
                onSet(ref, 'centerOfMass', { kind: CENTER_OF_MASS_KIND.MEASURED, point: p })
              }} />
          ))
          : (
            <>
              {['x', 'y', 'z'].map(k => (
                <NumField key={k} label={k} value={draft[k]} step="1" onChange={(v) => setDraft(d => ({ ...d, [k]: v }))} />
              ))}
              <FaceChip label="declare measured" active={false} disabled={!measuredReady}
                onClick={() => measuredReady && onSet(ref, 'centerOfMass', {
                  kind: CENTER_OF_MASS_KIND.MEASURED, point: ['x', 'y', 'z'].map(k => Number(draft[k])),
                })} />
            </>
          )}
      </div>
      {[...mass.errors, ...com.errors].map((e, i) => (
        <div key={i} style={{ fontSize: '10px', color: COLOR.cautionTone }}>· {e}</div>
      ))}
      {missing.length > 0 && (
        <div data-testid="suction-hold-missing" style={{ fontSize: '10px', color: '#778', marginTop: '4px' }}>
          suction hold NOT MEASURED — needs {missing.join(', ')}
        </div>
      )}
    </div>
  )
}

/**
 * ▸ to this object's grasp relation (ADR-164 D2) — how to grasp it and how to
 * lift it are the RELATION's declarations, not the object's, so they are one
 * link away rather than repeated here. 0 relations is said ("not declared"),
 * and the link is still the way to declare the first one.
 */
function GraspRelationLink({ objectRef, onSelect }) {
  const relation = useUIStore(s => (s.context.graspRelations?.list ?? []).find(r => r.objectRef === objectRef) ?? null)
  const word = relation
    ? `${relation.objectLabel} × ${relation.tcpLabel ?? 'hand not declared'}`
    : 'how to grasp: not declared'
  return (
    <div style={{ fontSize: '10px', color: COLOR.textSecondary, marginTop: '6px' }}>
      grasp:{' '}
      <button type="button" data-testid="work-grasp-relation-link" onClick={() => onSelect(objectRef)}
        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: COLOR.infoTone, fontSize: '10px' }}>
        ▸ {word}
      </button>
    </div>
  )
}

