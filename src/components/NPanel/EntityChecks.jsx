import { useUIStore } from '../../store/uiStore.js'
import { COLOR, rgba } from '../../theme/tokens.js'
import { Section } from './npanelShared.jsx'
import { CHECKS_KIND, checksDeclaration } from '../../context/DiscoverySummary.js'
import { graspEntryFor } from '../../view/EntityScopeChecks.js'

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

  const grasp = graspEntryFor(nPanelData)
  // Throws on an undeclared kind — same discipline as the HUD (原則 #31).
  const decl  = checksDeclaration(summary)

  return (
    <Section title="Checks (this entity)">
      {/* ── Selection-driven, document-free (ADR-085 / D5) ───────────────── */}
      <button
        onClick={() => (grasp.available
          ? callbacks.onOpenGrasp?.()
          // Blocked controls carry their reason — never a silent no-op (#11).
          : pushToast(grasp.reason, 'info'))}
        title={grasp.available ? 'Run grasp-search for this robot (no forms)' : grasp.reason}
        aria-disabled={!grasp.available || undefined}
        style={{
          width:        '100%',
          padding:      '4px 8px',
          background:   grasp.available ? rgba(COLOR.infoTone, 0.14) : 'transparent',
          border:       `1px solid ${grasp.available ? rgba(COLOR.infoTone, 0.47) : COLOR.border}`,
          borderRadius: '3px',
          color:        grasp.available ? COLOR.textPrimary : COLOR.textSecondary,
          fontSize:     '11px',
          fontFamily:   'inherit',
          textAlign:    'left',
          cursor:       grasp.available ? 'pointer' : 'help',
        }}
      >
        ◇ Grasp candidates…
      </button>
      {!grasp.available && (
        <div style={{ fontSize: '10px', color: COLOR.textSecondary, marginTop: '3px', lineHeight: '1.4' }}>
          {grasp.reason}
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
