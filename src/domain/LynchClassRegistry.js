/**
 * LynchClassRegistry — semantic classification vocabulary for 2D urban elements.
 *
 * Based on Kevin Lynch, *The Image of the City* (1960).
 * Lynch identified five elements that structure the mental map of a city:
 *   Path, Edge, District, Node, Landmark.
 *
 * This registry maps each Lynch element to:
 *   name        — canonical identifier used in `lynchClass` fields
 *   label       — human-readable label (bilingual: English / Japanese)
 *   group       — geometry family constraining which entity type is valid
 *   geometry    — 'polyline' | 'polygon' | 'marker'
 *   color       — hex badge color for UI (N-panel, Outliner)
 *   description — one-line description shown in the picker overlay
 *
 * Geometry constraints:
 *   polyline → UrbanPolyline  (Path, Edge)
 *   polygon  → UrbanPolygon   (District)
 *   marker   → UrbanMarker    (Node, Landmark)
 *
 * The IFC registry (IFCClassRegistry.js) covers building-element semantics for
 * 3D entities (Solid, ImportedMesh).  This registry covers urban-scale semantics
 * for 2D entities (UrbanPolyline, UrbanPolygon, UrbanMarker).  The two systems
 * are independent and complementary.
 *
 * @see ADR-026, ADR-025
 */

/**
 * @typedef {'polyline'|'polygon'|'marker'} LynchGeometry
 * @typedef {{ name: string, label: string, group: string, geometry: LynchGeometry, color: string, description: string }} LynchClassEntry
 */

/** @type {LynchClassEntry[]} */
export const LYNCH_CLASSES = [
  // ── Linear elements — UrbanPolyline ───────────────────────────────────────
  {
    name:        'Path',
    label:       'Path (パス)',
    group:       'Linear',
    geometry:    'polyline',
    color:       '#4A90D9',
    description: '動線・移動経路 — streets, walkways, transit lines, canals',
  },
  {
    name:        'Edge',
    label:       'Edge (エッジ)',
    group:       'Linear',
    geometry:    'polyline',
    color:       '#E74C3C',
    description: '境界・縁辺 — shorelines, walls, fences, railroad cuts',
  },

  // ── Areal elements — UrbanPolygon ─────────────────────────────────────────
  {
    name:        'District',
    label:       'District (地区)',
    group:       'Areal',
    geometry:    'polygon',
    color:       '#27AE60',
    description: '地区・エリア — medium-to-large areas with identifiable common character',
  },

  // ── Point elements — UrbanMarker ──────────────────────────────────────────
  {
    name:        'Node',
    label:       'Node (ノード)',
    group:       'Point',
    geometry:    'marker',
    color:       '#F39C12',
    description: '結節点・交差点 — strategic junctions, squares, focal concentrations',
  },
  {
    name:        'Landmark',
    label:       'Landmark (ランドマーク)',
    group:       'Point',
    geometry:    'marker',
    color:       '#9B59B6',
    description: 'ランドマーク・目印 — memorable external reference points (towers, monuments)',
  },
]

/** Quick lookup by Lynch class name.  Returns undefined for unknown names. */
export const LYNCH_CLASS_MAP = new Map(LYNCH_CLASSES.map(e => [e.name, e]))

/**
 * Returns the LynchClassEntry for the given class name, or null if not found.
 * @param {string|null} name
 * @returns {LynchClassEntry|null}
 */
export function getLynchClassEntry(name) {
  if (!name) return null
  return LYNCH_CLASS_MAP.get(name) ?? null
}

/**
 * Returns Lynch classes grouped by their `group` field.
 * @returns {Map<string, LynchClassEntry[]>}
 */
export function getLynchClassesByGroup() {
  const groups = new Map()
  for (const entry of LYNCH_CLASSES) {
    if (!groups.has(entry.group)) groups.set(entry.group, [])
    groups.get(entry.group).push(entry)
  }
  return groups
}

/**
 * Returns all Lynch classes whose `geometry` matches the given geometry type.
 * Use this to filter the picker to only show valid classes for a given entity type:
 *   filterByGeometry('polyline') → [Path, Edge]
 *   filterByGeometry('polygon')  → [District]
 *   filterByGeometry('marker')   → [Node, Landmark]
 * @param {LynchGeometry} geometry
 * @returns {LynchClassEntry[]}
 */
export function getLynchClassesByGeometry(geometry) {
  return LYNCH_CLASSES.filter(e => e.geometry === geometry)
}
