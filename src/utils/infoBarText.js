/**
 * Returns keyboard shortcut pairs for the info bar based on mode/subtype.
 * Pure function — no DOM, no side effects.
 * Extracted from UIView._setInfoText() for use in the React InfoBar component.
 *
 * @param {string} mode
 * @param {string|null} subtype
 * @returns {Array<[string, string]>} Array of [key, description] pairs
 */
export function getInfoText(mode, subtype = null) {
  if (mode === 'object') {
    return [
      ['Tab', 'Edit Mode'],
      ['G', 'Grab'],
      ['G > X/Y/Z', 'Axis'],
      ['G > S', 'Stack'],
      ['G > V', 'Pivot'],
      ['Shift+A', 'Add'],
      ['Shift+D', 'Duplicate'],
      ['M', 'Measure'],
      ['X', 'Delete'],
      ['N', 'Properties'],
    ]
  }
  if (subtype === '2d') {
    return [
      ['Tab', 'Object Mode'],
      ['Drag', 'Draw rectangle'],
      ['Enter', 'Extrude'],
      ['Esc', 'Cancel'],
    ]
  }
  if (subtype === '2d-extrude') {
    return [
      ['Drag', 'Set height'],
      ['0-9', 'Type height'],
      ['Enter', 'Confirm'],
      ['Esc', 'Back to sketch'],
    ]
  }
  if (subtype === '1d') {
    return [
      ['Tab', 'Object Mode'],
      ['Drag endpoint', 'Reposition'],
      ['Esc', 'Object Mode'],
    ]
  }
  // Default: Edit 3D
  return [
    ['Tab', 'Object Mode'],
    ['1', 'Vertex'],
    ['2', 'Edge'],
    ['3', 'Face'],
    ['E', 'Extrude face'],
    ['Shift+Click', 'Multi-select'],
    ['N', 'Properties'],
  ]
}
