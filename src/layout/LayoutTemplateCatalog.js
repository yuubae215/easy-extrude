/**
 * LayoutTemplateCatalog — starter-template registry for the launch Home screen
 * (ADR-089).
 *
 * Pure metadata only: no THREE, no DOM, no JSON imports — loads under bare
 * `node --test` (PHILOSOPHY #3). Each entry says *where* its Layout DSL comes
 * from (`source`) but never holds the document itself; resolving a
 * `kind:'example'` file to an actual DSL (a static JSON import) is a side effect
 * owned by `AppController` (the controller maps `source.file` → bundled module).
 *
 * This is the **Layout DSL** entry — distinct from the Context DSL
 * `TEMPLATE_CATALOG` (ADR-051). Selecting a card feeds the single authoritative
 * scene-load path `compileLayout → SceneService.importFromJson(clear)`
 * (PHILOSOPHY #1); a template is just a way to seed the scene, never a new
 * artifact.
 */

/**
 * @typedef {Object} LayoutTemplateMeta
 * @property {string} id          — stable identifier (gallery key, callback arg)
 * @property {string} name        — display title
 * @property {string} description — one-line summary shown on the card
 * @property {string} category    — grouping label (e.g. 'Process Layout')
 * @property {{kind:'example', file:string}|{kind:'empty'}} source
 *           — how the scene is obtained: a bundled Layout DSL example resolved by
 *             the controller's import map, or the empty escape hatch (no scene
 *             replacement — keeps the default boot scene).
 */

/** @type {LayoutTemplateMeta[]} */
export const LAYOUT_TEMPLATE_CATALOG = [
  {
    id:          'pick_place',
    name:        '単腕ピック&プレイスセル',
    description: '作業台上のペデスタルに単腕ロボット。供給ビンから排出トレイへワークを載せ替える最小構成。',
    category:    'Process Layout',
    source:      { kind: 'example', file: 'layout_pick_place_cell.json' },
  },
  {
    id:          'conveyor',
    name:        '直線コンベアライン',
    description: '投入・加工×2・払い出しの4ステーションを搬送方向に等間隔で並べた直線ライン。',
    category:    'Process Layout',
    source:      { kind: 'example', file: 'layout_conveyor_line.json' },
  },
  {
    id:          'palletizing',
    name:        'パレタイジングセル',
    description: '床置きロボットが隣接パレット上へ箱を2×2で積み付けるパレタイジング構成。',
    category:    'Process Layout',
    source:      { kind: 'example', file: 'layout_palletizing.json' },
  },
  {
    id:          'factory_cell',
    name:        '工場セル自動化',
    description: 'セル型工程を自動化に置き換える標準レイアウト（電源・作業台・ロボット・ワークコンテナ）。',
    category:    'Process Layout',
    source:      { kind: 'example', file: 'factory_layout.json' },
  },
  // The escape hatch: start from the default boot scene (no replacement). Kept
  // last so the guided, populated options are the front door (ADR-089).
  {
    id:          'empty',
    name:        '空のプロジェクト',
    description: '既定のシーンからそのままモデリングを始める（テンプレを読み込まない）。',
    category:    'Blank',
    source:      { kind: 'empty' },
  },
]

/**
 * Look up a template's metadata by id.
 * @param {string} id
 * @returns {LayoutTemplateMeta|undefined}
 */
export function getLayoutTemplateMeta(id) {
  return LAYOUT_TEMPLATE_CATALOG.find(t => t.id === id)
}

/**
 * The bundled Layout DSL filenames the controller must provide a doc for. Exposed
 * so the controller's import map can be asserted complete (no silent missing file
 * — PHILOSOPHY #11).
 * @returns {string[]}
 */
export function layoutExampleFiles() {
  return LAYOUT_TEMPLATE_CATALOG
    .filter(t => t.source.kind === 'example')
    .map(t => t.source.file)
}
