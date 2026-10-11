import { useState } from 'react'
import { useUIStore } from '../../../store/uiStore.js'
import { COLOR } from '../../../theme/tokens.js'
import {
  matchingPresetId, gripperPresetsFor, GRIPPER_KIND, DECLARED_GRIPPER_KINDS,
} from '../../../context/GraspDeclarationCatalog.js'
import { defaultHandFor, HAND_BODY_KIND, wireGripperFromHand } from '../../../domain/robotHand.js'
import { mToMM } from '../../../domain/worldUnits.js'
import { CommitField, NumField, PresetChips, FaceChip } from '../../Grasp/GraspFields.jsx'
import { Section } from '../npanelShared.jsx'

/**
 * HandDeclarations — what this robot grasps with, declared on its tcp
 * (ADR-164 D1, the HAND domain; the hand's home is the tcp since ADR-152 D3).
 *
 * Before ADR-164 this was the "Grasped" card of the grasp-search panel, which
 * edited the hand of whichever robot the SEARCH was about — select robot B's tcp
 * with robot A as the subject and the card still showed A's hand. Here the tcp
 * you selected is the tcp you edit (`hand.robotId` is resolved from the selected
 * frame, not from the search subject).
 *
 * Undeclared is a state, not a gap: graspability then passes everything and the
 * arm draws the bare flange→TCP rod (what is judged). Declaring writes one
 * undoable edit through the scene's writer (or the document's, for a tcp the
 * document knows — `GraspController.setRobotHand`).
 */
export function HandDeclarations({ hand: handProj }) {
  const callbacks = useUIStore(s => s.callbacks)
  if (!handProj) return null
  const setHand = (next) => callbacks.onSetRobotHand?.(handProj.robotId, next)
  const declared = handProj.state === 'declared' || handProj.state === 'malformed'
  return (
    <Section title="Declarations (hand)">
      <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10px', color: COLOR.textSecondary, marginBottom: '6px' }}>
        <input
          type="checkbox"
          checked={declared}
          onChange={e => setHand(e.target.checked ? defaultHandFor(GRIPPER_KIND.PARALLEL_JAW) : null)}
        />
        declare the hand on this tcp
      </label>
      {!declared && (
        <div style={{ fontSize: '10px', color: COLOR.textSecondary }}>
          no hand declared — graspability passes everything, and the arm draws a bare flange→TCP rod (what is judged)
        </div>
      )}
      <HandEditor handProj={handProj} onSet={setHand} />
    </Section>
  )
}

/**
 * HandEditor — what the robot grasps with, read from and written to its tcp
 * (ADR-152 D3). Kind first (it decides which fields exist — ADR-118); then the
 * gate parameters; then the SHAPE the arm draws and core/ judges. Lengths are mm
 * (the scene's unit); a field commits on blur as ONE undoable edit, never per
 * keystroke. Contradictions with the tool mount are printed, not corrected.
 */
function HandEditor({ handProj, onSet }) {
  const hand = handProj?.hand ?? null
  if (!handProj || handProj.state === 'undeclared') return null
  if (!hand) {
    return (
      <div style={{ fontSize: '10px', color: COLOR.cautionTone }}>
        {(handProj.errors ?? []).map((e, i) => <div key={i}>· {e}</div>)}
        <FaceChip label="replace with the default parallel jaw" active={false}
          onClick={() => onSet(defaultHandFor(GRIPPER_KIND.PARALLEL_JAW))} grow />
      </div>
    )
  }
  const jaw = hand.kind === GRIPPER_KIND.PARALLEL_JAW
  const put = (patch) => onSet({ ...hand, ...patch })
  const presets = gripperPresetsFor(hand.kind)
  // Presets are wire values (m); the hand is mm. Compare and apply through the
  // one conversion — `wireGripperFromHand` — rather than a second table.
  const wire = wireGripperFromHand(hand)
  const applyPreset = (p) => put(jaw
    ? { maxOpening: mToMM(p.params.maxOpening), fingerClearance: mToMM(p.params.fingerClearance) }
    : { cupDiameter: mToMM(p.params.cupDiameter), sealTiltTolerance: p.params.sealTiltTolerance })
  const body = hand.body ?? null
  return (
    <div data-declaration="hand">
      <div style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
        {DECLARED_GRIPPER_KINDS.map(k => (
          <FaceChip key={k} label={k === GRIPPER_KIND.SUCTION ? 'suction' : 'parallel jaw'}
            active={hand.kind === k} grow
            onClick={() => { if (hand.kind !== k) onSet(defaultHandFor(k)) }} />
        ))}
      </div>
      <PresetChips presets={presets} activeId={matchingPresetId(presets, wire)} onPick={applyPreset} />
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '6px' }}>
        {jaw ? (
          <>
            <CommitField label="max opening (mm)" value={hand.maxOpening} onCommit={(v) => put({ maxOpening: v })} />
            <CommitField label="finger clearance (mm)" value={hand.fingerClearance} onCommit={(v) => put({ fingerClearance: v })} />
          </>
        ) : (
          <>
            <CommitField label="cup diameter (mm)" value={hand.cupDiameter} onCommit={(v) => put({ cupDiameter: v })} />
            <CommitField label="seal tilt (rad)" value={hand.sealTiltTolerance} step="0.05" onCommit={(v) => put({ sealTiltTolerance: v })} />
          </>
        )}
      </div>
      {!jaw && <HoldEditor hold={hand.hold ?? null} onSet={(hold) => {
        const { hold: _h, ...rest } = hand
        onSet(hold ? { ...rest, hold } : rest)
      }} />}

      <div style={{ fontSize: '10px', color: COLOR.textSecondary, marginBottom: '3px' }}>
        shape {body ? '' : '— not declared: judged and drawn as the flange→TCP rod'}
      </div>
      {body ? (
        <>
          <div style={{ display: 'flex', gap: '3px', marginBottom: '4px' }}>
            {Object.values(HAND_BODY_KIND).map(k => (
              <FaceChip key={k} label={`housing: ${k}`} active={body.kind === k}
                onClick={() => {
                  if (body.kind === k) return
                  const len = body.kind === HAND_BODY_KIND.CYLINDER ? body.length : body.size[2]
                  put({ body: k === HAND_BODY_KIND.CYLINDER
                    ? { kind: k, radius: 32, length: len }
                    : { kind: k, size: [64, 64, len] } })
                }} />
            ))}
            <FaceChip label="remove shape" active={false}
              onClick={() => { const { body: _b, fingers: _f, cupHeight: _c, ...rest } = hand; onSet(rest) }} />
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {body.kind === HAND_BODY_KIND.CYLINDER ? (
              <>
                <CommitField label="housing radius" value={body.radius} onCommit={(v) => put({ body: { ...body, radius: v } })} />
                <CommitField label="housing length" value={body.length} onCommit={(v) => put({ body: { ...body, length: v } })} />
              </>
            ) : (
              ['x', 'y', 'z (length)'].map((axis, i) => (
                <CommitField key={axis} label={`housing ${axis}`} value={body.size[i]}
                  onCommit={(v) => put({ body: { ...body, size: body.size.map((w, j) => (j === i ? v : w)) } })} />
              ))
            )}
            {jaw ? (
              ['length', 'thickness', 'width'].map(k => (
                <CommitField key={k} label={`finger ${k}`} value={hand.fingers[k]}
                  onCommit={(v) => put({ fingers: { ...hand.fingers, [k]: v } })} />
              ))
            ) : (
              <CommitField label="cup height" value={hand.cupHeight} onCommit={(v) => put({ cupHeight: v })} />
            )}
          </div>
        </>
      ) : (
        <FaceChip label="declare the default shape" active={false}
          onClick={() => { const d = defaultHandFor(hand.kind); put(jaw ? { body: d.body, fingers: d.fingers } : { body: d.body, cupHeight: d.cupHeight }) }} />
      )}
      {handProj.toolLengthMm != null && (
        <div style={{ fontSize: '10px', color: COLOR.textSecondary, marginTop: '4px' }}>
          TCP {handProj.toolLengthMm} mm from the flange (the tool mount — set by the tcp)
        </div>
      )}
      {handProj.mountGap && (
        <div style={{ fontSize: '10px', color: COLOR.cautionTone, marginTop: '2px' }}>· {handProj.mountGap}</div>
      )}
    </div>
  )
}

/**
 * HoldEditor — the cup's holding capability (ADR-156 D1), ONE bundle: force (N)
 * and friction are declared together or not at all. Undeclared is a state and is
 * never filled in: until both are typed, nothing is written and suction hold
 * reads "not measured".
 */
function HoldEditor({ hold, onSet }) {
  const [draft, setDraft] = useState({ force: '', friction: '' })
  if (hold) {
    return (
      <div data-declaration="hand.hold" style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '6px' }}>
        <CommitField label="hold force (N)" value={hold.force} step="1" onCommit={(v) => v > 0 && onSet({ ...hold, force: v })} />
        <CommitField label="pad friction μ" value={hold.friction} step="0.05" onCommit={(v) => v > 0 && onSet({ ...hold, friction: v })} />
        <FaceChip label="clear hold" active={false} onClick={() => onSet(null)} />
      </div>
    )
  }
  const f = Number(draft.force), mu = Number(draft.friction)
  const ready = draft.force !== '' && draft.friction !== '' && f > 0 && mu > 0
  return (
    <div data-declaration="hand.hold" style={{ marginBottom: '6px' }}>
      <div style={{ fontSize: '10px', color: '#778', marginBottom: '3px' }}>
        hold — not declared: suction hold is NOT MEASURED (never a default)
      </div>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <NumField label="hold force (N)" value={draft.force} step="1" min="0" onChange={(v) => setDraft(d => ({ ...d, force: v }))} />
        <NumField label="pad friction μ" value={draft.friction} step="0.05" min="0" onChange={(v) => setDraft(d => ({ ...d, friction: v }))} />
        <FaceChip label="declare hold" active={false} disabled={!ready}
          onClick={() => ready && onSet({ force: f, friction: mu })} />
      </div>
    </div>
  )
}
