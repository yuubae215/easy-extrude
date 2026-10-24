/**
 * ArrangementStatusMath — the declared relations (ADR-168) shown where they
 * point: the picture primitives and the panel rows of S1b (原則 #33-4 — a word
 * is only sayable once you can see what it points at, before anything runs).
 *
 * ## What is drawn for each word (`CONFIRMATION_BY_WORD`)
 *
 * The population is the domain vocabulary (`domain/arrangement.js`: every
 * declarable contact and direction), not this table — the census
 * (`ArrangementConfirmation.test.js`) counts the words with no picture and the
 * rows for words the domain no longer has. The table is the machine half of the
 * right-hand column of `docs/SPATIAL_RELATION_MODEL.md` §3.
 *
 * ## It shows the decided facts, it decides none
 *
 * Every number here comes from `layout/ArrangementReport.reportArrangements`:
 * the state the domain read, the status it decided (match / mismatch /
 * undeclared), the conflicts it named, and the poses it read them from
 * (`bodies` / `viewers`). This module only places them. No score, no total,
 * no ranking.
 *
 * ## The picture says where, the mark says how it stands (C4 — party 2026-10-24)
 *
 * Two facts, two channels (原則 #33-1 on the screen):
 *
 *   - every picture of a word (patch, separation, face, guide, viewer) is drawn
 *     in ONE neutral role, `PICTURE_TONE` — it says where the word points and
 *     judges nothing (ADR-152 D6 keeps holding here);
 *   - the status is a separate MARK (✓ / ✗ / –, so it reads without colour),
 *     and only a mismatch or a claim conflict is coloured, in `cautionTone` —
 *     the one fact the party wants found (「不一致は画面で必ず見える」— D4).
 *
 * A match is NOT green: a mismatch does not say the layout is the wrong side
 * (the declaration may be), and D5 decides neither — a green "match" would.
 *
 * ## Which relations are drawn (the focus)
 *
 *   focus = [refs]  → every relation that names ANY of them (subject or side) —
 *                     N selected things draw the union (party 2026-10-24)
 *   focus = []      → every relation with a mismatch or a claim conflict, so a
 *                     broken relation is on screen without selecting anything
 *
 * Pure and THREE-free (runs in the bare `node --test` lane). Positions are
 * `[x, y, z]` in the scene's units (mm), the shape the view's primitives take.
 *
 * @module view/ArrangementStatusMath
 */
import { AXIS_STATUS, CONTACTS, FACE_TOWARD, ABSOLUTE_TOWARD, RELATIVE_DIRS, frameOfToward } from '../domain/arrangement.js'
import { contactPatches, OBSERVED_CONTACT } from '../domain/arrangementGeometry.js'
import { rotateVec3 } from '../domain/rotateVec3.js'

/**
 * Each declarable word → the picture that shows what it points at.
 * Mirrors `docs/SPATIAL_RELATION_MODEL.md` §3 (確かめる手段).
 */
export const CONFIRMATION_BY_WORD = Object.freeze({
  touching: { picture: 'contactPatch',  where: 'the surfaces in contact, filled on the partner' },
  apart:    { picture: 'separation',    where: 'a line between the two, with the gap (a lower bound, ≥)' },
  '+x':     { picture: 'facePaint',     where: 'the partner\'s +x face, outlined and named' },
  '-x':     { picture: 'facePaint',     where: 'the partner\'s -x face, outlined and named' },
  '+y':     { picture: 'facePaint',     where: 'the partner\'s +y face, outlined and named' },
  '-y':     { picture: 'facePaint',     where: 'the partner\'s -y face, outlined and named' },
  '+z':     { picture: 'facePaint',     where: 'the partner\'s +z face, outlined and named' },
  '-z':     { picture: 'facePaint',     where: 'the partner\'s -z face, outlined and named' },
  above:    { picture: 'verticalGuide', where: 'a vertical line from the partner\'s top to the subject\'s bottom' },
  below:    { picture: 'verticalGuide', where: 'a vertical line from the partner\'s bottom to the subject\'s top' },
  front:    { picture: 'viewerAxes',    where: 'the viewer, its facing arrow, and its front / back line through the partner' },
  back:     { picture: 'viewerAxes',    where: 'the viewer, its facing arrow, and its front / back line through the partner' },
  left:     { picture: 'viewerAxes',    where: 'the viewer, its facing arrow, and its left / right line through the partner' },
  right:    { picture: 'viewerAxes',    where: 'the viewer, its facing arrow, and its left / right line through the partner' },
})

/** Every declarable word of the domain — the census population. */
export const DECLARABLE_WORDS = Object.freeze([...CONTACTS, ...FACE_TOWARD, ...ABSOLUTE_TOWARD, ...RELATIVE_DIRS])

/**
 * The picture row of a word. Throws on a word with no row — a word nobody gave
 * a picture is not drawn as nothing (原則 #31).
 * @param {string} word
 */
export function confirmationFor(word) {
  const row = CONFIRMATION_BY_WORD[word]
  if (!row) throw new Error(`ArrangementStatusMath: "${word}" has no confirming picture — add a row to CONFIRMATION_BY_WORD (ADR-168 S1b)`)
  return row
}

/** The one role every picture of a word is drawn in — it judges nothing (C4). */
export const PICTURE_TONE = 'entityDefault'

/** The role of anything that names a claim conflict (C4 — the same as a mismatch). */
export const CONFLICT_TONE = 'cautionTone'

/**
 * Status → the colour ROLE of its MARK (a `COLOR` key — ADR-100: roles, never
 * new colours). Only a mismatch is coloured; a match reads as plain text (C4).
 */
export const STATUS_TONE = Object.freeze({
  [AXIS_STATUS.MATCH]:      'textPrimary',
  [AXIS_STATUS.MISMATCH]:   'cautionTone',
  [AXIS_STATUS.UNDECLARED]: 'textSecondary',
})

/** The tone role of a status. Throws on an undeclared status (原則 #31). @param {string} status */
export function toneFor(status) {
  const tone = STATUS_TONE[status]
  if (!tone) throw new Error(`ArrangementStatusMath: status "${status}" has no tone (ADR-168 D4)`)
  return tone
}

/** The mark a status reads as in text. */
export const STATUS_MARK = Object.freeze({
  [AXIS_STATUS.MATCH]:      '✓',
  [AXIS_STATUS.MISMATCH]:   '✗',
  [AXIS_STATUS.UNDECLARED]: '–',
})

// ── words as text ────────────────────────────────────────────────────────────

/**
 * A declared direction as text: a face or above/below as itself, a relative
 * direction with the viewer it is seen from (the viewer is part of the word —
 * ADR-168 D2).
 * @param {unknown} toward
 * @returns {string|null}
 */
export function towardText(toward) {
  if (toward === undefined || toward === null) return null
  return frameOfToward(toward) === 'relative'
    ? `${/** @type {any} */ (toward).dir} (seen by ${/** @type {any} */ (toward).viewer})`
    : /** @type {string} */ (toward)
}

/**
 * What the layout says on the axis a declared direction asks about — the
 * observed side of the comparison, in the same frame of reference.
 * @param {unknown} toward  declared (or undefined)
 * @param {object} state    a side's state from the report
 */
export function observedTowardText(toward, state) {
  const touching = state.contact === OBSERVED_CONTACT.TOUCHING
  if (toward === undefined || toward === null) {
    return touching ? state.faces.join(' ') : (state.vertical ?? 'level with it')
  }
  const frame = frameOfToward(toward)
  if (frame === 'intrinsic') return touching ? state.faces.join(' ') : `not touching (${state.contact})`
  if (touching) return `touching ${state.faces.join(' ')}`
  if (frame === 'absolute') return state.vertical ?? 'level with it'
  return (state.relative ?? []).join(', ') || 'neither side'
}

/** A claimed value on an axis, as text — a conflict names claims on either axis. */
export function claimText(axis, value) {
  return axis === 'toward' ? towardText(value) : String(value)
}

/** The observed contact as text (the gap is a lower bound — DEF-072). */
export function observedContactText(state) {
  if (state.contact === OBSERVED_CONTACT.APART && Number.isFinite(state.gap)) return `apart (≥ ${round(state.gap)} mm)`
  return state.contact
}

/** Mobility, looked up from jointType (ADR-168 D1), as text. */
export function mobilityText(mobility) {
  if (mobility?.kind === 'declared') return String(mobility.jointType)
  if (mobility?.kind === 'contradiction') return `contradiction (${mobility.count} joints)`
  return 'undeclared'
}

const round = (v) => Math.round(v * 10) / 10

// ── which relations ──────────────────────────────────────────────────────────

const involves = (report, ref) => report.subject === ref || report.sides.some(s => s.of === ref)
const involvesAny = (report, refs) => refs.some(ref => involves(report, ref))
const hasMismatch = (report) => report.sides.some(s =>
  s.status.contact === AXIS_STATUS.MISMATCH || s.status.toward === AXIS_STATUS.MISMATCH)
const inConflict = (report, conflicts) => conflicts.some(c => c.between.includes(report.ref))

/**
 * The relations a focus brings on screen (see the module doc).
 * @param {{reports: object[], conflicts: object[]}} result
 * @param {readonly string[]} focusRefs  the selected things' layout refs ([] = none)
 */
export function focusedReports(result, focusRefs) {
  const reports = result?.reports ?? []
  const conflicts = result?.conflicts ?? []
  return focusRefs.length > 0
    ? reports.filter(r => involvesAny(r, focusRefs))
    : reports.filter(r => hasMismatch(r) || inConflict(r, conflicts))
}

// ── the picture ──────────────────────────────────────────────────────────────

const arr = (v) => [v.x, v.y, v.z]
const IDENTITY = Object.freeze({ x: 0, y: 0, z: 0, w: 1 })

/** The 4 world corners of one face of a body's outer box, loop order. */
export function faceCorners(body, face) {
  const axis = face[1]
  const sign = face[0] === '+' ? 1 : -1
  const half = { x: body.size.x / 2, y: body.size.y / 2, z: body.size.z / 2 }
  const [b, c] = ['x', 'y', 'z'].filter(k => k !== axis)
  const q = body.rotation ?? IDENTITY
  const at = (sb, sc) => {
    const local = { x: 0, y: 0, z: 0, [axis]: sign * half[axis], [b]: sb * half[b], [c]: sc * half[c] }
    const r = rotateVec3(local, q)
    return [body.center.x + r.x, body.center.y + r.y, body.center.z + r.z]
  }
  return [at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)]
}

/** World z-range of a body (via its corners — a rotated box too). */
function zRange(body) {
  const zs = [-1, 1].flatMap(sx => [-1, 1].flatMap(sy => [-1, 1].map(sz =>
    body.center.z + rotateVec3({ x: sx * body.size.x / 2, y: sy * body.size.y / 2, z: sz * body.size.z / 2 }, body.rotation ?? IDENTITY).z)))
  return { min: Math.min(...zs), max: Math.max(...zs) }
}

/**
 * @typedef {{kind: 'contactPatch', tone: string, corners: number[][]}
 *         | {kind: 'separation', tone: string, from: number[], to: number[], caption: string}
 *         | {kind: 'facePaint', tone: string, corners: number[][], caption: string, at: number[]}
 *         | {kind: 'verticalGuide', tone: string, from: number[], to: number[], caption: string}
 *         | {kind: 'viewerAxes', tone: string, viewer: number[], facing: number[],
 *            lines: number[][][], quadrantLabels: Array<{text: string, at: number[]}>}
 *         | {kind: 'caption', tone: string, text: string, at: number[], row: number}} PictureItem
 *
 * A caption's `at` is the top of the thing it is about; `row` stacks the
 * captions of one thing upward in SCREEN units (the view's label height), so
 * they neither overlap when zoomed out nor drift apart when zoomed in (原則 #27).
 */

/**
 * The primitives that show the focused relations (see the module doc).
 *
 * @param {{reports: object[], conflicts: object[], bodies: Record<string, any>, viewers: Record<string, any>}|null} result
 * @param {readonly string[]} focusRefs
 * @returns {{items: PictureItem[], extent: number}|null}  null when nothing is drawn
 */
export function arrangementPicture(result, focusRefs) {
  const shown = focusedReports(result, focusRefs)
  if (shown.length === 0) return null
  const { bodies, viewers } = result
  const conflicts = result.conflicts ?? []

  const sizes = shown.flatMap(r => [r.subject, ...r.sides.map(s => s.of)])
    .map(ref => bodies[ref]).filter(Boolean)
    .map(b => Math.max(b.size.x, b.size.y, b.size.z))
  const extent = Math.max(...sizes, 1)

  /** @type {PictureItem[]} */
  const items = []
  /** captions stacked so far on each thing (ref → count) */
  const rows = new Map()
  const nextRow = (ref) => { const r = rows.get(ref) ?? 0; rows.set(ref, r + 1); return r }
  for (const report of shown) {
    const subject = bodies[report.subject]
    const top = zRange(subject).max
    report.sides.forEach((side) => {
      const partner = bodies[side.of]
      // Contact — what the layout has. Neutral: the mark below says how it stands.
      if (side.state.contact === OBSERVED_CONTACT.TOUCHING) {
        for (const p of contactPatches(subject, partner)) {
          items.push({ kind: 'contactPatch', tone: PICTURE_TONE, corners: p.corners.map(arr) })
        }
      } else {
        items.push({
          kind: 'separation', tone: PICTURE_TONE, from: arr(subject.center), to: arr(partner.center),
          caption: observedContactText(side.state),
        })
      }

      // Direction — only when declared: the picture of the declared word.
      const toward = side.declared.toward
      if (toward !== undefined) {
        const frame = frameOfToward(toward)
        if (frame === 'intrinsic') {
          const corners = faceCorners(partner, toward)
          const at = [0, 1, 2].map(k => corners.reduce((s, c) => s + c[k], 0) / 4)
          items.push({ kind: 'facePaint', tone: PICTURE_TONE, corners, caption: `${toward} of ${side.of}`, at })
        } else if (frame === 'absolute') {
          const pz = zRange(partner)
          const sz = zRange(subject)
          const from = [subject.center.x, subject.center.y, toward === 'above' ? pz.max : pz.min]
          const to = [subject.center.x, subject.center.y, toward === 'above' ? sz.min : sz.max]
          items.push({ kind: 'verticalGuide', tone: PICTURE_TONE, from, to, caption: `${toward} ${side.of}` })
        } else {
          items.push(viewerAxesItem(viewers[toward.viewer], partner, toward.viewer, extent, PICTURE_TONE))
        }
      }

      // One caption per side, at the subject: who said it and how it stands.
      const marks = `contact ${STATUS_MARK[side.status.contact]} · direction ${STATUS_MARK[side.status.toward]}`
      items.push({
        kind: 'caption',
        tone: hasMismatch({ sides: [side] }) ? STATUS_TONE[AXIS_STATUS.MISMATCH] : STATUS_TONE[AXIS_STATUS.MATCH],
        text: `${report.by}: ${report.subject} → ${side.of}  ${marks}`,
        at: [subject.center.x, subject.center.y, top],
        row: nextRow(report.subject),
      })
    })
  }

  // Claim conflicts between the shown relations: named, not resolved.
  const shownRefs = new Set(shown.map(r => r.ref))
  for (const c of conflicts) {
    if (!c.between.some(ref => shownRefs.has(ref))) continue
    const subject = bodies[c.subject]
    if (!subject) continue
    items.push({
      kind: 'caption', tone: CONFLICT_TONE,
      text: `conflict on ${c.axis}: ${c.claims.map(k => `${k.by} says ${claimText(c.axis, k.value)}`).join(' / ')}`,
      at: [subject.center.x, subject.center.y, zRange(subject).max],
      row: nextRow(c.subject),
    })
  }
  return { items, extent }
}

/**
 * The viewer drawn where it stands: its position, its facing arrow (+X), and
 * the two lines through the partner's centre that `observeRelative` reads
 * against — along the viewer's +X (left | right of it) and +Y (front | back of
 * it) — with the four sides named as the viewer would say them.
 */
function viewerAxesItem(viewer, partner, viewerRef, extent, tone) {
  const q = viewer.rotation ?? IDENTITY
  const fx = rotateVec3({ x: 1, y: 0, z: 0 }, q)
  const fy = rotateVec3({ x: 0, y: 1, z: 0 }, q)
  const c = partner.center
  const L = extent * 0.9
  const along = (d, s) => [c.x + d.x * s, c.y + d.y * s, c.z + d.z * s]
  return {
    kind: 'viewerAxes', tone,
    viewer: arr(viewer.position),
    facing: [viewer.position.x + fx.x * extent * 0.6, viewer.position.y + fx.y * extent * 0.6, viewer.position.z + fx.z * extent * 0.6],
    lines: [[along(fx, -L), along(fx, L)], [along(fy, -L), along(fy, L)]],
    quadrantLabels: [
      { text: `front (${viewerRef})`, at: along(fx, -L) },
      { text: 'back',  at: along(fx, L) },
      { text: 'left',  at: along(fy, L) },
      { text: 'right', at: along(fy, -L) },
    ],
  }
}

// ── the panel ────────────────────────────────────────────────────────────────

/**
 * What the Relations section can be about. Each kind declares its headline;
 * an undeclared kind throws (原則 #31 — which zero this is, is said, not inferred).
 */
export const PANEL_KIND = Object.freeze({
  NO_DOCUMENT:   'no-document',
  NONE_DECLARED: 'none-declared',
  INVALID:       'invalid',
  LISTED:        'listed',
})

const PANEL_HEADLINE = Object.freeze({
  [PANEL_KIND.NO_DOCUMENT]:   () => 'No document — relations are declared in a context document (arrangements).',
  [PANEL_KIND.NONE_DECLARED]: () => 'The document declares no relations.',
  [PANEL_KIND.INVALID]:       (m) => `${m.errors.length} relation error${m.errors.length === 1 ? '' : 's'} — not read against the layout.`,
  [PANEL_KIND.LISTED]:        (m) => `${m.summary.relations} relation${m.summary.relations === 1 ? '' : 's'} · ${m.summary.mismatched} mismatched · ${m.summary.conflicts} conflict${m.summary.conflicts === 1 ? '' : 's'}`,
})

/** The headline of a panel model. Throws on an undeclared kind. */
export function panelHeadline(model) {
  const h = PANEL_HEADLINE[model?.kind]
  if (!h) throw new Error(`ArrangementStatusMath: panel kind "${model?.kind}" has no headline (原則 #31)`)
  return h(model)
}

/**
 * The Relations section's model.
 *
 * @param {{errors: string[], reports: object[], conflicts: object[]}|null} result  null = no document
 * @param {readonly string[]} focusRefs  the selected things' layout refs ([] = none)
 */
export function arrangementPanel(result, focusRefs) {
  if (!result) return { kind: PANEL_KIND.NO_DOCUMENT, focusRefs, rows: [], conflicts: [], errors: [], summary: null }
  if (result.errors.length > 0) {
    return { kind: PANEL_KIND.INVALID, focusRefs, rows: [], conflicts: [], errors: result.errors, summary: null }
  }
  if (result.reports.length === 0) {
    return { kind: PANEL_KIND.NONE_DECLARED, focusRefs, rows: [], conflicts: [], errors: [], summary: null }
  }
  const summary = {
    relations:  result.reports.length,
    mismatched: result.reports.filter(hasMismatch).length,
    conflicts:  result.conflicts.length,
  }
  const listed = focusRefs.length > 0 ? result.reports.filter(r => involvesAny(r, focusRefs)) : result.reports
  const rows = listed.map(r => ({
    ref: r.ref, by: r.by, subject: r.subject,
    mismatch: hasMismatch(r),
    conflict: inConflict(r, result.conflicts),
    sides: r.sides.map(s => ({
      of: s.of,
      contact: { declared: s.declared.contact ?? null, observed: observedContactText(s.state), status: s.status.contact },
      toward:  { declared: towardText(s.declared.toward), observed: observedTowardText(s.declared.toward, s.state), status: s.status.toward },
      mobility: mobilityText(s.mobility),
    })),
  }))
  const conflicts = result.conflicts
    .filter(c => focusRefs.length === 0 || focusRefs.includes(c.subject) || focusRefs.includes(c.of))
    .map(c => ({
      subject: c.subject, of: c.of, axis: c.axis,
      claims: c.claims.map(k => ({ ref: k.ref, by: k.by, value: claimText(c.axis, k.value) })),
    }))
  return { kind: PANEL_KIND.LISTED, focusRefs, rows, conflicts, errors: [], summary }
}
