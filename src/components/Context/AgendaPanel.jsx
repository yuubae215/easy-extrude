import { useState } from 'react'
import { useUIStore } from '../../store/uiStore.js'
import { AGENDA_SOURCE, AGENDA_STATE } from '../../context/Agenda.js'
import { COLOR } from '../../theme/tokens.js'

// Roles, not literals (ADR-100): a settled item and a passing check are the same
// state and must not drift apart because two panels each picked their own green.
const TONE = {
  settled:  COLOR.factTone,      // a result is settled
  pending:  COLOR.cautionTone,   // on the floor / needs care
  muted:    COLOR.textSecondary,
  text:     COLOR.textPrimary,
  border:   COLOR.border,
  sunken:   COLOR.surfaceSunken,
}
const ALPHA = { settled: 'rgba(34,197,94,0.15)', pending: 'rgba(217,178,60,0.06)' }

/**
 * AgendaPanel — the floor: who holds which key, what is on the table, and what
 * the record says (ADR-104 D1 / D3 / D4 / D5).
 *
 * Two parts, in the order the questions arise. (The three counters were a third
 * part until ADR-105 moved them to the header — see the note above `STATE_STYLE`.)
 *
 *   1. **Keyring** — which actors you may write as. A row of toggles, not a
 *      selector: holding two keys is one person covering two roles, and a
 *      selector would force a switch, which is a mode (ADR-104 D1). Zero keys
 *      is a legitimate, displayed state — everything owned becomes propose-only
 *      rather than either "all editable" or "nothing editable".
 *   2. **Rows** — tabled conflicts ∪ live proposals, each with the action its
 *      kind allows. A disabled action always carries its reason, because the
 *      reason and the flag come back from the same predicate call
 *      (`onAgendaGuards` → `approvalGuards` / `settlementGuards`) — never from a
 *      second derivation next to the button (PHILOSOPHY #11 / ADR-065).
 *
 * Presentation only: this panel derives nothing about permissions and stores
 * nothing about staleness. It renders what the pure layer decided.
 */

const STATE_STYLE = {
  [AGENDA_STATE.OPEN]:             { label: 'on the floor', color: TONE.pending },
  [AGENDA_STATE.SETTLED]:          { label: 'settled',      color: TONE.settled },
  [AGENDA_STATE.CLOSED_UNDECIDED]: { label: 'undecided',    color: TONE.muted },
}

// The three counters used to be drawn HERE, and only here (ADR-104 D4). ADR-105
// moved them to `Chrome/DiscoveryCounters.jsx`, because this file renders inside
// `ContextLayer`, which starts with `if (!ctx.active) return null` — the counter
// that tells you whether to enter the floor did not exist unless you were already
// standing on it. The floor is the container for *resolution*; the aggregate that
// says whether resolution is needed is discovery, and discovery is not the floor's
// (ADR-105 D1 / `02-grouping-criteria.md`).

function Keyring({ actors, keyring, onGrant, onRevoke }) {
  return (
    <div style={{ padding: '6px 10px', borderBottom: `1px solid ${TONE.border}` }}>
      <div style={{ fontSize: '10px', color: TONE.muted, marginBottom: '4px' }}>
        Keys you hold{' '}
        <span title="A guard against changing a colleague's claim by accident — not authentication. The document is readable and editable outside this app (ADR-104 D6).">ⓘ</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
        {actors.map(a => {
          const held = keyring.includes(a.ref)
          return (
            <button
              key={a.ref}
              onClick={() => (held ? onRevoke(a.ref) : onGrant(a.ref))}
              title={held ? `Release ${a.ref}'s key` : `Take ${a.ref}'s key`}
              style={{
                background: held ? ALPHA.settled : 'transparent',
                border: `1px solid ${held ? `${TONE.settled}77` : TONE.border}`,
                color: held ? TONE.settled : TONE.muted,
                borderRadius: '3px', padding: '2px 6px', fontSize: '11px', cursor: 'pointer',
              }}
            >
              {held ? '🔑' : '○'} {a.ref}
            </button>
          )
        })}
      </div>
      {keyring.length === 0 && (
        // Not an error, and not silently corrected: the honest third answer.
        <div style={{ fontSize: '10px', color: TONE.pending, marginTop: '4px' }}>
          No keys held — changes to owned claims become proposals.
        </div>
      )}
    </div>
  )
}

function DraftForm({ draft, actors, keyring, onSubmit, onDiscard }) {
  const [why, setWhy] = useState('')
  // Propose as the first key you hold, or as the first actor when you hold none
  // — you can always propose, which is the point of the third state.
  const [by, setBy] = useState(keyring[0] ?? actors[0]?.ref ?? '')

  return (
    <div style={{ padding: '8px 10px', borderBottom: `1px solid ${TONE.border}`, background: ALPHA.pending }}>
      <div style={{ fontSize: '11px', color: TONE.pending, fontWeight: 'bold' }}>Proposal pending</div>
      <div style={{ fontSize: '10px', color: TONE.muted, margin: '3px 0 6px' }}>{draft.reason}</div>
      <div style={{ fontSize: '10px', color: TONE.text, marginBottom: '6px' }}>
        {draft.target.ref}: <code style={{ color: TONE.muted }}>{JSON.stringify(draft.from?.region ?? draft.from?.interval ?? draft.from)}</code>
        {' → '}
        <code style={{ color: TONE.text }}>{JSON.stringify(draft.to?.region ?? draft.to?.interval ?? draft.to)}</code>
      </div>
      <select
        value={by} onChange={e => setBy(e.target.value)}
        style={{ width: '100%', marginBottom: '4px', background: TONE.sunken, color: TONE.text, border: `1px solid ${TONE.border}`, fontSize: '11px', padding: '2px' }}
      >
        {actors.map(a => <option key={a.ref} value={a.ref}>{a.ref}</option>)}
      </select>
      <textarea
        value={why} onChange={e => setWhy(e.target.value)}
        placeholder="Why do you want this? (becomes the receipt's rationale)"
        rows={2}
        style={{ width: '100%', boxSizing: 'border-box', background: TONE.sunken, color: TONE.text, border: `1px solid ${TONE.border}`, fontSize: '11px', padding: '3px', resize: 'vertical' }}
      />
      <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
        <button
          onClick={() => onSubmit(why, by)}
          disabled={!why.trim()}
          // The disabled state names its own cure rather than just going grey.
          title={why.trim() ? 'Put this on the floor' : 'A proposal carries a reason — it becomes the receipt (ADR-104 D3)'}
          style={{
            flex: 1, background: why.trim() ? ALPHA.settled : 'transparent',
            border: `1px solid ${why.trim() ? `${TONE.settled}77` : TONE.border}`,
            color: why.trim() ? TONE.settled : TONE.muted,
            borderRadius: '3px', padding: '3px', fontSize: '11px',
            cursor: why.trim() ? 'pointer' : 'not-allowed',
          }}
        >
          Propose
        </button>
        <button
          onClick={onDiscard}
          style={{ background: 'transparent', border: `1px solid ${TONE.border}`, color: TONE.muted, borderRadius: '3px', padding: '3px 8px', fontSize: '11px', cursor: 'pointer' }}
        >
          Discard
        </button>
      </div>
    </div>
  )
}

function AgendaRow({ row, guards, actors, callbacks }) {
  const style = STATE_STYLE[row.state] ?? STATE_STYLE[AGENDA_STATE.OPEN]
  const isProposal = row.source === AGENDA_SOURCE.PROPOSAL
  const open = row.state === AGENDA_STATE.OPEN
  const blocked = !guards?.ok
  const reason = guards?.reasons?.join(' ') ?? ''

  return (
    <div style={{ padding: '6px 10px', borderBottom: `1px solid ${TONE.border}` }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
        <span style={{ fontSize: '10px', color: TONE.muted }}>{isProposal ? '✎' : '⚑'}</span>
        <span style={{ fontSize: '11px', color: TONE.text }}>{row.subject}</span>
        <span style={{ marginLeft: 'auto', fontSize: '10px', color: style.color }}>{style.label}</span>
      </div>
      <div style={{ fontSize: '10px', color: TONE.muted, marginTop: '2px' }}>
        {isProposal ? 'proposed by' : 'tabled by'} {row.by ?? '—'}
        {row.supersedes && <> · supersedes {row.supersedes}</>}
        {/* A tabled conflict R6 no longer derives stays on the floor: tabling it
            was a human act. What changed is that there is nothing left to settle. */}
        {!isProposal && !row.live && <> · <span style={{ color: TONE.pending }}>no longer derived</span></>}
      </div>

      {open && (
        <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
          <button
            onClick={() => (isProposal ? callbacks.onProposalApprove?.(row.ref) : callbacks.onAgendaSettle?.(row.ref))}
            disabled={blocked}
            title={blocked ? reason : (isProposal ? 'Approve: the claim moves and the receipt is written together' : 'Settle: needs every involved party’s key')}
            style={{
              background: blocked ? 'transparent' : ALPHA.settled,
              border: `1px solid ${blocked ? TONE.border : `${TONE.settled}77`}`,
              color: blocked ? TONE.muted : TONE.settled,
              borderRadius: '3px', padding: '2px 8px', fontSize: '11px',
              cursor: blocked ? 'not-allowed' : 'pointer',
            }}
          >
            {isProposal ? 'Approve' : 'Settle'}
          </button>
          <button
            onClick={() => (isProposal
              ? callbacks.onProposalWithdraw?.(row.ref)
              : callbacks.onAgendaClose?.(row.ref, actors[0]?.ref))}
            title={isProposal ? 'Withdraw — kept in the record' : 'Close undecided — not concluding is also a conclusion, and is recorded'}
            style={{ background: 'transparent', border: `1px solid ${TONE.border}`, color: TONE.muted, borderRadius: '3px', padding: '2px 8px', fontSize: '11px', cursor: 'pointer' }}
          >
            {isProposal ? 'Withdraw' : 'Close undecided'}
          </button>
        </div>
      )}

      {/* The reason travels with the disabled control, always. */}
      {open && blocked && (
        <div style={{ fontSize: '10px', color: TONE.pending, marginTop: '4px', lineHeight: '1.4' }}>{reason}</div>
      )}
    </div>
  )
}

export function AgendaPanel() {
  const ctx       = useUIStore(s => s.context)
  const callbacks = useUIStore(s => s.callbacks)
  const grantKey  = useUIStore(s => s.actions.contextGrantKey)
  const revokeKey = useUIStore(s => s.actions.contextRevokeKey)

  const rows    = ctx.agendaRows ?? []
  const actors  = ctx.actors ?? []
  const keyring = ctx.keyring ?? []

  return (
    <div>
      <Keyring actors={actors} keyring={keyring} onGrant={grantKey} onRevoke={revokeKey} />

      {ctx.proposalDraft && (
        <DraftForm
          draft={ctx.proposalDraft}
          actors={actors}
          keyring={keyring}
          onSubmit={(why, by) => callbacks.onProposalSubmitDraft?.(why, by)}
          onDiscard={() => callbacks.onProposalDiscardDraft?.()}
        />
      )}

      {rows.length === 0 ? (
        // "Nothing on the floor" is a result, stated. Removing the section
        // entirely would make an empty floor indistinguishable from a broken
        // projection (PHILOSOPHY #15 / #31).
        <div style={{ padding: '12px 10px', color: TONE.muted, fontSize: '11px', textAlign: 'center' }}>
          Nothing on the floor.<br />
          <span style={{ fontSize: '10px' }}>
            Conflicts are derived, not recorded — they start being history when somebody tables one.
          </span>
        </div>
      ) : rows.map(row => (
        <AgendaRow
          key={row.ref}
          row={row}
          // Asked per render, never cached: the verdict depends on the keyring
          // and on the current claim value, both of which move without this
          // panel being told (PHILOSOPHY #23 — the accessor owns its freshness).
          guards={callbacks.onAgendaGuards?.(row)}
          actors={actors}
          callbacks={callbacks}
        />
      ))}
    </div>
  )
}
