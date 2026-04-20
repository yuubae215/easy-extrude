/**
 * RoleService — current-role store for CoordinateFrame provenance enforcement.
 *
 * Stores the active stakeholder role in a module-level variable so it is
 * shared across all AppController instances in the same JS context.
 *
 * Roles (ADR-034 §8):
 *   'modeller'   — geometry modeller; may edit frames they declared.
 *   'integrator' — assembly integrator; may edit frames they declared.
 *   null         — no role set; all frames are editable (permissive mode).
 *
 * Until Auth is integrated, the role is set via the browser DevTools console:
 *   window.__easyExtrude.setRole('modeller')
 *   window.__easyExtrude.setRole(null)
 *
 * Phase P-4 (backlog): replace _currentRole with a read from the Auth session.
 *
 * @see ADR-034 §8.3
 */

/** @type {'modeller' | 'integrator' | null} */
let _currentRole = null

export const RoleService = {
  /** @returns {'modeller' | 'integrator' | null} */
  getRole: () => _currentRole,

  /**
   * @param {'modeller' | 'integrator' | null} role
   */
  setRole: (role) => {
    if (role !== 'modeller' && role !== 'integrator' && role !== null) {
      console.warn(`[RoleService] Unknown role: ${role}. Valid values: 'modeller', 'integrator', null`)
      return
    }
    _currentRole = role
  },

  /**
   * Returns true when the given frame may be edited by the current role.
   * Permissive when frame.declaredBy is null, or when no role is active.
   * @param {import('../domain/CoordinateFrame.js').CoordinateFrame} frame
   * @returns {boolean}
   */
  canEdit: (frame) => {
    if (frame.declaredBy === null) return true   // no restriction
    if (_currentRole === null)     return true   // permissive mode (pre-Auth)
    return frame.declaredBy === _currentRole
  },
}
