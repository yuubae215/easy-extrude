import { useEffect, useMemo, useState } from 'react'
import { COLOR } from '../../../theme/tokens.js'
import { GRIPPER_KIND, DECLARED_GRIPPER_KINDS } from '../../../context/GraspDeclarationCatalog.js'
import { facesForGripperKind } from '../../../domain/graspTargets.js'
import {
  DECLARABLE_FACES, GRASP_FEATURE_KIND, GRASP_FEATURE_STATE, inPlaneAxesOrThrow,
  graspFeatureGaps, graspFeatureSummary, DEFAULT_STRATEGY, STRATEGY_ORDER, STRATEGY_FALLBACK,
  CLOSING_AXES, FULL_REGION, isFullRegion, specUsability, featureToDsl, newSpec, contactFacesOf,
} from '../../../domain/graspFeature.js'
import { LIFT_STATE, LIFT_ALONG } from '../../../domain/targetLift.js'
import { FaceChip, PICKER } from '../../Grasp/GraspFields.jsx'
import { useUIStore } from '../../../store/uiStore.js'
import { GRASP_RELATION_STATE, relationWordsFor } from '../../../domain/graspRelation.js'
import { Section } from '../npanelShared.jsx'

/**
 * GraspDeclarations — what the grasp RELATION (object × hand) declares: HOW the
 * object is grasped (grasp specs + strategy) and how it is LIFTED out
 * (ADR-164 D1/D2, the GRASP domain).
 *
 * These were edited inside the grasp-search panel opened from the selected robot
 * — the relation's facts under a subject that is neither side of it. The relation
 * now has a row of its own (the Outliner's semantic side), and selecting it opens
 * this. The editors moved verbatim; the only change is that every rewrite carries
 * the relation's named hand (`graspFeature.tcp`) through, so editing a spec can
 * never un-name the hand.
 *
 * The census (`DeclarationOwnership.test.js`) allows `graspFeature` / `lift`
 * editors in this file only.
 */

/**
 * GraspSpecEditor — HOW to grasp the object: named grasp specs + a strategy
 * (ADR-152 D1), successor of the face-list editor (ADR-119 D2/D3, ADR-128).
 *
 * ## What changed and why
 *
 * The face list said one thing ("this face") that meant two (where the hand
 * comes from / what the jaws touch). A spec says each fact separately: the
 * APPROACH face (+ region, tilt tolerance), the CLOSING axis (whose two contact
 * faces are derived and painted, never declared), and the DEPTH below the
 * approach face. The list's ORDER is its priority (number badges); the strategy
 * says how the list is used.
 *
 * ## "+x — where is that?" (ADR-152 D2)
 *
 * Every face chip carries the world word for the object AS IT STANDS
 * (`+z · top`, `+x · left` after a turn) — derived by the domain, never stored.
 * Hovering (touch: pressing) a chip asks the viewport to paint that face; the
 * focused spec's approach, contact faces, depth and hand are drawn in 3D from the
 * same values the request carries (`onFocusGraspSpec`).
 *
 * ## Declaring is not clearing (unchanged)
 *
 *   `anywhere` — declared, deliberately not narrowed.
 *   specs      — declared and narrowed; never unioned with the derived set
 *                unless the strategy DECLARES `fallback: derived`.
 *   `clear`    — back to "nobody said".
 *
 * Writes go to the DOCUMENT through one undoable doc-edit (原則 #1). The only
 * shape ever written is `kind: 'specs'` (`featureToDsl`) — a legacy face list is
 * read, shown as migrated specs, and rewritten as specs on the first edit.
 */
export function GraspSpecEditor({ targets, gripperKind, onSet, onFocusSpec, onHoverFace }) {
  const ref       = targets?.selectedRef ?? null
  const feature   = targets?.feature ?? null
  const faceWords = targets?.faceWords ?? null
  const [focused, setFocused] = useState(0)
  const derived = useMemo(() => {
    try { return [...facesForGripperKind(gripperKind ?? null)] } catch { return [] }
  }, [gripperKind])

  const specsNow  = feature?.state === GRASP_FEATURE_STATE.DECLARED_SPECS ? feature.specs : []
  const strategy  = feature?.strategy ?? DEFAULT_STRATEGY
  const declaredStrategy = feature?.strategyDeclared ?? false
  const summary   = graspFeatureSummary(feature, derived)
  const gaps      = graspFeatureGaps(feature, gripperKind ?? null)
  const focusIdx  = Math.min(focused, Math.max(0, specsNow.length - 1))
  const current   = specsNow[focusIdx] ?? null

  // The viewport draws the ONE focused spec (N arrows at once bury the words —
  // ADR-152 D6: 1 and N are different worlds).
  useEffect(() => { onFocusSpec?.(current ? focusIdx : null) }, [onFocusSpec, focusIdx, current])

  /** Every edit rewrites the whole declaration (the document holds a value, not a diff). */
  const write = (nextSpecs, nextStrategy = strategy, nextDeclared = declaredStrategy) =>
    // The hand the relation names rides through every rewrite (ADR-164 D2) — the
    // specs and the tcp are one declaration, and an edit to one must not drop the other.
    onSet(ref, featureToDsl(nextSpecs, nextStrategy, nextDeclared, gripperKind ?? null, feature?.tcp ?? null))
  const patch = (i, change) => write(specsNow.map((sp, j) => (j === i ? { ...sp, ...change(sp) } : sp)))
  const move  = (i, d) => {
    const j = i + d
    if (j < 0 || j >= specsNow.length) return
    const next = specsNow.slice()
    ;[next[i], next[j]] = [next[j], next[i]]
    write(next)
    setFocused(j)
  }
  const faceLabel = (face) => (faceWords?.[face] ? `${face} · ${faceWords[face]}` : face)

  if (!ref) return null

  return (
    <div data-declaration="graspFeature" style={{ marginTop: '6px', marginBottom: '6px' }}>
      <div style={{ fontSize: '10px', color: COLOR.textSecondary, marginBottom: '3px' }}>how to grasp</div>

      {feature?.migratedFaces > 0 && (
        <div style={{ fontSize: '10px', color: COLOR.cautionTone, marginBottom: '3px' }}>
          · migrated {feature.migratedFaces} legacy face declaration{feature.migratedFaces === 1 ? '' : 's'} to grasp specs
          (same samples, ranked by score) — the next edit saves them as specs
        </div>
      )}

      {/* The spec list: order = priority (the badge is the rank, not a field). */}
      {specsNow.map((sp, i) => {
        const usable = specUsability(sp, gripperKind ?? null)
        return (
          <div key={sp.name} style={{ display: 'flex', gap: '3px', alignItems: 'center', marginBottom: '2px' }}>
            <span style={{ ...PICKER.label, minWidth: '14px' }}>{i + 1}</span>
            <FaceChip
              label={`${sp.name}${sp.hand ? ` (${sp.hand === GRIPPER_KIND.SUCTION ? 'cup' : 'jaw'})` : ''}`}
              active={i === focusIdx}
              onClick={() => setFocused(i)}
              grow
            />
            <FaceChip label="↑" active={false} disabled={i === 0} onClick={() => move(i, -1)} />
            <FaceChip label="↓" active={false} disabled={i === specsNow.length - 1} onClick={() => move(i, 1)} />
            <FaceChip label="×" active={false} onClick={() => { write(specsNow.filter((_, j) => j !== i)); setFocused(0) }} />
            {!usable.usable && <span title={usable.reason} style={{ fontSize: '9px', color: COLOR.cautionTone }}>unused</span>}
          </div>
        )
      })}

      {current && (
        <SpecFields
          spec={current}
          handKind={gripperKind ?? null}
          faceLabel={faceLabel}
          onHoverFace={onHoverFace}
          onChange={(change) => patch(focusIdx, change)}
        />
      )}

      <div style={{ display: 'flex', gap: '4px', margin: '4px 0' }}>
        <FaceChip
          label="+ grasp spec"
          active={false}
          onClick={() => { write([...specsNow, newSpec(specsNow, gripperKind ?? null)]); setFocused(specsNow.length) }}
          grow
        />
        <FaceChip
          label="anywhere"
          active={feature?.state === GRASP_FEATURE_STATE.DECLARED_ANYWHERE}
          onClick={() => onSet(ref, { kind: GRASP_FEATURE_KIND.ANYWHERE, ...(feature?.tcp ? { tcp: feature.tcp } : {}) })}
          grow
        />
        <FaceChip
          label="clear"
          active={false}
          disabled={feature?.state === GRASP_FEATURE_STATE.DERIVED}
          onClick={() => onSet(ref, null)}
          grow
        />
      </div>

      {/* The strategy (0/1). Omitted is shown as the default it is (原則 #31). */}
      {specsNow.length > 0 && (
        <div style={{ display: 'flex', gap: '3px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '4px' }}>
          <span style={{ ...PICKER.label, minWidth: undefined }}>strategy</span>
          {Object.values(STRATEGY_ORDER).map(o => (
            <FaceChip key={o} label={o} active={declaredStrategy && strategy.order === o}
              onClick={() => write(specsNow, { ...strategy, order: o }, true)} />
          ))}
          {Object.values(STRATEGY_FALLBACK).map(f => (
            <FaceChip key={f} label={f === 'none' ? 'no fallback' : 'fallback: derived'}
              active={declaredStrategy && strategy.fallback === f}
              onClick={() => write(specsNow, { ...strategy, fallback: f }, true)} />
          ))}
        </div>
      )}

      <div style={{
        fontSize: '10px', lineHeight: 1.45,
        color: feature?.state === GRASP_FEATURE_STATE.DERIVED ? COLOR.textSecondary : COLOR.infoTone,
      }}>
        {summary}
      </div>
      {specsNow.map(sp => specUsability(sp, gripperKind ?? null)).filter(u => !u.usable).map((u, i) => (
        <div key={`u${i}`} style={{ fontSize: '10px', color: COLOR.cautionTone, marginTop: '2px' }}>· excluded — {u.reason}</div>
      ))}
      {gaps.map((g, i) => (
        <div key={i} style={{ fontSize: '10px', color: COLOR.cautionTone, marginTop: '2px' }}>· {g}</div>
      ))}
    </div>
  )
}

/**
 * SpecFields — the five facts of the focused spec. Undeclared facts are SAID to
 * be undeclared ("every roll", "on the face") rather than shown as a blank or a
 * 0 that reads like a choice (原則 #31).
 */
function SpecFields({ spec, handKind, faceLabel, onHoverFace, onChange }) {
  const hand = spec.hand ?? handKind ?? GRIPPER_KIND.PARALLEL_JAW
  const jaw  = hand === GRIPPER_KIND.PARALLEL_JAW
  const fromAxis = spec.approach.from.slice(1)
  const numberEdit = (apply) => (e) => {
    const v = e.target.value
    if (v.trim() === '') { apply(null); return }
    const n = Number(v)
    if (Number.isFinite(n) && n >= 0) apply(n)
  }
  return (
    <div style={{ paddingLeft: '4px', borderLeft: `2px solid ${COLOR.border}`, margin: '3px 0' }}>
      <div style={{ display: 'flex', gap: '3px', alignItems: 'center', marginBottom: '3px' }}>
        <span style={{ ...PICKER.label, minWidth: '46px' }}>name</span>
        <input
          key={spec.name}
          defaultValue={spec.name}
          onBlur={(e) => { const n = e.target.value.trim(); if (n && n !== spec.name) onChange(() => ({ name: n })) }}
          style={{ ...PICKER.select, padding: '1px 3px' }}
        />
        {DECLARED_GRIPPER_KINDS.map(k => (
          <FaceChip key={k} label={k === GRIPPER_KIND.SUCTION ? 'cup' : 'jaw'} active={hand === k}
            onClick={() => onChange(() => (k === GRIPPER_KIND.SUCTION
              ? { hand: k, closing: null, depth: 0, depthDeclared: false }
              : { hand: k }))} />
        ))}
      </div>

      <div style={{ ...PICKER.label, minWidth: undefined, marginBottom: '2px' }}>approach from (hover to see it)</div>
      <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap', marginBottom: '4px' }}>
        {DECLARABLE_FACES.map(face => (
          <span key={face}
            onMouseEnter={() => onHoverFace?.(face)} onMouseLeave={() => onHoverFace?.(null)}
            onPointerDown={() => onHoverFace?.(face)} onPointerUp={() => onHoverFace?.(null)}>
            <FaceChip
              label={faceLabel(face)}
              active={spec.approach.from === face}
              onClick={() => onChange(sp => ({
                approach: { ...sp.approach, from: face },
                // A closing axis along the new approach is illegal — drop it
                // rather than write a malformed spec.
                closing: sp.closing === face.slice(1) ? null : sp.closing,
              }))}
            />
          </span>
        ))}
      </div>

      <FaceRegionEditor
        key={`${spec.name}${spec.approach.from}`}
        face={spec.approach.from}
        region={isFullRegion(spec.approach.region) ? null : spec.approach.region}
        onChange={(region) => onChange(sp => ({ approach: { ...sp.approach, region: region ?? FULL_REGION } }))}
      />

      {jaw && (
        <div style={{ display: 'flex', gap: '3px', alignItems: 'center', marginBottom: '3px' }}>
          <span style={{ ...PICKER.label, minWidth: '46px' }}>close on</span>
          {CLOSING_AXES.map(a => (
            <FaceChip key={a} label={a} active={spec.closing === a} disabled={a === fromAxis}
              onClick={() => onChange(sp => ({ closing: sp.closing === a ? null : a }))} />
          ))}
          <span style={{ ...PICKER.label, minWidth: undefined }}>
            {spec.closing ? `contact ${contactFacesOf(spec.closing).join(' / ')}` : 'not declared — every roll'}
          </span>
        </div>
      )}
      {jaw && (
        <label style={{ ...PICKER.label, display: 'flex', gap: '3px', alignItems: 'center', minWidth: undefined, marginBottom: '3px' }}>
          depth (mm)
          <input type="number" min="0" step="1" key={`d${spec.name}`}
            defaultValue={spec.depthDeclared ? spec.depth : ''}
            placeholder="on the face"
            onChange={numberEdit(n => onChange(() => (n === null ? { depth: 0, depthDeclared: false } : { depth: n, depthDeclared: true })))}
            style={{ ...PICKER.select, flex: undefined, width: '56px', padding: '1px 2px' }} />
        </label>
      )}
      <label style={{ ...PICKER.label, display: 'flex', gap: '3px', alignItems: 'center', minWidth: undefined }}>
        tilt tolerance (rad)
        <input type="number" min="0" step="0.05" key={`t${spec.name}`}
          defaultValue={spec.approach.tiltTolerance ?? ''}
          placeholder="every sampled tilt"
          onChange={numberEdit(n => onChange(sp => ({ approach: { ...sp.approach, tiltTolerance: n } })))}
          style={{ ...PICKER.select, flex: undefined, width: '56px', padding: '1px 2px' }} />
      </label>
    </div>
  )
}

/**
 * FaceRegionEditor — 面の**どのあたり**を掴むか (ADR-129 D3 / DEF-031)。
 *
 * ## 軸の名前はここで決めない
 *
 * どちらの面内軸が u かは `inPlaneAxesOrThrow` が決定的に持っている。画面はその
 * 名前を**表示するだけ**で、`+z なら u は x` のような対応表をここに書き写さない —
 * 書き写した瞬間に第二の源になり、ドメイン側の軸割当を変えた日に画面だけが古い
 * 名前で嘘をつく (§1.1)。DEF-031 は「どちらが u かを画面上で正しく名指しする設計が
 * 要る」ことを先送りの理由に挙げたが、その権威は既に在り、要ったのは呼び出しだけだった。
 *
 * ## 値は面に対する割合であって、長さではない
 *
 * 0–1 の正規化なので、箱の寸法を変えても「面の右半分」は右半分のままである
 * (ミリで書くと、リサイズした日に領域が黙って面からはみ出す — `readRegion` の
 * doc がその理由を持っている)。
 *
 * ## 確認は 3D が担う — 新しい確認面を作らない
 *
 * 領域を狭めるとサンプル点が減るのが `GraspSampleView` にそのまま出る
 * (ADR-128 D1 の「入力はパネル・確認は 3D」を継ぐ)。だからここに数字以外の
 * プレビューを足さない。
 */
function FaceRegionEditor({ face, region, onChange }) {
  const [uAxis, vAxis] = inPlaneAxesOrThrow(face)
  const cur = region ?? { uMin: 0, uMax: 1, vMin: 0, vMax: 1 }
  const narrowed = region != null

  // 空欄は 0 ではない (Number('') === 0 の罠)。読めない値は書かず、その場に留める。
  const edit = (key) => (e) => {
    const v = e.target.value
    if (v.trim() === '') return
    const n = Number(v)
    if (!Number.isFinite(n)) return
    onChange({ ...cur, [key]: n })
  }

  return (
    <div style={{ marginBottom: '4px', paddingLeft: '4px', borderLeft: `2px solid ${COLOR.border}` }}>
      <div style={{ ...PICKER.label, minWidth: undefined, marginBottom: '2px' }}>
        {face} region — u = {uAxis}, v = {vAxis} (0–1 of the face)
      </div>
      <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
        <RegionInput label={`${uAxis}min`} value={cur.uMin} onChange={edit('uMin')} />
        <RegionInput label={`${uAxis}max`} value={cur.uMax} onChange={edit('uMax')} />
        <RegionInput label={`${vAxis}min`} value={cur.vMin} onChange={edit('vMin')} />
        <RegionInput label={`${vAxis}max`} value={cur.vMax} onChange={edit('vMax')} />
        <button
          type="button"
          onClick={() => onChange(null)}
          disabled={!narrowed}
          title="Reset to the whole face (clear the region key)"
          style={{
            fontSize: '9px', padding: '2px 5px', borderRadius: '3px',
            background: 'transparent',
            color: COLOR.textSecondary,
            opacity: narrowed ? 1 : 0.45,
            border: `1px solid ${COLOR.border}`,
            cursor: narrowed ? 'pointer' : 'default',
          }}
        >full face</button>
      </div>
      {/* 宣言されていないことを**述べる** — 空欄は「面全体」とも「言い忘れ」とも
          読めるので、どちらであるかを画面が言う (原則 #31)。 */}
      {!narrowed && (
        <div style={{ ...PICKER.label, minWidth: undefined, marginTop: '2px' }}>
          not narrowed — the whole face is sampled
        </div>
      )}
    </div>
  )
}

/** 領域 1 辺の数値欄 (0–1)。 */
function RegionInput({ label, value, onChange }) {
  return (
    <label style={{ ...PICKER.label, display: 'flex', alignItems: 'center', gap: '2px', minWidth: undefined }}>
      {label}
      {/* 数値欄の見た目は premise picker と同じ器を使う (PICKER.select) —
          同じ役割の入力に色を書き足すと、ADR-100 の ratchet が数える
          「宣言の外にある色」が増える。器を共有すれば増えない。 */}
      <input
        type="number" step="0.05" min="0" max="1"
        defaultValue={value}
        onChange={onChange}
        style={{ ...PICKER.select, flex: undefined, width: '42px', padding: '1px 2px' }}
      />
    </label>
  )
}

/** The lift words (ADR-157 D5). Keyed by the declared vocabulary — a new direction needs words. */
const LIFT_WORDS = Object.freeze({
  [LIFT_ALONG.REVERSE_APPROACH]: 'back out along the approach',
  [LIFT_ALONG.WORLD_UP]:         'straight up (+Z)',
})

/**
 * LiftLine — the selected object's lift declaration as a state (ADR-157 D5).
 * Declared → direction + distance; undeclared → says the lift phase will not be
 * judged and how to declare it; malformed → the reason (the run is blocked).
 */
export function LiftLine({ lift }) {
  if (!lift) return null
  const style = { fontSize: '10px', marginBottom: '5px' }
  // `data-declaration` rides every branch — the census counts where the lift is
  // shown, whatever its state (ADR-164 D1).
  return <div data-declaration="lift"><LiftState lift={lift} style={style} /></div>
}

function LiftState({ lift, style }) {
  if (lift.state === LIFT_STATE.DECLARED) {
    const words = LIFT_WORDS[lift.along]
    if (!words) throw new Error(`GraspDeclarations: 未宣言の引き上げの向き "${lift.along}" — LIFT_WORDS に行を足すこと`)
    return <div style={{ ...style, color: COLOR.textSecondary }}>lift out: {words}, {lift.distanceMm} mm</div>
  }
  if (lift.state === LIFT_STATE.MALFORMED) {
    return <div style={{ ...style, color: COLOR.cautionTone }}>lift: {lift.errors[0]}</div>
  }
  return (
    <div style={{ ...style, color: COLOR.textSecondary }}>
      lift: not declared — the lift phase will not be judged. Add{' '}
      <code style={{ color: COLOR.infoTone }}>"lift": {'{'} "along": "worldUp", "distance": 50 {'}'}</code> to the object.
    </div>
  )
}

// ── The relation's own panel (ADR-164 D2) ────────────────────────────────────

/**
 * RelationDeclarations — the body of the N panel for a selected grasp relation.
 *
 * Reads the relation from the derived projection (`context.graspRelations`) on
 * every render, not from the selection snapshot: a side of the relation can be
 * deleted or re-pointed while the relation stays selected, and the panel must say
 * the state it is in NOW (原則 #23).
 *
 * Four shapes, one per state (`GRASP_RELATION_STATE`) plus "nothing declared on
 * this object yet" — the way into a first declaration, reached by ▸ from the
 * grasp check or the object's panel. That last one is not a relation yet (the
 * Outliner lists only declared ones), and the panel says so instead of drawing an
 * empty row as if a relation existed (原則 #31).
 */
export function RelationDeclarations({ objectRef }) {
  const relations = useUIStore(s => s.context.graspRelations)
  const targets   = useUIStore(s => s.context.graspTargets)
  const robots    = useUIStore(s => s.context.robots)
  const callbacks = useUIStore(s => s.callbacks)
  if (!objectRef) return null

  const relation  = (relations?.list ?? []).find(r => r.objectRef === objectRef) ?? null
  const isTarget  = targets?.selectedRef === objectRef
  const targetRow = (targets?.list ?? []).find(t => t.ref === objectRef) ?? null
  const handKind  = robots?.hand?.hand?.kind ?? null
  const words     = relation ? relationWordsFor(relation.state) : null
  const objectLabel = relation?.objectLabel ?? targetRow?.label ?? objectRef
  const select = (id) => { if (id) callbacks.outlinerOnSelect?.(id) }

  return (
    <Section title="Grasp (object × hand)">
      <div data-testid="grasp-relation-title" style={{ fontSize: '11px', color: COLOR.textPrimary, marginBottom: '4px' }}>
        {words?.broken ? '⚠ ' : ''}{objectLabel} × {relation?.tcpLabel ?? 'hand not declared'}
      </div>
      {!relation && (
        <div style={{ fontSize: '10px', color: COLOR.textSecondary, marginBottom: '4px' }}>
          no grasp declared on this object yet — declare how to grasp it below; the relation
          appears in the Outliner&apos;s semantic side once it is declared
        </div>
      )}
      {words?.detail && (
        <div data-testid="grasp-relation-state" style={{ fontSize: '10px', color: words.broken ? COLOR.cautionTone : COLOR.textSecondary, marginBottom: '4px' }}>
          {words.detail}
        </div>
      )}

      {/* ▸ to both sides — the relation's panel is a crossing, not a dead end. */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', fontSize: '10px', marginBottom: '4px' }}>
        {(relation?.objectSceneId ?? targetRow?.sceneId) && (
          <LinkButton onClick={() => select(relation?.objectSceneId ?? targetRow?.sceneId)}>▸ {objectLabel}</LinkButton>
        )}
        {relation?.tcpSceneId && (
          <LinkButton onClick={() => select(relation.tcpSceneId)}>▸ {relation.tcpLabel}</LinkButton>
        )}
      </div>

      {relation && (
        <RelationHandEditor
          relation={relation}
          tcps={relations?.tcps ?? []}
          onName={(tcpRef) => callbacks.onSetGraspTcp?.(objectRef, tcpRef)}
        />
      )}

      {relation?.state === GRASP_RELATION_STATE.BROKEN_OBJECT ? (
        // Nothing to edit HOW to grasp — the object is gone. The way out is to
        // remove the declaration (undoable); re-pointing to another object is
        // not built yet (DEF-035, ADR-164 §俯瞰 4).
        <button type="button" data-testid="grasp-relation-remove"
          onClick={() => callbacks.onSetGraspFeature?.(objectRef, null)}
          style={{ ...PICKER.select, flex: undefined, cursor: 'pointer', marginTop: '4px' }}>
          remove this grasp declaration
        </button>
      ) : isTarget ? (
        <>
          <GraspSpecEditor
            targets={targets}
            gripperKind={handKind}
            onSet={(ref, feature) => callbacks.onSetGraspFeature?.(ref, feature)}
            onFocusSpec={callbacks.onFocusGraspSpec}
            onHoverFace={callbacks.onHoverGraspFace}
          />
          <LiftLine lift={targets?.lift ?? null} />
        </>
      ) : (
        <div style={{ fontSize: '10px', color: COLOR.textSecondary }}>
          {objectLabel} is not something the search can grasp (no graspable body)
        </div>
      )}
    </Section>
  )
}

/**
 * RelationHandEditor — WHICH hand the grasp is for (`graspFeature.tcp`). Not
 * filled in for the user, even with one tcp in the scene: the single tcp is
 * offered as one press, and pressing it is the declaration (ADR-164 §俯瞰 1).
 */
function RelationHandEditor({ relation, tcps, onName }) {
  const declared = relation.tcpRef !== null
  return (
    <div data-declaration="graspFeature.tcp" style={{ marginBottom: '6px' }}>
      <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ ...PICKER.label, minWidth: undefined }}>hand</span>
        {tcps.length === 0 && (
          <span style={PICKER.muted}>no robot tcp in the scene to name</span>
        )}
        {tcps.length === 1 && relation.tcpRef !== tcps[0].ref && (
          <FaceChip label={`name ${tcps[0].label}`} active={false} onClick={() => onName(tcps[0].ref)} />
        )}
        {(tcps.length > 1 || (tcps.length === 1 && relation.tcpRef === tcps[0].ref)) && (
          <select
            data-testid="grasp-relation-hand"
            value={tcps.some(t => t.ref === relation.tcpRef) ? relation.tcpRef : ''}
            onChange={(e) => onName(e.target.value || null)}
            style={PICKER.select}
          >
            <option value="">{declared ? `— ${relation.tcpLabel} (not in the scene) —` : '— not declared —'}</option>
            {tcps.map(t => <option key={t.ref} value={t.ref}>{t.label}</option>)}
          </select>
        )}
        {declared && (
          <FaceChip label="clear" active={false} onClick={() => onName(null)} />
        )}
      </div>
    </div>
  )
}

function LinkButton({ onClick, children }) {
  return (
    <button type="button" onClick={onClick}
      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: COLOR.infoTone, fontSize: '10px' }}>
      {children}
    </button>
  )
}
