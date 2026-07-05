/**
 * TemplatePreviewMath — pure presentation derivation over the CanonicalForm
 * normal form for the template-gallery structure preview (ADR-062 Phase 5).
 *
 * SCOPE / GOVERNANCE (PHILOSOPHY #29, ADR-062): the *fact* is the versioned
 * `canonicalForm(doc)` output the deterministic core decides (ADR-056 — the
 * WL normal form on the synonym quotient). This module only re-shapes it into
 * a card-sized preview: per-5W1H-layer node counts and a short prefix of the
 * doc signature. It never recomputes colours, never compares docs, and never
 * ranks similarity (that whole lane is out of scope — ADR-056 §3). Malformed
 * input degrades to `null` — a card without a preview, never a guessed one
 * (PHILOSOPHY #11).
 *
 * Pure and THREE-free: runs in the bare `node --test` lane (test:context).
 */

import { PROVENANCE_LAYERS } from '../context/ProvenanceTree.js'

/** Signature prefix length shown on the card (display truncation only). */
const SIG_PREFIX = 8

/**
 * Card-sized structure preview of a `canonicalForm` output:
 *   - `signature` — the first {@link SIG_PREFIX} chars of `docSignature` (the
 *     structure's identity tag; equal tags across cards *suggest* the ADR-056
 *     `verify` equality the full signature decides),
 *   - `layers` — node count + share per 5W1H layer in canonical Why→How→What
 *     order (drives the mini stacked bar),
 *   - `total` / `rootCount` — overall node count and Why-apex count.
 *
 * @param {object|null|undefined} cf — `canonicalForm(doc)` output
 * @returns {null | { signature: string, total: number, rootCount: number,
 *   layers: Array<{layer:string, count:number, fraction:number}> }}
 */
export function structurePreview(cf) {
  if (!cf || typeof cf !== 'object') return null
  if (typeof cf.docSignature !== 'string' || cf.docSignature === '') return null
  if (!Array.isArray(cf.nodes) || !Array.isArray(cf.roots)) return null

  const counts = new Map(PROVENANCE_LAYERS.map(l => [l, 0]))
  for (const n of cf.nodes) {
    if (!n || typeof n.layer !== 'string' || !counts.has(n.layer)) return null
    counts.set(n.layer, counts.get(n.layer) + 1)
  }

  const total = cf.nodes.length
  return {
    signature: cf.docSignature.slice(0, SIG_PREFIX),
    total,
    rootCount: cf.roots.length,
    layers: PROVENANCE_LAYERS.map(layer => ({
      layer,
      count: counts.get(layer),
      fraction: total > 0 ? counts.get(layer) / total : 0,
    })),
  }
}
