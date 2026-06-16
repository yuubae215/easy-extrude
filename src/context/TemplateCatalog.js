/**
 * TemplateCatalog — starter-template registry for the template gallery
 * (ADR-051 Phase 2, Entry B).
 *
 * Pure metadata only: no THREE, no DOM, no JSON imports — loads under bare
 * `node --test` (PHILOSOPHY #3). Each entry describes *where* its document comes
 * from (`source`) but never holds the document itself; resolving a `kind:'example'`
 * file to an actual doc (a static JSON import) is a side effect owned by
 * `ContextController` (the controller maps `source.file` → bundled module).
 * A `kind:'blank'` template is built from the pure `createBlankDoc(name)`.
 *
 * Every entry is additive and feeds the single authoritative load path
 * (`ContextService.loadContext` / `adoptDoc` — ADR-051 §2 / PHILOSOPHY #1): a
 * template is just a way to seed the canonical doc, never a new artifact.
 */

/**
 * @typedef {Object} TemplateMeta
 * @property {string} id          — stable identifier (gallery key, callback arg)
 * @property {string} name        — display title
 * @property {string} description — one-line summary shown on the card
 * @property {string} category    — grouping label (e.g. 'スターター', 'ロボットセル')
 * @property {{kind:'blank'}|{kind:'example', file:string}} source
 *           — how the doc is obtained: built from `createBlankDoc`, or a bundled
 *             example JSON resolved by the controller's import map.
 */

/** @type {TemplateMeta[]} */
export const TEMPLATE_CATALOG = [
  {
    id:          'blank',
    name:        '空のプロジェクト',
    description: 'ゼロからアクター・変数・要件を入力する (Entry A)。',
    category:    'スターター',
    source:      { kind: 'blank' },
  },
  {
    id:          'cell_simple',
    name:        'ロボットセル — シンプル',
    description: '2 アクター・1 変数。役割 KPI カタログとフォーム射影の最小例。',
    category:    'ロボットセル',
    source:      { kind: 'example', file: 'cell_phase2_context.json' },
  },
  {
    id:          'cell_conflict',
    name:        'ロボットセル — 多者衝突',
    description: '3 アクターの要求が衝突。交渉クラスターと承認ゲートを体験。',
    category:    'ロボットセル',
    source:      { kind: 'example', file: 'cell_conflict_context.json' },
  },
  {
    id:          'cell_region',
    name:        'ロボットセル — 領域',
    description: '領域 Variable・許容領域の重なり・受入述語。3D オーサリング対応。',
    category:    'ロボットセル',
    source:      { kind: 'example', file: 'cell_region_context.json' },
  },
]

/**
 * Look up a template's metadata by id.
 * @param {string} id
 * @returns {TemplateMeta|undefined}
 */
export function getTemplateMeta(id) {
  return TEMPLATE_CATALOG.find(t => t.id === id)
}

/**
 * The bundled example filenames the controller must provide a doc for. Exposed so
 * the controller's import map can be asserted complete (no silent missing file —
 * PHILOSOPHY #11).
 * @returns {string[]}
 */
export function exampleFiles() {
  return TEMPLATE_CATALOG
    .filter(t => t.source.kind === 'example')
    .map(t => t.source.file)
}
