/**
 * PlaceTypeRegistry — semantic place-type vocabulary for annotated 2D elements.
 *
 * Defines five scale-independent place types derived from the structural
 * categories of spatial cognition (cf. Lynch, *The Image of the City*, 1960,
 * as intellectual ancestor — but the categories stand without that reference):
 *
 *   Route    — channels of movement / flow
 *   Boundary — linear separators / interfaces
 *   Zone     — bounded areas with identifiable character
 *   Hub      — focal junction points / datum points
 *   Anchor   — external reference features / root datums
 *
 * Applicable at any scale:
 *   Urban:        Route=street, Boundary=shoreline, Zone=district, Hub=intersection, Anchor=monument
 *   Building:     Route=corridor, Boundary=wall, Zone=room, Hub=door, Anchor=column
 *   Manufacturing: Route=conveyor, Boundary=area fence, Zone=work cell, Hub=datum hole, Anchor=reference feature
 *
 * This registry maps each place type to:
 *   name        — canonical identifier used in `placeType` fields
 *   label       — human-readable label (bilingual: English / Japanese)
 *   group       — geometry family constraining which entity type is valid
 *   geometry    — 'line' | 'region' | 'point'
 *   color       — hex badge color for UI (N-panel, Outliner)
 *   description — one-line description shown in the picker overlay
 *
 * Geometry constraints:
 *   line   → AnnotatedLine   (Route, Boundary)
 *   region → AnnotatedRegion (Zone)
 *   point  → AnnotatedPoint  (Hub, Anchor)
 *
 * The IFC registry (IFCClassRegistry.js) covers building-element semantics for
 * 3D entities (Solid, ImportedMesh).  This registry covers spatial-annotation
 * semantics for 2D entities (AnnotatedLine, AnnotatedRegion, AnnotatedPoint).
 * The two systems are independent and complementary.
 *
 * @see ADR-029, ADR-025
 */

/**
 * @typedef {'line'|'region'|'point'} PlaceTypeGeometry
 * @typedef {{ name: string, label: string, group: string, geometry: PlaceTypeGeometry, color: string, description: string }} PlaceTypeEntry
 */

/** @type {PlaceTypeEntry[]} */
export const PLACE_TYPES = [
  // ── Linear elements — AnnotatedLine ───────────────────────────────────────
  {
    name:        'Route',
    label:       'Route (経路)',
    group:       'Linear',
    geometry:    'line',
    color:       '#4A90D9',
    description: '移動・流れの経路 — streets, corridors, conveyor paths, transit lines',
  },
  {
    name:        'Boundary',
    label:       'Boundary (境界)',
    group:       'Linear',
    geometry:    'line',
    color:       '#E74C3C',
    description: '分離・区画の境界 — walls, fences, shorelines, area borders',
  },

  // ── Areal elements — AnnotatedRegion ──────────────────────────────────────
  {
    name:        'Zone',
    label:       'Zone (ゾーン)',
    group:       'Areal',
    geometry:    'region',
    color:       '#27AE60',
    description: '特性を持つ領域 — rooms, districts, work cells, departments',
  },

  // ── Point elements — AnnotatedPoint ───────────────────────────────────────
  {
    name:        'Hub',
    label:       'Hub (ハブ)',
    group:       'Point',
    geometry:    'point',
    color:       '#F39C12',
    description: '結節・接続・基準点 — junctions, doorways, datum holes, fixture points',
  },
  {
    name:        'Anchor',
    label:       'Anchor (アンカー)',
    group:       'Point',
    geometry:    'point',
    color:       '#9B59B6',
    description: '外部基準・目印・公差連鎖の起点 — monuments, columns, reference features',
  },
]

/** Quick lookup by place type name.  Returns undefined for unknown names. */
export const PLACE_TYPE_MAP = new Map(PLACE_TYPES.map(e => [e.name, e]))

/**
 * Returns the PlaceTypeEntry for the given type name, or null if not found.
 * @param {string|null} name
 * @returns {PlaceTypeEntry|null}
 */
export function getPlaceTypeEntry(name) {
  if (!name) return null
  return PLACE_TYPE_MAP.get(name) ?? null
}

/**
 * Returns place types grouped by their `group` field.
 * @returns {Map<string, PlaceTypeEntry[]>}
 */
export function getPlaceTypesByGroup() {
  const groups = new Map()
  for (const entry of PLACE_TYPES) {
    if (!groups.has(entry.group)) groups.set(entry.group, [])
    groups.get(entry.group).push(entry)
  }
  return groups
}

/**
 * Returns all place types whose `geometry` matches the given geometry type.
 * Use this to filter the picker to only show valid types for a given entity:
 *   getPlaceTypesByGeometry('line')   → [Route, Boundary]
 *   getPlaceTypesByGeometry('region') → [Zone]
 *   getPlaceTypesByGeometry('point')  → [Hub, Anchor]
 * @param {PlaceTypeGeometry} geometry
 * @returns {PlaceTypeEntry[]}
 */
export function getPlaceTypesByGeometry(geometry) {
  return PLACE_TYPES.filter(e => e.geometry === geometry)
}
