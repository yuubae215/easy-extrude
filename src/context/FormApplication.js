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
 *
 * @module context/FormApplication
 */

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
  }

  return newDoc
}
