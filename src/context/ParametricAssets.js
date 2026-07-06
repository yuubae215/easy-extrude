/**
 * ParametricAssets — the parametric 3-D asset registry (ADR-063 Phase 4,
 * "選択優先インテーク").
 *
 * An asset is **declarative data over the existing Layout DSL**: a parameter
 * schema plus a pure fragment builder that maps complete parameter values onto
 * a `layout/1.0` entity list (manual strategy, explicit positions). The DSL is
 * NOT extended — an asset is data on top of the language, never a language
 * change (ADR-063 非目標). The 3-D viewer is an *input device*: the user drags
 * sliders, the fragment recompiles, a ghost preview responds live — and the
 * only thing ever committed is the **converted numbers/text** (`applyAssetCommit`
 * → variables + one asserted fact in the canonical doc). The 3-D state itself
 * is never committed (ADR-063 Goal 2 / ADR-050 invariant: doc is canonical,
 * scene is derived).
 *
 * Pure: no THREE, no DOM, no I/O, input-immutable — loads under bare
 * `node --test` (PHILOSOPHY #3 / #6). Asset recommendation / similarity search
 * stays out of scope (external recommender — ADR-056); this catalog is a
 * deterministic enumeration whose row-addition is the sanctioned extension
 * point (same loop as QUOTIENT_TABLE / RoleKpiCatalog).
 *
 * @module context/ParametricAssets
 */
import { LAYOUT_DSL_VERSION } from '../layout/LayoutDslSchema.js'
import { updateVariable, addFact, removeDocEntry } from './DocBuilder.js'

export const PARAMETRIC_CATALOG_VERSION = 'parametric/1.0'

/**
 * @typedef {Object} AssetParam
 * @property {string} key     — stable parameter key (doc variable suffix)
 * @property {string} label   — display label
 * @property {string} unit    — physical unit (mm scale, matching the cell examples)
 * @property {number} min     — inclusive lower bound (slider + clamp)
 * @property {number} max     — inclusive upper bound (slider + clamp)
 * @property {number} step    — slider step
 * @property {number} default — starting value (must lie in [min, max])
 *
 * @typedef {Object} ParametricAsset
 * @property {string} id
 * @property {string} version — PARAMETRIC_CATALOG_VERSION
 * @property {string} name
 * @property {string} description
 * @property {AssetParam[]} params
 * @property {(values: Record<string, number>) => {entities: object[]}} fragment
 *   — pure builder: COMPLETE clamped values → layout/1.0 entity fragment
 */

/** @type {ParametricAsset[]} */
export const PARAMETRIC_CATALOG = [
  {
    id:          'robot_pedestal',
    version:     PARAMETRIC_CATALOG_VERSION,
    name:        'Robot Pedestal',
    description: 'Base plate + mounting column. Drag the height until the robot flange lands where you want it — committing records the numbers, not the boxes.',
    params: [
      { key: 'base_size',    label: 'Base plate size',   unit: 'mm', min: 300, max: 900,  step: 10, default: 500 },
      { key: 'mount_height', label: 'Mount height',      unit: 'mm', min: 400, max: 1400, step: 10, default: 700 },
    ],
    fragment(v) {
      const plateT = 60
      const colSide = Math.round(v.base_size * 0.45)
      return {
        entities: [
          {
            type: 'Solid', ref: 'pedestal_base', name: 'Pedestal base',
            dimensions: { x: v.base_size, y: v.base_size, z: plateT },
            position:   { x: 0, y: 0, z: plateT / 2 },
          },
          {
            type: 'Solid', ref: 'pedestal_column', name: 'Pedestal column',
            dimensions: { x: colSide, y: colSide, z: Math.max(v.mount_height - plateT, 1) },
            position:   { x: 0, y: 0, z: plateT + Math.max(v.mount_height - plateT, 1) / 2 },
          },
        ],
      }
    },
  },
  {
    id:          'conveyor',
    version:     PARAMETRIC_CATALOG_VERSION,
    name:        'Conveyor',
    description: 'Belt bed on two legs. Stretch the length/width to say how much transport you need; the working height is the number downstream KPIs care about.',
    params: [
      { key: 'length',      label: 'Length',         unit: 'mm', min: 800, max: 4000, step: 50, default: 2000 },
      { key: 'width',       label: 'Belt width',     unit: 'mm', min: 300, max: 900,  step: 10, default: 500 },
      { key: 'work_height', label: 'Working height', unit: 'mm', min: 600, max: 1100, step: 10, default: 850 },
    ],
    fragment(v) {
      const bedT = 80
      const legSide = 60
      const legH = Math.max(v.work_height - bedT, 1)
      const legInset = Math.min(150, v.length / 4)
      return {
        entities: [
          {
            type: 'Solid', ref: 'conveyor_bed', name: 'Conveyor bed',
            dimensions: { x: v.length, y: v.width, z: bedT },
            position:   { x: 0, y: 0, z: v.work_height - bedT / 2 },
          },
          {
            type: 'Solid', ref: 'conveyor_leg_a', name: 'Conveyor leg A',
            dimensions: { x: legSide, y: v.width, z: legH },
            position:   { x: -(v.length / 2 - legInset), y: 0, z: legH / 2 },
          },
          {
            type: 'Solid', ref: 'conveyor_leg_b', name: 'Conveyor leg B',
            dimensions: { x: legSide, y: v.width, z: legH },
            position:   { x: v.length / 2 - legInset, y: 0, z: legH / 2 },
          },
        ],
      }
    },
  },
  {
    id:          'cell_floor',
    version:     PARAMETRIC_CATALOG_VERSION,
    name:        'Cell Footprint',
    description: 'The floor plate of the cell. Its two numbers are usually the first shared design variables everyone fights over.',
    params: [
      { key: 'cell_width', label: 'Cell width (X)', unit: 'mm', min: 1500, max: 5000, step: 50, default: 2400 },
      { key: 'cell_depth', label: 'Cell depth (Y)', unit: 'mm', min: 1200, max: 4000, step: 50, default: 2000 },
    ],
    fragment(v) {
      const plateT = 40
      return {
        entities: [
          {
            type: 'Solid', ref: 'cell_floor', name: 'Cell floor',
            dimensions: { x: v.cell_width, y: v.cell_depth, z: plateT },
            position:   { x: 0, y: 0, z: plateT / 2 },
          },
        ],
      }
    },
  },
]

/**
 * Look up an asset by id.
 * @param {string} id
 * @returns {ParametricAsset|undefined}
 */
export function getParametricAsset(id) {
  return PARAMETRIC_CATALOG.find(a => a.id === id)
}

/**
 * Complete + clamp a (possibly partial / dirty) value map against the asset's
 * parameter schema. A missing or non-finite value falls back to the parameter
 * default; finite values clamp into [min, max]. Total — never throws — because
 * it runs on every slider keystroke (PHILOSOPHY #11: the preview must not die
 * mid-drag). Input-immutable.
 *
 * @param {ParametricAsset} asset
 * @param {Record<string, number>} [values]
 * @returns {Record<string, number>} complete clamped map (only schema keys)
 */
export function clampParams(asset, values = {}) {
  const out = {}
  for (const p of asset.params) {
    const raw = values[p.key]
    const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : p.default
    out[p.key] = Math.min(p.max, Math.max(p.min, n))
  }
  return out
}

/**
 * Instantiate an asset into a complete, compilable `layout/1.0` DSL document
 * (manual strategy — the fragment carries explicit positions). This is what the
 * ghost preview renders and what the commit converts FROM; it is never written
 * into the canonical doc itself.
 *
 * @param {ParametricAsset} asset
 * @param {Record<string, number>} [values] — clamped internally
 * @returns {{version:string, strategy:'manual', entities:object[]}}
 */
export function instantiateAsset(asset, values = {}) {
  const v = clampParams(asset, values)
  const { entities } = asset.fragment(v)
  return { version: LAYOUT_DSL_VERSION, strategy: 'manual', entities }
}

/** Doc refs an asset commit writes (deterministic — recommit overwrites them). */
export function assetVariableRef(asset, param) { return `v_${asset.id}_${param.key}` }
export function assetFactRef(asset)            { return `g_${asset.id}_params` }

/**
 * The doc entries a commit records — the "converted numbers/text" of ADR-063
 * Goal 2. Each parameter becomes a shared design variable (unit + full schema
 * domain — the asset's slider range IS the declared domain) and the chosen
 * values become ONE asserted fact. Display-only projection; `applyAssetCommit`
 * is the doc-mutating counterpart.
 *
 * @param {ParametricAsset} asset
 * @param {Record<string, number>} [values]
 * @returns {{variables: object[], fact: object}}
 */
export function assetCommitEntries(asset, values = {}) {
  const v = clampParams(asset, values)
  const variables = asset.params.map(p => ({
    ref:         assetVariableRef(asset, p),
    unit:        p.unit,
    domain:      [p.min, p.max],
    description: `${asset.name} — ${p.label} (parametric asset ${asset.id})`,
  }))
  const attrs = {}
  for (const p of asset.params) attrs[p.key] = { value: v[p.key], unit: p.unit }
  const fact = {
    ref:     assetFactRef(asset),
    subject: asset.name,
    attrs,
    status:  'asserted',
    note:    `Committed from parametric asset "${asset.id}" (3-D viewer input; values are the artifact)`,
  }
  return { variables, fact }
}

/**
 * Fold an asset commit into the canonical doc (input-immutable). Variables are
 * upserted by ref (DocBuilder.updateVariable — a recommit tweaks in place, never
 * duplicates), and the parameter fact is replaced wholesale (remove + add by its
 * deterministic ref). The result is a NEW doc for the caller's before/after
 * command snapshot (PHILOSOPHY #6 — the undo boundary lives in the caller).
 *
 * @param {object} doc — canonical Context DSL doc
 * @param {ParametricAsset} asset
 * @param {Record<string, number>} [values]
 * @returns {object} new doc
 */
export function applyAssetCommit(doc, asset, values = {}) {
  const { variables, fact } = assetCommitEntries(asset, values)
  let next = doc
  for (const variable of variables) next = updateVariable(next, variable)
  next = removeDocEntry(next, 'fact', fact.ref)
  return addFact(next, fact)
}
