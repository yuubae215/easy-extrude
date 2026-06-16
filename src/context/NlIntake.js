/**
 * NlIntake — deterministic natural-language → Fact-fragment extractor
 * (ADR-051 Phase 4, Entry C).
 *
 * Pure computation: input-immutable, no I/O, no THREE/DOM — loads under bare
 * `node --test` (PHILOSOPHY #3/#6). This is the "extraction bridge" of Entry C:
 * an utterance is parsed into zero or more **Fact fragments** (`given[]` shape)
 * which the controller folds into the canonical doc through the single
 * authoritative path (`addFact` → `AddDocEntryCommand` → `applyContextDoc`).
 *
 * Per ADR-044 the bridge is a *homomorphism that never generates arbitrary
 * structure* — it only recognises a small, documented grammar and maps it to the
 * fixed Fact schema. Per ADR-051 §Negative it is **conservative**: anything
 * vague (約 / a range / hedge words) or explicitly unknown becomes a Fact whose
 * attribute is the literal `"unknown"` (status `unknown`), which the validator R1
 * turns into an OpenQuestion — the value is only fixed later through the FormPanel
 * and a Decision (ADR-046 invariant 2). A definite number becomes an `asserted`
 * `{value, unit}` attribute. Anything the grammar cannot parse is returned in
 * `unparsed` (never silently dropped — PHILOSOPHY #11).
 *
 * Recognised grammar (per segment; segments split on newlines and 。/；/;):
 *   - definite:  「<主語>の<属性>は<number><unit>」 / "<subject> <attr> is <number><unit>"
 *   - vague:     same with 約/およそ/ほぼ/前後/くらい/弱/強 or about/around/approx/~
 *   - range:     「… <a>〜<b><unit>」 / "<a>-<b>", "<a> to <b>", "between <a> and <b>"
 *   - unknown:   「… は 不明/未定/わからない」 / "… unknown / tbd / n/a" (no number)
 *
 * @module context/NlIntake
 */

const UNKNOWN = 'unknown'

/** Hedge words that downgrade a definite number to `unknown` (conservative). */
const VAGUE_MARKERS = [
  '約', 'およそ', 'おおよそ', 'ほぼ', '程度', 'くらい', 'ぐらい', '弱', '強', '前後',
  'about', 'around', 'approximately', 'approx', 'roughly', 'circa', 'ish',
]

/** Words that assert the value is unknown outright (no number expected). */
const UNKNOWN_MARKERS = [
  '不明', '未定', '未確認', '未測定', 'わからない', '分からない',
  'unknown', 'tbd', 'n/a', 'na',
]

/** Connectives that separate the subject/attribute phrase from the value. */
const CONNECTIVE_RE = /\s*(?:は|＝|=|:|：|\bis\b|\bare\b)\s*/

/** Number token (integer or decimal, optional sign). */
const NUM = '[-+]?\\d+(?:\\.\\d+)?'
/** Range separators between two numbers. */
const RANGE_SEP = '\\s*(?:〜|～|~|–|—|−|-|から|to|through)\\s*'

const RANGE_RE  = new RegExp(`(${NUM})${RANGE_SEP}(${NUM})\\s*([^\\s。、,;]*)`)
const BETWEEN_RE = new RegExp(`between\\s+(${NUM})\\s+and\\s+(${NUM})\\s*([^\\s。、,;]*)`, 'i')
const SCALAR_RE = new RegExp(`(${NUM})\\s*([^\\s。、,;]*)`)

/**
 * Extract Fact fragments from a free-text utterance.
 *
 * @param {string} utterance
 * @returns {{ facts: object[], unparsed: string[] }}
 *   facts — `given[]`-shaped fragments (ref/subject/attrs/status/evidence/[note])
 *   unparsed — segments the grammar could not interpret (surfaced for manual entry)
 */
export function extractFacts(utterance) {
  const facts = []
  const unparsed = []
  if (typeof utterance !== 'string') return { facts, unparsed }

  const segments = utterance
    .split(/[\n。；;]+/)
    .map(s => s.trim())
    .filter(Boolean)

  let i = 0
  for (const segment of segments) {
    const parsed = parseStatement(segment)
    if (!parsed) { unparsed.push(segment); continue }
    facts.push(buildFact(parsed, i++))
  }
  return { facts, unparsed }
}

/**
 * Parse a single segment into an intermediate descriptor, or null if unrecognised.
 * @param {string} segment
 * @returns {{subject:string, attr:string, kind:'scalar'|'interval'|'unknown', value?:number, lo?:number, hi?:number, unit?:string, vague?:boolean}|null}
 */
function parseStatement(segment) {
  const hasUnknownMarker = UNKNOWN_MARKERS.some(m => segment.toLowerCase().includes(m.toLowerCase()))

  // Range: "<a>〜<b><unit>" or "between <a> and <b> <unit>".
  const between = BETWEEN_RE.exec(segment)
  const range   = between ?? RANGE_RE.exec(segment)
  if (range) {
    const lo = Number(range[1]), hi = Number(range[2])
    const { subject, attr } = splitSubjectAttr(segment.slice(0, range.index))
    if (Number.isFinite(lo) && Number.isFinite(hi) && lo <= hi) {
      return { subject, attr, kind: 'interval', lo, hi, unit: cleanUnit(range[3]), vague: true }
    }
  }

  // Single number + unit.
  const scalar = SCALAR_RE.exec(segment)
  if (scalar) {
    const value = Number(scalar[1])
    if (Number.isFinite(value)) {
      const { subject, attr } = splitSubjectAttr(segment.slice(0, scalar.index))
      const vague = VAGUE_MARKERS.some(m => segment.toLowerCase().includes(m.toLowerCase()))
      return { subject, attr, kind: 'scalar', value, unit: cleanUnit(scalar[2]), vague }
    }
  }

  // No number, but an explicit unknown marker → an unknown-valued fact.
  if (hasUnknownMarker) {
    const idx = firstUnknownMarkerIndex(segment)
    const { subject, attr } = splitSubjectAttr(segment.slice(0, idx))
    return { subject, attr, kind: 'unknown' }
  }

  return null
}

/** Build a `given[]`-shaped Fact fragment from a parsed descriptor. */
function buildFact(p, index) {
  const ref     = `f_nl_${index}${slug(p.subject) ? `_${slug(p.subject)}` : ''}`
  const attrKey = p.attr || 'value'
  const subject = p.subject || '（無題）'

  if (p.kind === 'scalar' && !p.vague) {
    return {
      ref, subject,
      attrs:    { [attrKey]: { value: p.value, unit: p.unit ?? '' } },
      status:   'asserted',
      evidence: [],
    }
  }

  // Conservative path: vague scalar / range / explicit unknown → unknown attr.
  const note =
    p.kind === 'interval' ? `区間 ${p.lo}〜${p.hi}${p.unit ? ` ${p.unit}` : ''}（要確定）`
    : p.kind === 'scalar' ? `概算 ${p.value}${p.unit ? ` ${p.unit}` : ''}（要確定）`
    : '値が未確定'
  return {
    ref, subject,
    attrs:    { [attrKey]: UNKNOWN },
    status:   'unknown',
    evidence: [],
    note,
  }
}

/**
 * Split a "subject phrase" into subject + attribute. Drops a trailing connective
 * (は/=/:/is/are). Japanese: split at the last 「の」 (主語の属性). English: the
 * last whitespace token is the attribute. No attribute found → key `value`.
 */
function splitSubjectAttr(prefixRaw) {
  let prefix = prefixRaw.replace(/\s+$/, '')
  // Strip a trailing connective and anything after it (the value side is gone).
  const conn = prefix.search(CONNECTIVE_RE)
  if (conn >= 0) prefix = prefix.slice(0, conn)
  // Drop trailing hedge words (約 etc.) that sit between attr and number.
  for (const m of VAGUE_MARKERS) {
    if (prefix.endsWith(m)) prefix = prefix.slice(0, -m.length)
  }
  prefix = prefix.trim()
  if (!prefix) return { subject: '', attr: 'value' }

  if (prefix.includes('の')) {
    const at = prefix.lastIndexOf('の')
    return { subject: prefix.slice(0, at).trim(), attr: sanitizeKey(prefix.slice(at + 1)) || 'value' }
  }
  const tokens = prefix.split(/\s+/)
  if (tokens.length >= 2) {
    const attr = sanitizeKey(tokens.pop())
    return { subject: tokens.join(' ').trim(), attr: attr || 'value' }
  }
  return { subject: prefix, attr: 'value' }
}

/** Index of the first unknown marker (so the subject prefix can be sliced off). */
function firstUnknownMarkerIndex(segment) {
  const lower = segment.toLowerCase()
  let best = segment.length
  for (const m of UNKNOWN_MARKERS) {
    const idx = lower.indexOf(m.toLowerCase())
    if (idx >= 0 && idx < best) best = idx
  }
  // Also cut a trailing connective before the marker (e.g. "…は不明").
  const conn = segment.slice(0, best).search(CONNECTIVE_RE)
  return conn >= 0 ? conn : best
}

/** Strip a unit token of stray punctuation; empty string when none. */
function cleanUnit(raw) {
  return (raw ?? '').replace(/^[\s（(]+|[\s）).,。、]+$/g, '').trim()
}

/** Make a string safe as an object key (no dots — FormApplication splits on '.'). */
function sanitizeKey(s) {
  return s.replace(/[.\s]+/g, '_').replace(/^_+|_+$/g, '').trim()
}

/** ASCII slug for a ref suffix; empty when the subject has no ASCII alnum. */
function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24)
}
