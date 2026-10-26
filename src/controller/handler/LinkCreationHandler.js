/**
 * LinkCreationHandler — manages L-key SpatialLink creation flow.
 *
 * Encapsulates the two-phase L-key link creation (select source → click target),
 * link-type picker, mount annotation, and fasten-frame flows.
 *
 * Owned by AppController as this._linkHandler.
 * Accesses parent controller via this._ctrl.
 */

import { CoordinateFrame } from '../../domain/CoordinateFrame.js'
import { Solid }           from '../../domain/Solid.js'
import { AnnotatedLine }   from '../../domain/AnnotatedLine.js'
import { AnnotatedRegion } from '../../domain/AnnotatedRegion.js'
import { AnnotatedPoint }  from '../../domain/AnnotatedPoint.js'
import { createSpatialLinkCommand }     from '../../command/CreateSpatialLinkCommand.js'
import { createMountAnnotationCommand } from '../../command/MountAnnotationCommand.js'
import { createFastenFrameCommand }     from '../../command/FastenFrameCommand.js'
import { LINK_TYPE_COLORS }             from '../../view/SpatialLinkView.js'
import { LinkBindEffect }               from '../../view/LinkBindEffect.js'
import { CONTEXTUAL }                   from '../../view/VisibilityAxes.js'
import { S_LINK_MODE, S_MOUNT_PICKING } from '../../core/editorStates.js'

// ── Module-level helper ───────────────────────────────────────────────────────

/**
 * Returns the set of valid link options for a given source/target entity pair.
 * Each option carries jointType (URDF kinematic), semanticType (domain annotation),
 * and a display label. Based on ADR-038 validation table.
 *
 * @param {object|null} source
 * @param {object|null} target
 * @returns {{ jointType: string|null, semanticType: string, label: string }[]}
 */
function _computeLinkOptions(source, target) {
  const isAnnotated = o => o instanceof AnnotatedLine || o instanceof AnnotatedRegion || o instanceof AnnotatedPoint
  const isCF = o => o instanceof CoordinateFrame

  const options = []

  // ── Kinematic (fixed joint) options ──────────────────────────────────────
  if (isCF(source) && isCF(target)) {
    options.push({ jointType: 'fixed', semanticType: 'fastened', label: 'Fixed · Fastened' })
    options.push({ jointType: 'fixed', semanticType: 'aligned',  label: 'Fixed · Aligned' })
  }
  if (isAnnotated(source) && isCF(target)) {
    options.push({ jointType: 'fixed', semanticType: 'mounts',   label: 'Fixed · Mounts' })
  }

  // ── Topological / semantic annotation options ─────────────────────────────
  if (source instanceof AnnotatedRegion) {
    options.push({ jointType: null, semanticType: 'contains',  label: 'Contains' })
  }
  if (source instanceof AnnotatedLine) {
    if (source.placeType === 'Route' && target instanceof AnnotatedPoint && target.placeType === 'Hub') {
      // Tact-time constrained route connections (deadline + speed stored in properties).
      options.push({ jointType: null, semanticType: 'connects', label: 'Tact 30 s · 1.5 m/s',  properties: { deadline: 30,  speed: 1.5 } })
      options.push({ jointType: null, semanticType: 'connects', label: 'Tact 60 s · 1.5 m/s',  properties: { deadline: 60,  speed: 1.5 } })
      options.push({ jointType: null, semanticType: 'connects', label: 'Tact 120 s · 1.5 m/s', properties: { deadline: 120, speed: 1.5 } })
    } else {
      options.push({ jointType: null, semanticType: 'connects', label: 'Connects' })
    }
  }
  if ((source instanceof AnnotatedLine || source instanceof AnnotatedRegion) && target instanceof Solid) {
    options.push({ jointType: null, semanticType: 'bounded_by', label: 'Bounded By (500mm)',   properties: { clearance: 500 } })
    options.push({ jointType: null, semanticType: 'bounded_by', label: 'Bounded By (1000mm)',  properties: { clearance: 1000 } })
    options.push({ jointType: null, semanticType: 'bounded_by', label: 'Bounded By (no gap)',  properties: { clearance: 0 } })
  }
  // Anchor → CoordinateFrame: tolerance-constrained references presets (ADR-043 Phase 4).
  if (source instanceof AnnotatedPoint && source.placeType === 'Anchor' && isCF(target)) {
    options.push({ jointType: null, semanticType: 'references', label: 'Tolerance ±1 mm',  properties: { tolerance: 1 } })
    options.push({ jointType: null, semanticType: 'references', label: 'Tolerance ±5 mm',  properties: { tolerance: 5 } })
    options.push({ jointType: null, semanticType: 'references', label: 'Tolerance ±10 mm', properties: { tolerance: 10 } })
  } else {
    options.push({ jointType: null, semanticType: 'references', label: 'References' })
  }
  options.push({ jointType: null, semanticType: 'represents', label: 'Represents' })

  return options
}

export class LinkCreationHandler {
  /**
   * @param {import('../AppController.js').AppController} ctrl
   */
  constructor(ctrl) {
    this._ctrl = ctrl

    /**
     * All mutable SpatialLink creation state — mirrored from AppController._spatialLinkMode.
     * AppController._spatialLinkMode must point to this.state after construction.
     * @type {object}
     */
    this.state = {
      /** @type {string|null} ID of the source entity */
      sourceId:        null,
      /** @type {string|null} ID of the candidate target (pending picker) */
      pendingTargetId: null,
    }
  }

  // ── Public operation lifecycle ─────────────────────────────────────────────

  /**
   * Starts the two-phase L-key link creation. Source = currently active entity.
   * Shows all CFs so the target frame is visible for picking.
   */
  start() {
    const { _ctrl: ctrl } = this
    ctrl._opState.send('BEGIN_LINK')
    this.state.sourceId        = ctrl._scene.activeId
    this.state.pendingTargetId = null
    // Show all CFs so the target frame is pickable regardless of selection state.
    // This is a CONTEXTUAL claim like any other (ADR-096): link mode borrows the
    // axis for its duration, and a frame the user explicitly opened stays open
    // under it. Painting the frames directly — as this did — made link mode a
    // third writer of the same pixels.
    ctrl._service.setContextualFrames(
      [...ctrl._scene.objects.values()]
        .filter(obj => obj instanceof CoordinateFrame)
        .map(obj => [obj.id, CONTEXTUAL.FULL]),
    )
    ctrl._uiView.setStatus('Click target entity  [Esc: cancel]')
    ctrl._uiView.setCursor('crosshair')
  }

  /**
   * Cancels link creation mode and restores normal status.
   */
  cancel() {
    const { _ctrl: ctrl } = this
    ctrl._opState.send('CANCEL')
    this.state.sourceId        = null
    this.state.pendingTargetId = null
    this._restoreCFVisibility()
    ctrl._uiView.setCursor('default')
    ctrl._refreshObjectModeStatus()
  }

  /**
   * Opens the link-type picker at (x, y) for the given target entity.
   * Filters valid link types based on source / target entity type (ADR-032 §2).
   * @param {number} x  client X
   * @param {number} y  client Y
   * @param {string} targetId
   */
  showTypePicker(x, y, targetId) {
    const { _ctrl: ctrl } = this
    this.state.pendingTargetId = targetId
    const sourceId   = this.state.sourceId
    const source     = ctrl._scene.getObject(sourceId)
    const target     = ctrl._scene.getObject(targetId)
    const linkOptions = _computeLinkOptions(source, target)
    ctrl._uiView.showLinkTypePicker(x, y, (option) => {
      if (option.semanticType === 'mounts') {
        this.confirmMount(sourceId, targetId)
      } else if (option.jointType === 'fixed') {
        this.confirmFasten(sourceId, targetId, option.semanticType)
      } else {
        this.confirm(option)
      }
    }, { linkOptions })
  }

  /**
   * Shared link creation used by L-key flow and Node Editor (Phase S-2).
   * Creates SpatialLink + records undo command without touching state.
   * @param {string} sourceId
   * @param {string} targetId
   * @param {{ jointType: string|null, semanticType: string, label: string }} option
   */
  createDirect(sourceId, targetId, option) {
    const { _ctrl: ctrl } = this
    const link = ctrl._service.createSpatialLink(sourceId, targetId, option.jointType, option.semanticType, option.properties ?? {})
    ctrl._commandStack.push(createSpatialLinkCommand(link, ctrl._service))
    ctrl._uiView.showToast(`Link created: ${option.label}`)
    ctrl._updateNPanel()
    // Acceptance: light runs from both ends and meets at the midpoint (ADR-166 M4b).
    const srcPos = ctrl._dragSuggestionCentroid(sourceId)
    const tgtPos = ctrl._dragSuggestionCentroid(targetId)
    if (srcPos && tgtPos) {
      const color  = LINK_TYPE_COLORS[option.semanticType]   // unknown type → LinkBindEffect's neutral tone
      ctrl._motion.spawn(reduced =>
        new LinkBindEffect(ctrl._sceneView.scene, srcPos, tgtPos, color, { reduced }))
    }
  }

  /**
   * Creates the SpatialLink from L-key picking flow and records the undo command.
   * @param {{ jointType: string|null, semanticType: string, label: string }} option
   */
  confirm(option) {
    const { sourceId, pendingTargetId } = this.state
    if (!sourceId || !pendingTargetId) return
    this.createDirect(sourceId, pendingTargetId, option)
    this.cancel()
  }

  /**
   * Mounts an Annotated* entity onto a CoordinateFrame and records the command.
   * Called from both the L-key flow (PC) and the mobile mount-picking flow.
   * @param {string} sourceId  Annotated* entity ID
   * @param {string} targetId  CoordinateFrame entity ID
   */
  confirmMount(sourceId, targetId) {
    const { _ctrl: ctrl } = this
    const result = ctrl._service.mountAnnotation(sourceId, targetId)
    if (!result) {
      ctrl._uiView.showToast('Cannot mount — host frame pose unknown', { type: 'warn' })
      return
    }
    const { link, worldPositionsBefore } = result
    ctrl._commandStack.push(createMountAnnotationCommand(
      link, worldPositionsBefore, ctrl._service,
      () => { ctrl._updateNPanel() },
      () => { ctrl._updateNPanel() },
    ))
    ctrl._uiView.showToast(`Mounted on frame "${ctrl._scene.getObject(targetId)?.name}"`)
    this.cancel()
    if (ctrl._opState.is(S_MOUNT_PICKING)) {
      ctrl._mountPicking.sourceId = null
      ctrl._uiView.setCursor('default')
      ctrl._opState.send('CONFIRM')
      ctrl._refreshObjectModeStatus()
    }
    ctrl._updateNPanel()
  }

  /**
   * Fastens a source CoordinateFrame to a target CoordinateFrame and records the command.
   * Called from the L-key link-type picker when the user selects a fixed joint for CF→CF.
   * @param {string} sourceId     CoordinateFrame entity ID (slave / constrained frame)
   * @param {string} targetId     CoordinateFrame entity ID (master / reference frame)
   * @param {string} [semanticType='fastened']  Semantic annotation for the link
   */
  confirmFasten(sourceId, targetId, semanticType = 'fastened') {
    const { _ctrl: ctrl } = this
    const source = ctrl._scene.getObject(sourceId)
    const target = ctrl._scene.getObject(targetId)
    if (!(source instanceof CoordinateFrame) || !(target instanceof CoordinateFrame)) {
      ctrl._uiView.showToast('Select a coordinate frame as source and target', { type: 'warn' })
      return
    }
    // Force-update world poses so cache is fresh even if called between animation ticks
    ctrl._service._updateWorldPoses()
    const result = ctrl._service.fastenFrame(sourceId, targetId, semanticType)
    if (!result) {
      ctrl._uiView.showToast('Cannot fasten — frame pose unknown', { type: 'warn' })
      return
    }
    const { link, translationBefore, rotationBefore, relativeOffset, relativeQuat } = result
    ctrl._commandStack.push(createFastenFrameCommand(
      link, translationBefore, rotationBefore, relativeOffset, relativeQuat, ctrl._service,
      () => { ctrl._updateNPanel() },
      () => { ctrl._updateNPanel() },
    ))
    ctrl._uiView.showToast(`Fastened to "${ctrl._scene.getObject(targetId)?.name}"`)
    this.cancel()
    ctrl._updateNPanel()
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  /**
   * Hands the contextual axis back to the selection after link-creation mode
   * (ADR-096). This used to re-derive "what should be on screen" from the active
   * id — a second implementation of the selection's own rule, which is why it
   * could disagree with it (and why it hid frames the user had explicitly
   * opened). The owner recomputes instead.
   */
  _restoreCFVisibility() {
    this._ctrl._selMgr.refreshFrameContext()
  }
}
