/**
 * FormApplication — apply a form question answer to a Context DSL document.
 * Pure computation: input-immutable, no I/O (PHILOSOPHY #3/#6).
 *
 * Complements FormProjection: where FormProjection reads the validator result
 * to emit questions, FormApplication applies a user answer to produce a new doc.
 * The symmetry mirrors the admissible-edit pattern (applyAdmissibleEdit ↔ widget
 * recolour), but for form intake instead of 3-D authoring.
 *
 * Answer shapes by kind (see FormProjection.ANSWER_KIND):
 *   quantity:     { value: number, unit: string }          — R1 unknown-attr
 *   actorRef:     { actorRef: string }                     — R4 unassigned-scope
 *   kpiCriterion: { kpi:{name,expr,unit}, criterion:{op,value} } — R9 stated-without-kpi
 *   requirement:  { ref, by, kpi?, criterion?, constrains, negotiability } — R8 role-kpi-catalog
 *   owner:        { owner: actorRef | "none" }             — R10 undeclared-owner
 *   endUserStance:{ actorRef: string }                     — R12 no end user
 *   criteria:     { mix?: {D?,Q?,C?,S?}, elements?: { [key]: {criterion?, weight?} } }
 *                                                          — R12 unheard criteria (partial answers fine)
 *   jobFunction:  { role: string }                         — R13 undeclared function
 *
 * @module context/FormApplication
 */

import { CRITERIA_CATEGORIES, CRITERIA_ELEMENTS } from './CriteriaCatalog.js'
import { answersOf } from './CriteriaElicitation.js'
import { withEndUserStance, withJobFunction } from './ActorStance.js'

/** Replace the actor `ref` in a (cloned) doc by `next(actor)`; throws when absent. */
function replaceActor(doc, ref, next, what) {
  const i = (doc.actors ?? []).findIndex(a => a.ref === ref)
  if (i < 0) throw new Error(`[FormApplication] no actor "${ref}" to ${what}`)
  doc.actors[i] = next(doc.actors[i])
}

/** Ref of the requirement an end user's answer for one element is written to, when none exists yet. */
export function criteriaRequirementRef(actorRef, elementKey) {
  return `crit_${actorRef}_${elementKey}`
}

/**
 * Apply a form question answer to a document, returning a new document.
 * The input document is never mutated (PHILOSOPHY #6).
 *
 * @param {object} doc — canonical Context DSL document
 * @param {{ ref: string, target: string, answerKind: string }} question — from projectForm()
 * @param {object} answer — shape depends on answerKind (see module header)
 * @returns {object} new document with the answer applied
 */
export function applyQuestionAnswer(doc, question, answer) {
  const newDoc = JSON.parse(JSON.stringify(doc))

  switch (question.answerKind) {
    case 'quantity': {
      // target = "factRef.attrs.attrKey"  (R1 oq format from ContextValidator R1 rule)
      const parts   = question.target.split('.')
      const factRef = parts[0]
      const attrKey = parts[2]   // skip the literal 'attrs' segment
      const fact = (newDoc.given ?? []).find(f => f.ref === factRef)
      if (fact) {
        if (!fact.attrs) fact.attrs = {}
        fact.attrs[attrKey] = { value: Number(answer.value), unit: String(answer.unit ?? '') }
      }
      break
    }

    case 'actorRef': {
      // target = obligation ref  (R4 oq format)
      const ob = (newDoc.obligations ?? []).find(o => o.ref === question.target)
      if (ob) ob.responsible = answer.actorRef
      break
    }

    case 'kpiCriterion': {
      // target = requirement ref  (R9 oq format)
      const req = (newDoc.requirements ?? []).find(r => r.ref === question.target)
      if (req) {
        req.kpi       = answer.kpi
        req.criterion = answer.criterion
      }
      break
    }

    case 'requirement': {
      // R8: add a new requirement to the doc
      if (!newDoc.requirements) newDoc.requirements = []
      newDoc.requirements.push(answer.requirement)
      break
    }

    case 'owner': {
      // R10: target = requirement ref (ADR-104 D2). The answer is an actor ref
      // or OWNER_NONE_DECLARED — "it belongs to nobody" is an answer, not a
      // blank, which is the whole point of asking (PHILOSOPHY #31).
      const req = (newDoc.requirements ?? []).find(r => r.ref === question.target)
      if (req) req.owner = answer.owner
      break
    }

    case 'endUserStance': {
      // R12 (no end user): the stance is written to its own field, never into
      // `role` — the job function stays whatever was declared (ADR-165 D1).
      replaceActor(newDoc, answer.actorRef, withEndUserStance, 'declare as an end user')
      break
    }

    case 'criteria': {
      // R12 (unheard): target = end user ref. Only the fields the person
      // actually answered are written — an unanswered field stays blank and
      // keeps being counted (never defaulted).
      const actorRef = question.target
      const actor = (newDoc.actors ?? []).find(a => a.ref === actorRef)
      if (!actor) throw new Error(`[FormApplication] no end user "${actorRef}" to record criteria for`)
      for (const c of CRITERIA_CATEGORIES) {
        const v = answer.mix?.[c]
        if (v !== undefined) actor.mix = { ...(actor.mix ?? {}), [c]: Number(v) }
      }
      for (const e of CRITERIA_ELEMENTS) {
        const a = answer.elements?.[e.key]
        if (!a || (a.criterion === undefined && a.weight === undefined)) continue
        const existing = answersOf(newDoc, actorRef, e.key)
        if (existing.length > 1) {
          throw new Error(`[FormApplication] "${actorRef}" already has ${existing.length} answers for "${e.key}" — resolve the duplicate first`)
        }
        let req = existing[0]
        if (!req) {
          req = { ref: criteriaRequirementRef(actorRef, e.key), by: actorRef, owner: actorRef, kpi: { name: e.key, unit: e.unit } }
          newDoc.requirements = [...(newDoc.requirements ?? []), req]
        }
        if (a.criterion !== undefined) req.criterion = { op: String(a.criterion.op), value: Number(a.criterion.value) }
        if (a.weight !== undefined) req.weight = Number(a.weight)
      }
      break
    }

    case 'jobFunction': {
      // R13: target = end user ref. Writing the job also retires the legacy
      // stance-in-role, so the stance moves to its own field (ADR-165 D1).
      replaceActor(newDoc, question.target, a => withJobFunction(a, answer.role), 'declare a job function for')
      break
    }

    default:
      // A silently ignored answer is the worst failure shape there is: the input
      // was consumed and nothing happened (PHILOSOPHY #11). The switch used to
      // end here with no default, so a new answer kind would have been dropped
      // without a word.
      throw new Error(
        `[FormApplication] no application for answer kind "${question.answerKind}". ` +
        'Every kind FormProjection can emit must be applicable here, or answering ' +
        'the question does nothing and the form never empties.')
  }

  return newDoc
}
