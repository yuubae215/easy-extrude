/**
 * ArrangementReport — the declared relations of a document read against its
 * layout (ADR-168 S1): each side's STATE (derived), STATUS (per axis) and
 * MOBILITY (looked up from `jointType`), plus the claim conflicts.
 *
 * Lives in `layout/` because it needs the layout's resolved poses
 * (`compileLayout` — strategies place unpositioned entities) and its ref scheme
 * (a constraint endpoint `work_1_origin` / `part_bin_floor` belongs to a Solid).
 * The vocabulary itself is `domain/arrangement.js`; this file only joins it to a
 * layout, so the dependency still points inward.
 *
 * Pure: input-immutable, no THREE, no DOM.
 *
 * @module layout/ArrangementReport
 */
import { compileLayout, buildRefMap } from './LayoutCompiler.js'
import {
  arrangementIssues, claimConflicts, mobilityBetween, sideStatus,
} from '../domain/arrangement.js'
import { observeContact, observeVertical, observeRelative } from '../domain/arrangementGeometry.js'
import { isViewerFrame, viewerFrameGap } from '../domain/viewerFrame.js'
import { sizeOfCorners } from '../domain/hollowBody.js'

/**
 * Which entity each ref of the layout belongs to: an entity is its own host,
 * a Solid's auto-Origin (`<ref>_origin`) and its user frames belong to the
 * Solid. The same ref scheme as `buildRefMap` (ADR-037).
 * @param {object[]} entities
 * @returns {Map<string, string>}
 */
export function hostByRef(entities) {
  const host = new Map()
  for (const e of entities ?? []) {
    if (!e || typeof e.ref !== 'string') continue
    host.set(e.ref, e.ref)
    if (e.type === 'Solid') {
      host.set(`${e.ref}_origin`, e.ref)
      for (const f of e.frames ?? []) if (typeof f?.ref === 'string') host.set(f.ref, e.ref)
    }
  }
  return host
}

/**
 * The facts `arrangementIssues` checks against, read from a layout (hydrated or
 * resolved — only refs, types and jointTypes are read) and the actor list.
 * @param {object|null|undefined} layout
 * @param {object[]|null|undefined} actors
 */
export function arrangementWorldOf(layout, actors) {
  const entities = Array.isArray(layout?.entities) ? layout.entities : []
  const host = hostByRef(entities)
  return {
    actorRefs: new Set((actors ?? []).map(a => a?.ref).filter(r => typeof r === 'string')),
    solidRefs: new Set(entities.filter(e => e?.type === 'Solid').map(e => e.ref)),
    viewers:   new Map(entities.filter(isViewerFrame).map(e => [e.ref, e])),
    kinematicLinks: (layout?.constraints ?? [])
      .filter(c => c && c.jointType != null)
      .map(c => ({ a: host.get(c.source) ?? c.source, b: host.get(c.target) ?? c.target, jointType: c.jointType })),
    viewerGap: viewerFrameGap,
  }
}

/**
 * Read every declared arrangement against a RESOLVED layout (layout/1.0 — no
 * $fact refs left; `compileContext(doc).layoutDsl` is one).
 *
 * Arrangements with shape errors are not read (their state would be an answer
 * to a question that was not asked); they are returned in `errors` instead, so
 * nothing is dropped silently (原則 #11).
 *
 * `bodies` / `viewers` are the resolved poses the states were read from, keyed
 * by ref, so a picture of a report (ADR-168 S1b — `view/ArrangementStatusMath.js`)
 * is drawn from the SAME poses its status was decided on and never re-resolves
 * the layout (§1.1).
 *
 * @param {object} layoutDsl  resolved layout/1.0
 * @param {object[]} arrangements
 * @param {object[]} actors
 * @returns {{errors: string[], reports: object[], conflicts: object[],
 *            bodies: Record<string, object>, viewers: Record<string, object>}}
 */
export function reportArrangements(layoutDsl, arrangements, actors) {
  const list = arrangements ?? []
  const errors = arrangementIssues(list, arrangementWorldOf(layoutDsl, actors))
  if (list.length === 0) return { errors, reports: [], conflicts: [], bodies: {}, viewers: {} }
  if (errors.length > 0) return { errors, reports: [], conflicts: [], bodies: {}, viewers: {} }

  const world = arrangementWorldOf(layoutDsl, actors)
  const scene = compileLayout(layoutDsl)
  const refMap = buildRefMap(layoutDsl.entities)
  const byId = new Map(scene.objects.map(o => [o.id, o]))

  /** @type {Record<string, object>} */
  const bodies = {}
  /** @type {Record<string, object>} */
  const viewers = {}
  /** @param {string} ref */
  const bodyOf = (ref) => {
    if (bodies[ref]) return bodies[ref]
    const o = byId.get(refMap.get(ref))
    return (bodies[ref] = {
      center:   o.position,
      size:     sizeOfCorners(o.localCorners),
      rotation: o.orientation,
      inner:    o.innerDimensions ?? null,
    })
  }
  /** @param {string} ref */
  const viewerOf = (ref) => {
    if (viewers[ref]) return viewers[ref]
    const o = byId.get(refMap.get(ref))
    return (viewers[ref] = { position: o.translation, rotation: o.rotation })
  }

  const reports = list.map(arr => {
    const subject = bodyOf(arr.subject)
    return {
      ref: arr.ref,
      by: arr.by,
      subject: arr.subject,
      sides: arr.sides.map(side => {
        const partner = bodyOf(side.of)
        const contact = observeContact(subject, partner)
        const state = {
          ...contact,
          vertical: observeVertical(subject, partner),
          relative: (viewerRef) => observeRelative(subject, partner, viewerOf(viewerRef)),
        }
        const viewerRef = side.toward && typeof side.toward === 'object' ? side.toward.viewer : null
        if (viewerRef) viewerOf(viewerRef)
        return {
          of: side.of,
          declared: { contact: side.contact, toward: side.toward },
          state: {
            contact:  contact.contact,
            faces:    contact.faces,
            gap:      contact.gap,
            vertical: state.vertical,
            ...(viewerRef ? { relative: state.relative(viewerRef) } : {}),
          },
          status: sideStatus(side, state),
          mobility: mobilityBetween(world.kinematicLinks, arr.subject, side.of),
        }
      }),
    }
  })
  return { errors, reports, conflicts: claimConflicts(list), bodies, viewers }
}
