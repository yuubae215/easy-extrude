import { useUIStore } from '../../store/uiStore.js'
import { COLOR, rgba } from '../../theme/tokens.js'
import { Section } from './npanelShared.jsx'
import { CHECKS_KIND, checksDeclaration } from '../../context/DiscoverySummary.js'
import { graspEntryFor, graspEntryRow } from '../../view/EntityScopeChecks.js'

/**
 * EntityChecks — entity-scope validation, beside the selected entity (ADR-105 D5).
 *
 * ## The axis is the SELECTION, not the document
 *
 * "Does it reach / does it collide / can it be grasped" is a question about the
 * thing you just put down, and the loop it belongs to is `place → see if it
 * reaches → put it down again`. That loop cannot close if the answer lives behind
 * "load a context document first" — so availability here is decided by **whether
 * an entity is selected and what kind it is**, never by `ctx.active` and never by
 * the presence of a document (enforced by `DiscoveryOutsideTheFloor.test.js`).
 *
 * ## What the first implementation measured (a recorded falsification)
 *
 * ADR-105's GSN carried the falsifiable half of D5 explicitly: *maybe only grasp
 * is document-free, and reach / interference need the doc's `acceptance`*. The
 * split is decided by what `projectChecks()` reads — and it reads
 * `doc.acceptance` joined with `validatorResult.checkResults`. **So the falsifying
 * case is the real one:**
 *
 *   - **Grasp candidates** are selection-driven and document-free — ADR-085 already
 *     made `onOpenGrasp` a one-click, form-free entry (it auto-adopts a robot-cell
 *     starter when nothing is loaded). One click from a selected robot frame.
 *   - **Reach / interference** are *declared checks*, so they are only as present as
 *     the document that declares them. They are not hidden here; they are stated
 *     through the same four-way union the HUD uses (ADR-105 D3), so "nobody
 *     declared a reach check" never reads as "reach is fine".
 *
 * That is the honest outcome, not a compromise: the two are different kinds of
 * fact, and pretending otherwise is what put the KPI in the most document-bound
 * place on screen in the first place.
 */

export function EntityChecks() {
  const nPanelData = useUIStore(s => s.nPanelData)
  const summary    = useUIStore(s => s.context.checksSummary)
  const callbacks  = useUIStore(s => s.callbacks)
  const pushToast  = useUIStore(s => s.actions.pushToast)
  // The scene's robot roster (ADR-090) decides WHICH zero this is when nothing
  // is selected — "pick a robot" and "there is no robot" are different facts and
  // must not share one sentence (ADR-110 D4).
  const robotCardinality = useUIStore(s => s.context.robots.cardinality)
  // A live search owns its own subject (ADR-130 D1). Read the slice that says a
  // search IS open, and the subject it is about — without them this row keeps
  // re-litigating "which robot" against a selection the run does not consult,
  // and the walkthrough's own next step (choose the object) fires the gate.
  const liveSearch   = useUIStore(s => s.context.grasp != null)
  const subjectLabel = useUIStore(s =>
    s.context.robots.list.find(r => r.id === s.context.robots.selectedId)?.label ?? null)

  const grasp = graspEntryFor(nPanelData, { robotCardinality, liveSearch, subjectLabel })
  // Throws on an undeclared kind — the row's behaviour is a table, not an `if`
  // chain that can silently fall through to "blocked" (ADR-130 D3 / 原則 #31).
  const row   = graspEntryRow(grasp)
  // Throws on an undeclared kind — same discipline as the HUD (原則 #31).
  const decl  = checksDeclaration(summary)

  return (
    // The slot is PERMANENT (原則 #15). With nothing selected the section is no
    // longer "this entity", so the title says what it is actually about rather
    // than naming an entity that is not there.
    <Section title={nPanelData ? 'Checks (this entity)' : 'Checks'}>
      {/* ── Selection-driven, document-free (ADR-085 / D5) ───────────────── */}
      <button
        onClick={() => (row.press === 'open'
          ? callbacks.onOpenGrasp?.()
          // Blocked controls carry their reason — never a silent no-op (#11).
          : pushToast(grasp.reason, 'info'))}
        title={row.pressable ? 'Run grasp-search for this robot (no forms)' : grasp.reason}
        aria-disabled={!row.pressable || undefined}
        style={{
          width:        '100%',
          padding:      '4px 8px',
          background:   row.pressable ? rgba(COLOR.infoTone, 0.14) : 'transparent',
          border:       `1px solid ${row.pressable ? rgba(COLOR.infoTone, 0.47) : COLOR.border}`,
          borderRadius: '3px',
          color:        row.pressable ? COLOR.textPrimary : COLOR.textSecondary,
          fontSize:     '11px',
          fontFamily:   'inherit',
          textAlign:    'left',
          cursor:       row.pressable ? 'pointer' : 'help',
        }}
      >
        ◇ Grasp candidates…
      </button>
      {/* One caption slot, whatever the kind puts in it: a blocked reason, or
          the live search's subject. The slot is fixed (原則 #15); what varies is
          the sentence the declaration table hands over. */}
      {row.caption && (
        <div style={{ fontSize: '10px', color: COLOR.textSecondary, marginTop: '3px', lineHeight: '1.4' }}>
          {row.caption}
        </div>
      )}

      {/* ── Document-declared checks (reach / interference / …) ───────────── */}
      <div style={{ marginTop: '7px', fontSize: '10px', color: COLOR.textSecondary, lineHeight: '1.45' }}>
        <span style={{
          color: summary.kind === CHECKS_KIND.ALL_PASS ? COLOR.factTone
               : summary.kind === CHECKS_KIND.FAILING  ? COLOR.cautionTone
               : COLOR.textSecondary,
          fontWeight: 'bold',
        }}>
          {decl.headline}
        </span>
        {' — '}
        {/* Reach / interference are DECLARED checks, so an absent check is not a
            passing one. The union says which zero this is (ADR-105 D3). */}
        Reach / interference come from the document’s acceptance checks.
        {decl.exit && (
          <>
            {' '}
            <button
              onClick={() => (summary.kind === CHECKS_KIND.UNEXAMINED
                ? callbacks.onOpenTemplateGallery?.()
                : callbacks.onContextNegotiate?.())}
              style={{
                padding: 0, background: 'transparent', border: 'none',
                color: COLOR.textSecondary, fontSize: '10px', fontFamily: 'inherit',
                cursor: 'pointer', textDecoration: 'underline dotted',
              }}
            >
              {decl.exit}
            </button>
          </>
        )}
      </div>
    </Section>
  )
}
