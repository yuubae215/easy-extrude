/**
 * IFCClassRegistry — curated list of IFC 4 entity classes for semantic classification.
 *
 * Each entry describes one IFC class that a Solid or ImportedMesh can be assigned to.
 * The list is intentionally selective: it covers the classes most commonly encountered
 * in architectural and structural design.  The full IFC schema (800+ classes) is not
 * exposed — discoverability and usability take priority over completeness.
 *
 * Schema per entry:
 *   name   — official IFC4 class name (e.g. 'IfcWall')
 *   label  — short human-readable label shown in the UI
 *   group  — category for grouping in the picker
 *   color  — hex color used as a visual badge in the N-panel and outliner
 *
 * @see ADR-025
 */

/** @typedef {{ name: string, label: string, group: string, color: string }} IFCClassEntry */

/** @type {IFCClassEntry[]} */
export const IFC_CLASSES = [
  // ── Structural ─────────────────────────────────────────────────────────────
  { name: 'IfcColumn',               label: 'Column',          group: 'Structural',    color: '#7B9FE0' },
  { name: 'IfcBeam',                 label: 'Beam',            group: 'Structural',    color: '#E09050' },
  { name: 'IfcMember',               label: 'Member',          group: 'Structural',    color: '#E07060' },
  { name: 'IfcFooting',              label: 'Footing',         group: 'Structural',    color: '#9B7944' },
  { name: 'IfcPile',                 label: 'Pile',            group: 'Structural',    color: '#7A5C3A' },

  // ── Architectural ──────────────────────────────────────────────────────────
  { name: 'IfcWall',                 label: 'Wall',            group: 'Architectural', color: '#C8C8C8' },
  { name: 'IfcWallStandardCase',     label: 'Wall (Standard)', group: 'Architectural', color: '#B4B4B4' },
  { name: 'IfcSlab',                 label: 'Slab',            group: 'Architectural', color: '#A0A0A0' },
  { name: 'IfcRoof',                 label: 'Roof',            group: 'Architectural', color: '#C04830' },
  { name: 'IfcCurtainWall',          label: 'Curtain Wall',    group: 'Architectural', color: '#90C8F0' },
  { name: 'IfcDoor',                 label: 'Door',            group: 'Architectural', color: '#A07840' },
  { name: 'IfcWindow',               label: 'Window',          group: 'Architectural', color: '#70B8F8' },
  { name: 'IfcStair',                label: 'Stair',           group: 'Architectural', color: '#E8C040' },
  { name: 'IfcStairFlight',          label: 'Stair Flight',    group: 'Architectural', color: '#D4AC30' },
  { name: 'IfcRamp',                 label: 'Ramp',            group: 'Architectural', color: '#C8C060' },
  { name: 'IfcCovering',             label: 'Covering',        group: 'Architectural', color: '#C09070' },

  // ── Site & Building ────────────────────────────────────────────────────────
  { name: 'IfcSite',                 label: 'Site',            group: 'Site',          color: '#70A050' },
  { name: 'IfcBuilding',             label: 'Building',        group: 'Site',          color: '#4878A0' },
  { name: 'IfcBuildingStorey',       label: 'Building Storey', group: 'Site',          color: '#507888' },
  { name: 'IfcSpace',                label: 'Space',           group: 'Site',          color: '#88C8E8' },

  // ── Furniture & Equipment ──────────────────────────────────────────────────
  { name: 'IfcFurniture',            label: 'Furniture',       group: 'Equipment',     color: '#78A858' },
  { name: 'IfcEquipmentElement',     label: 'Equipment',       group: 'Equipment',     color: '#98A040' },

  // ── Generic ───────────────────────────────────────────────────────────────
  { name: 'IfcBuildingElementProxy', label: 'Proxy (Generic)', group: 'Generic',       color: '#888888' },
]

/** Quick lookup by IFC class name.  Returns undefined for unknown names. */
export const IFC_CLASS_MAP = new Map(IFC_CLASSES.map(e => [e.name, e]))

/**
 * Returns the IFCClassEntry for the given class name, or null if not found.
 * @param {string|null} name
 * @returns {IFCClassEntry|null}
 */
export function getIFCClassEntry(name) {
  if (!name) return null
  return IFC_CLASS_MAP.get(name) ?? null
}

/**
 * Returns the IFC classes grouped by their `group` field.
 * @returns {Map<string, IFCClassEntry[]>}
 */
export function getIFCClassesByGroup() {
  const groups = new Map()
  for (const entry of IFC_CLASSES) {
    if (!groups.has(entry.group)) groups.set(entry.group, [])
    groups.get(entry.group).push(entry)
  }
  return groups
}
