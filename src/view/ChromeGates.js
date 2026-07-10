/**
 * ChromeGates — the gate predicates behind every disable-able chrome control
 * (ADR-065 Phase 3, named rule 5 "disabled-as-quest").
 *
 * Each gate returns ONE object `{enabled, reason}`: the caller derives BOTH
 * the disabled flag AND the rendered reason from the same returned value, so
 * the "same function reference" discipline (ADR-058, PHILOSOPHY #25) is
 * structural — a disable can never drift apart from its explanation, and a
 * silent disabled (#11) is unrepresentable: a locked gate always carries a
 * non-empty reason, an open gate always carries `reason: null`.
 *
 * The reasons are quest-phrased: they name the UNMET condition ("Select an
 * object first"), not the refusal — the locked control tells the user what
 * to do next, mirroring the ADR-058 GapNote / wizard-gate wording.
 *
 * Capability follows the entity's runtime type (PHILOSOPHY #2) — these gates
 * restate the type contracts already listed in CODE_CONTRACTS §1 "Entity
 * Capability Contracts"; they must stay in lockstep with them.
 *
 * Pure: no side effects, no view/store access. Consumed by
 * UIStateManager (mobile toolbar descriptors) and Header (undo/redo).
 */
import { ImportedMesh }    from '../domain/ImportedMesh.js'
import { MeasureLine }     from '../domain/MeasureLine.js'
import { CoordinateFrame } from '../domain/CoordinateFrame.js'
import { AnnotatedLine }   from '../domain/AnnotatedLine.js'
import { AnnotatedRegion } from '../domain/AnnotatedRegion.js'
import { AnnotatedPoint }  from '../domain/AnnotatedPoint.js'
import { SpatialLink }     from '../domain/SpatialLink.js'

const OPEN = Object.freeze({ enabled: true, reason: null })
const locked = (reason) => ({ enabled: false, reason })

const isAnnotated = (o) =>
  o instanceof AnnotatedLine || o instanceof AnnotatedRegion || o instanceof AnnotatedPoint

/** Grab/Move availability for the selected entity (null = no selection). */
export function gateGrab(obj) {
  if (!obj) return locked('Select an object first')
  if (obj instanceof ImportedMesh) return locked('Imported geometry is read-only')
  return OPEN
}

/** Edit-mode availability (Solid / Profile / MeasureLine carry editable geometry). */
export function gateEdit(obj) {
  if (!obj) return locked('Select an object first')
  if (obj instanceof ImportedMesh) return locked('Imported geometry is read-only')
  if (obj instanceof CoordinateFrame) return locked('Frames have no editable geometry — select a Solid or Sketch')
  if (isAnnotated(obj) || obj instanceof SpatialLink) return locked('This entity has no editable geometry')
  return OPEN
}

/** Stack-snap availability. */
export function gateStack(obj) {
  if (!obj) return locked('Select an object first')
  if (obj instanceof ImportedMesh) return locked('Imported geometry is read-only')
  if (obj instanceof MeasureLine || isAnnotated(obj) || obj instanceof SpatialLink) {
    return locked('Stack works on Solids and Sketches — select one')
  }
  return OPEN
}

/** Delete availability. */
export function gateDelete(obj) {
  if (!obj) return locked('Select an object first')
  return OPEN
}

/**
 * Move/Rotate/Delete availability for a selected CoordinateFrame: the
 * auto-created Origin frame is pinned to its Solid (ADR-037).
 */
export function gateFrameTransform(frame) {
  if (!frame) return locked('Select a frame first')
  if (frame.name === 'Origin') return locked('The Origin frame is fixed to its Solid')
  return OPEN
}

/** Extrude availability in the 2D sketch phase. */
export function gateExtrudeRect(hasRect) {
  if (!hasRect) return locked('Drag a rectangle on the grid first')
  return OPEN
}

/** Undo availability (fed by CommandStack.canUndo). */
export function gateUndo(canUndo) {
  return canUndo ? OPEN : locked('Nothing to undo yet')
}

/** Redo availability (fed by CommandStack.canRedo). */
export function gateRedo(canRedo) {
  return canRedo ? OPEN : locked('Nothing to redo')
}
