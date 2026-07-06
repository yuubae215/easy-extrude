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
 * @property {string} category    — grouping label (e.g. 'Starter', 'Robot Cell')
 * @property {{kind:'blank'}|{kind:'example', file:string}} source
 *           — how the doc is obtained: built from `createBlankDoc`, or a bundled
 *             example JSON resolved by the controller's import map.
 * @property {boolean} [wizard] — start the guided-intake wizard right after the
 *           doc is adopted (ADR-063 Phase 5 — the gallery is a wizard entry point).
 */

/** @type {TemplateMeta[]} */
export const TEMPLATE_CATALOG = [
  {
    id:          'guided',
    name:        'Guided Intake (Wizard)',
    description: 'Answer one question at a time — who, what is decided, what must hold. Every field starts from a list or an asset; you never face a blank form.',
    category:    'Starter',
    source:      { kind: 'blank' },
    wizard:      true,
  },
  {
    id:          'cell_simple',
    name:        'Robot Cell — Simple',
    description: '2 actors, 1 variable. Minimal example of the role KPI catalog and form projection.',
    category:    'Robot Cell',
    source:      { kind: 'example', file: 'cell_phase2_context.json' },
  },
  {
    id:          'cell_conflict',
    name:        'Robot Cell — Multi-party Conflict',
    description: '3 actors with conflicting requirements. Try negotiation clusters and approval gates.',
    category:    'Robot Cell',
    source:      { kind: 'example', file: 'cell_conflict_context.json' },
  },
  {
    id:          'cell_region',
    name:        'Robot Cell — Regions',
    description: 'Region variables, overlapping admissible areas, acceptance predicates. Supports 3D authoring.',
    category:    'Robot Cell',
    source:      { kind: 'example', file: 'cell_region_context.json' },
  },
  {
    id:          'cell_robotics',
    name:        'Robot Cell — Robotics Checks',
    description: 'Measured reach margins and contact clearances drive robot_reach / collision_free verdicts. Answer the gripper question to unblock a check.',
    category:    'Robot Cell',
    source:      { kind: 'example', file: 'cell_robotics_context.json' },
  },
  // ADR-063 Phase 5 — the blank sheet is the EXPERT escape hatch, not the front
  // door (Goal 3: the full-customisation route survives, shelved after the
  // selection-first entries).
  {
    id:          'blank',
    name:        'Empty Project',
    description: 'Enter actors, variables, and requirements from scratch (expert route — blank forms, no guidance).',
    category:    'Expert',
    source:      { kind: 'blank' },
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
