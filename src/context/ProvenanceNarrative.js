/**
 * ProvenanceNarrative — doc → NL rendering of the recovered Why (ADR-052 Phase 4).
 *
 * Pure computation: input-immutable, no I/O, no THREE/DOM — loads under bare
 * `node --test` (PHILOSOPHY #3/#6).
 *
 * This is the **return leg of the NL ⇄ doc round-trip**. `NlIntake.extractFacts`
 * is φ (NL → doc): it folds free text onto the fixed Fact schema. This module is
 * the visible witness of φ⁻¹ (doc → NL): given the Why provenance recovered by
 * `ProvenanceTree.recoverProvenance` (the φ⁻¹ *climb*), it renders a natural-
 * language explanation of why a derived scene entity exists.
 *
 * Per ADR-052 §2.2 the round-trip is faithful **up to synonym**: φ⁻¹ cannot
 * restore the original surface words, only one representative per synonym class.
 * The narrator therefore speaks through `SynonymQuotient.localize` — every
 * operator and node kind is rendered as its canonical representative, which is
 * exactly the structural-isomorphism-on-the-quotient guarantee, not more.
 *
 * It adds no data structure: it consumes the `recoverProvenance` result (with the
 * service-joined `gaps[]`) and the `buildWhyTree` overview, and returns strings.
 *
 * @module context/ProvenanceNarrative
 */

import { localizeOperator } from './SynonymQuotient.js'

/**
 * Render the recovered provenance of one derived entity as a short NL paragraph.
 *
 * @param {object|null} prov — a `recoverProvenance` result (optionally with `gaps`)
 * @param {{lang?:'ja'|'en'}} [opts]
 * @returns {string} one or more sentences; '' when there is nothing to say
 */
export function narrateProvenance(prov, opts = {}) {
  const lang = opts.lang === 'en' ? 'en' : 'ja'
  if (!prov || !prov.found) {
    return lang === 'en'
      ? 'This entity is not derived from the context document, so it has no recoverable Why.'
      : 'このエンティティは Context ドキュメントから導出されていないため、遡れる Why はありません。'
  }

  const subject = prov.node?.label || prov.entityRef
  const why = whyClauses(prov, lang)
  const gap = gapClause(prov.gaps ?? [], lang)
  const how = howClause(prov, lang)

  const sentences = []
  if (lang === 'en') {
    sentences.push(why.length
      ? `${subject} exists to satisfy ${joinList(why, 'en')}.`
      : `${subject} has no higher Why recorded above it.`)
    if (gap) sentences.push(gap)
    if (how) sentences.push(how)
  } else {
    sentences.push(why.length
      ? `${subject} は ${joinList(why, 'ja')} を満たすために存在します。`
      : `${subject} より上位に記録された Why はありません。`)
    if (gap) sentences.push(gap)
    if (how) sentences.push(how)
  }
  return sentences.join(lang === 'en' ? ' ' : '')
}

/**
 * Render the whole-doc Why tree as a one-line overview ("N goals / M
 * requirements drive K derived entities"). Complements the per-entity narration
 * the same way `WhyTreeView` complements `WhyBreadcrumb` (ADR-052 Phase 3).
 *
 * @param {{nodes:object[], roots:string[]}|null} tree — a `buildWhyTree` result
 * @param {{lang?:'ja'|'en'}} [opts]
 * @returns {string}
 */
export function narrateWhyTree(tree, opts = {}) {
  const lang = opts.lang === 'en' ? 'en' : 'ja'
  if (!tree || !Array.isArray(tree.nodes) || tree.nodes.length === 0) {
    return lang === 'en' ? 'The document is empty.' : 'ドキュメントは空です。'
  }
  const count = (kind) => tree.nodes.filter(n => n.kind === kind).length
  const intents = count('intent')
  const reqs    = count('requirement')
  const whats   = tree.nodes.filter(n => n.layer === 'what').length
  const roots   = tree.roots?.length ?? 0

  if (lang === 'en') {
    const apex = intents > 0
      ? `${intents} intent${plural(intents)}`
      : `${reqs} requirement${plural(reqs)}`
    return `${roots} Why root${plural(roots)} (${apex}) drive ${whats} derived What-node${plural(whats)} through the 5W1H tree.`
  }
  const apex = intents > 0 ? `目的 ${intents} 件` : `要求 ${reqs} 件`
  return `${roots} 個の Why ルート（${apex}）が、5W1H ツリーを通じて ${whats} 件の What ノードを導いています。`
}

// ── clause builders ───────────────────────────────────────────────────────────

/** Why clauses: KPIs (with criterion), KPI-less requirements, then intents. */
function whyClauses(prov, lang) {
  const out = []
  for (const k of prov.kpis ?? []) {
    const name = k.name || k.requirement
    const crit = criterionPhrase(k.criterion, k.unit, lang)
    if (lang === 'en') {
      out.push(crit ? `the KPI "${name}" (${crit})` : `the KPI "${name}"`)
    } else {
      out.push(crit ? `評価指標「${name}」(${crit})` : `評価指標「${name}」`)
    }
  }
  for (const n of (prov.why ?? []).filter(n => n.kind === 'requirement' && !n.data?.kpi)) {
    out.push(lang === 'en' ? `requirement "${n.label}"` : `要求「${n.label}」`)
  }
  for (const ref of prov.intents ?? []) {
    out.push(lang === 'en' ? `the intent ${ref}` : `目的 ${ref}`)
  }
  return out
}

/** A criterion {op, value} rendered through the synonym quotient. */
function criterionPhrase(criterion, unit, lang) {
  if (!criterion || criterion.value == null) return ''
  const op = localizeOperator(criterion.op, lang)
  const u = unit ? ` ${unit}` : ''
  return lang === 'en'
    ? `${op} ${criterion.value}${u}`
    : `${criterion.value}${u} ${op}`
}

/** Gap clause: live conflicts in red prose, resolved ones acknowledged. */
function gapClause(gaps, lang) {
  if (!gaps.length) return ''
  const live = gaps.filter(g => !g.resolved).map(g => g.variable)
  const done = gaps.filter(g => g.resolved).map(g => g.variable)
  const parts = []
  if (live.length) {
    parts.push(lang === 'en'
      ? `There is still an unresolved gap on ${joinList(live, 'en')}.`
      : `現状 ${joinList(live, 'ja')} に未解消の差分（衝突）があります。`)
  }
  if (done.length) {
    parts.push(lang === 'en'
      ? `The gap on ${joinList(done, 'en')} has been settled by a decision.`
      : `${joinList(done, 'ja')} の差分は決定により解消済みです。`)
  }
  return parts.join(lang === 'en' ? ' ' : '')
}

/** How clause: the decisions / obligations / constraints reached. */
function howClause(prov, lang) {
  const how = prov.how ?? []
  if (!how.length) return ''
  const labels = how.slice(0, 3).map(n => n.label)
  const more = how.length > 3 ? (lang === 'en' ? ' and others' : ' ほか') : ''
  return lang === 'en'
    ? `This is achieved through ${joinList(labels, 'en')}${more}.`
    : `これは ${joinList(labels, 'ja')}${more} によって達成されます。`
}

// ── small helpers ───────────────────────────────────────────────────────────

function joinList(items, lang) {
  const xs = items.filter(Boolean)
  if (xs.length === 0) return ''
  if (xs.length === 1) return xs[0]
  if (lang === 'en') {
    return xs.length === 2 ? `${xs[0]} and ${xs[1]}` : `${xs.slice(0, -1).join(', ')}, and ${xs[xs.length - 1]}`
  }
  return xs.join('、')
}

function plural(n) { return n === 1 ? '' : 's' }
