import { useEffect, useMemo } from 'react'
import { useUIStore, UNDECLARED_REACH } from '../../../store/uiStore.js'
import { COLOR } from '../../../theme/tokens.js'
import { reachPresetsFor } from '../../../context/GraspDeclarationCatalog.js'
import { NumField } from '../../Grasp/GraspFields.jsx'
import { Section } from '../npanelShared.jsx'

/**
 * ArmDeclarations — what is declared about the ARM itself, on the robot's own
 * panel (its base frame): the reach envelope (ADR-164 D1, the ARM domain), and
 * what the arm is drawn as (ADR-164 D5).
 *
 * ## Reach envelope
 *
 * The values come from the URDF the viewport draws (ADR-141); the only thing a
 * person decides is WHETHER the envelope is declared for the search. OFF by
 * default, and off means the key is omitted from the request — an undeclared
 * envelope stays visibly different from a declared zero (ADR-120 / 原則 #31).
 * The state lives in `context.reachDeclarations[robotId]` (sole writer: this
 * component) so the grasp panel's Run can read what was declared for its subject.
 * Each robot has its own row: with N arms, "which one" is the panel you are on.
 *
 * ## Appearance (ADR-164 D5)
 *
 * The realistic / lightweight toggle is gone. The realistic mesh is the only
 * look the scene asks for; when it cannot be loaded the arm falls back to the
 * lightweight skeleton by itself (`RobotStageSet` — ADR-150 D3), and THIS panel
 * says so for as long as it is true — the toast alone is gone in four seconds,
 * and a skeleton nobody explained is a silent failure (原則 #11).
 */
export function ArmDeclarations({ robotId }) {
  const robots    = useUIStore(s => s.context.robots)
  const reachDecl = useUIStore(s => s.context.reachDeclarations[robotId] ?? UNDECLARED_REACH)
  const write     = useUIStore(s => s.actions.contextSetReachDeclaration)
  const loading   = useUIStore(s => s.robotAppearanceLoading)
  const fellBack  = useUIStore(s => s.robotMeshFallbacks.includes(robotId))
  const declared  = useUIStore(s => s.robotAppearance)

  const isRobot = !!robotId && (robots?.list ?? []).some(r => r.id === robotId)
  const setReach = useMemo(() => (patch) => write(robotId, patch), [write, robotId])
  const reachPresets = useMemo(
    () => reachPresetsFor(robots?.model?.reach, robots?.model?.label),
    [robots?.model?.reach, robots?.model?.label])
  const sceneArmReach = reachPresets[0]?.params ?? null

  // Seed (and re-seed) from the arm once one is in the scene, but never
  // overwrite numbers the user has edited: the card is a DECLARATION, and
  // silently rewriting a declaration is how the two arms got to disagree in the
  // first place. `touched` separates "not filled in yet" from "the user meant
  // this" — a blank field and a deliberate 0.5 are different states (原則 #31).
  useEffect(() => {
    if (!isRobot || reachDecl.touched || !sceneArmReach) return
    const seeded = {
      reachMin:           String(sceneArmReach.reachMin),
      reachMax:           String(sceneArmReach.reachMax),
      wristConeHalfAngle: String(sceneArmReach.wristConeHalfAngle),
    }
    if (seeded.reachMin === reachDecl.reachMin && seeded.reachMax === reachDecl.reachMax
      && seeded.wristConeHalfAngle === reachDecl.wristConeHalfAngle) return
    setReach(seeded)
  }, [isRobot, reachDecl, sceneArmReach, setReach])

  if (!isRobot) return null
  const edit = (patch) => setReach({ ...patch, touched: true })

  // Declaring a DIFFERENT arm than the one on screen is allowed (the user may be
  // modelling hardware we do not ship) but never silent (ADR-141 / 原則 #11).
  const min = Number(reachDecl.reachMin), max = Number(reachDecl.reachMax)
  const mismatch = reachDecl.enabled && sceneArmReach && reachDecl.reachMax !== ''
    && !(min === sceneArmReach.reachMin && max === sceneArmReach.reachMax)
    ? `declared envelope ${reachDecl.reachMin}–${reachDecl.reachMax} m is not the arm in the ` +
      `scene (${robots?.model?.label ?? 'the robot'}: ${sceneArmReach.reachMin}–${sceneArmReach.reachMax} m)`
    : null

  return (
    <Section title="Declarations (arm)">
      <label data-declaration="reachEnvelope"
        style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10px', color: COLOR.textSecondary, margin: '0 0 4px' }}>
        <input
          type="checkbox"
          checked={reachDecl.enabled}
          onChange={e => setReach({ enabled: e.target.checked })}
        />
        declare reach envelope
      </label>
      {!reachDecl.enabled && (
        <div style={{ fontSize: '10px', color: COLOR.textSecondary, marginBottom: '4px' }}>
          undeclared, so reach margin is NOT MEASURED
        </div>
      )}
      {reachDecl.enabled && (
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
          <NumField label="reach min" value={reachDecl.reachMin} step="0.05"
            onChange={(s) => edit({ reachMin: s })} />
          <NumField label="reach max" value={reachDecl.reachMax} step="0.05"
            onChange={(s) => edit({ reachMax: s })} />
          <NumField label="wrist cone (rad)" value={reachDecl.wristConeHalfAngle} step="0.05"
            onChange={(s) => edit({ wristConeHalfAngle: s })} />
        </div>
      )}
      {mismatch && (
        <div style={{ fontSize: '10px', color: COLOR.cautionTone, margin: '2px 0 6px' }}>⚠ {mismatch}</div>
      )}

      {/* What the arm is drawn as (ADR-164 D5) — a statement, not a control. */}
      <div data-testid="robot-appearance-status" style={{ fontSize: '10px', color: fellBack ? COLOR.cautionTone : COLOR.textSecondary, marginTop: '6px' }}>
        {loading
          ? 'appearance: loading the realistic mesh…'
          : fellBack
            ? '⚠ appearance: lightweight skeleton — the realistic mesh could not be loaded'
            : declared === 'skeleton'
              ? 'appearance: lightweight skeleton (set from the console)'
              : 'appearance: realistic mesh'}
      </div>
    </Section>
  )
}
