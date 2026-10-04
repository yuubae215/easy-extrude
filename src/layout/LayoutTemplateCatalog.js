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
 * `TEMPLATE_CATALOG` (ADR-051). Selecting a card opens the DSL as a Context
 * document (`docFromLayout` → `ContextService.loadContext` — the single
 * document-load path, PHILOSOPHY #1). ADR-162: a template seeds the DOCUMENT,
 * not just the scene — compiling it and dropping the source left every object
 * undeclarable except by re-deriving it from the screen (DEF-060).
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
    name:        'Single-arm pick & place cell',
    description: 'A single-arm robot on a pedestal on a workbench. The minimal setup that moves workpieces from a supply bin to an output tray.',
    category:    'Process Layout',
    source:      { kind: 'example', file: 'layout_pick_place_cell.json' },
  },
  {
    id:          'conveyor',
    name:        'Straight conveyor line',
    description: 'A straight line of 4 stations — infeed, 2× processing, outfeed — evenly spaced along the transport direction.',
    category:    'Process Layout',
    source:      { kind: 'example', file: 'layout_conveyor_line.json' },
  },
  {
    id:          'palletizing',
    name:        'Palletizing cell',
    description: 'A floor-mounted robot stacks boxes 2×2 onto an adjacent pallet.',
    category:    'Process Layout',
    source:      { kind: 'example', file: 'layout_palletizing.json' },
  },
  {
    id:          'factory_cell',
    name:        'Factory cell automation',
    description: 'The standard layout for automating a cell-type process (power, workbench, robot, workpiece containers).',
    category:    'Process Layout',
    source:      { kind: 'example', file: 'factory_layout.json' },
  },
  // The escape hatch: start from the default boot scene (no replacement). Kept
  // last so the guided, populated options are the front door (ADR-089).
  {
    id:          'empty',
    name:        'Empty project',
    description: 'Start modeling straight from the default scene (no template is loaded).',
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
