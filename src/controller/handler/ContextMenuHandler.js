/**
 * ContextMenuHandler — long-press context menu, Add Frame dialog, Rename dialog.
 *
 * Coordinates between service, commandStack, and UIView for context menu
 * operations. Accesses AppController state via ctrl.* — no state ownership.
 *
 * Owned by AppController as this._contextMenuHandler.
 */

import { Solid }           from '../../domain/Solid.js'
import { CoordinateFrame } from '../../domain/CoordinateFrame.js'
import { ImportedMesh }    from '../../domain/ImportedMesh.js'
import { Profile }         from '../../domain/Profile.js'
import { AnnotatedLine }   from '../../domain/AnnotatedLine.js'
import { AnnotatedRegion } from '../../domain/AnnotatedRegion.js'
import { AnnotatedPoint }  from '../../domain/AnnotatedPoint.js'
import { createMountAnnotationCommand }       from '../../command/MountAnnotationCommand.js'
import { createCreateCoordinateFrameCommand } from '../../command/CreateCoordinateFrameCommand.js'
import { createDeleteSpatialLinkCommand }     from '../../command/DeleteSpatialLinkCommand.js'

export class ContextMenuHandler {
  /** @param {import('../AppController.js').AppController} ctrl */
  constructor(ctrl) {
    this._ctrl = ctrl
  }

  /**
   * Shows the long-press context menu near the touch point.
   * Items vary by object type — only operations valid for `obj` are listed.
   * @param {number} x - client X of the touch
   * @param {number} y - client Y of the touch
   * @param obj - the domain entity that was long-pressed
   */
  showLongPressContextMenu(x, y, obj) {
    const ctrl = this._ctrl
    const id = obj.id
    const canDup = !(obj instanceof ImportedMesh) && !(obj instanceof Profile)
    const isAnnotated = obj instanceof AnnotatedLine || obj instanceof AnnotatedRegion || obj instanceof AnnotatedPoint
    const isSolidOrCF = obj instanceof Solid || obj instanceof CoordinateFrame
    const canAddFrame = obj instanceof Solid || isAnnotated

    // ADR-032 §9: mount / unmount items for Annotated* entities
    const mountLink = isAnnotated ? ctrl._scene.getMountsLink(id) : null
    const hostFrame = mountLink ? ctrl._scene.getObject(mountLink.targetId) : null
    const mountItems = isAnnotated
      ? (mountLink
        ? [{ label: `Unmount ⊗ "${hostFrame?.name ?? '?'}"`, onClick: () => {
            const wb = obj.vertices.map(v => v.position.clone())
            ctrl._service.unmountAnnotation(mountLink, wb)
            const undoCmd = createMountAnnotationCommand(
              mountLink, wb, ctrl._service,
              () => { ctrl._updateNPanel() },
              () => { ctrl._updateNPanel() },
            )
            ctrl._commandStack.push({ label: `Unmount from frame`, execute: undoCmd.undo, undo: undoCmd.execute })
            ctrl._uiView.showToast('Unmounted')
            ctrl._updateNPanel()
          }}]
        : [{ label: 'Mount on frame ⊕', onClick: () => ctrl._startMountPicking(id) }])
      : []

    // ADR-032 §2: unfasten item for CoordinateFrame that is the source of a fastened link
    const fastenedLink = (obj instanceof CoordinateFrame)
      ? ctrl._service.getLinksOf(id).find(l => l.jointType === 'fixed' && l.sourceId === id)
      : null
    const unfastenItems = fastenedLink
      ? [{ label: `Unfasten ⊗ "${ctrl._scene.getObject(fastenedLink.targetId)?.name ?? '?'}"`, onClick: () => {
          const source = ctrl._scene.getObject(id)
          const transform = ctrl._service.getFastenedTransform(fastenedLink.id)
          if (!transform || !(source instanceof CoordinateFrame)) return
          const translationCurrent = source.translation.clone()
          const rotationCurrent    = source.rotation.clone()
          ctrl._service.unfastenFrame(fastenedLink, translationCurrent, rotationCurrent)
          ctrl._commandStack.push({
            label: 'Unfasten frame',
            execute: () => {
              const src = ctrl._scene.getObject(id)
              const tc  = src instanceof CoordinateFrame ? src.translation.clone() : translationCurrent
              const rc  = src instanceof CoordinateFrame ? src.rotation.clone()    : rotationCurrent
              ctrl._service.unfastenFrame(fastenedLink, tc, rc)
              ctrl._updateNPanel()
            },
            undo: () => {
              ctrl._service.refastenFrame(fastenedLink, transform.relativeOffset, transform.relativeQuat)
              ctrl._updateNPanel()
            },
          })
          ctrl._uiView.showToast('Unfastened')
          ctrl._updateNPanel()
        }}]
      : []

    // Topological / annotation links (jointType === null: adjacent, contains,
    // above, connects, references, represents) carry no kinematic constraint,
    // so they have no Unfasten path — but they ARE removable
    // (`detachSpatialLink` is universal). Before this, the only affordance was a
    // per-row delete buried in the N-panel's Spatial Links section, so users
    // reported adjacent links as undeletable (#4 — a discoverability gap, not a
    // hard block). Surface one Disconnect item per topological link here, using
    // the same undoable detach path as the N-panel (createDeleteSpatialLinkCommand).
    const topoLinks = ctrl._service.getLinksOf(id).filter(l => l.jointType === null)
    const disconnectItems = topoLinks.map(l => {
      const otherId   = l.sourceId === id ? l.targetId : l.sourceId
      const otherName = ctrl._scene.getObject(otherId)?.name ?? '?'
      return {
        label: `Disconnect ⊗ ${l.semanticType} · "${otherName}"`,
        onClick: () => {
          const link = ctrl._scene.getLink(l.id)
          if (!link) return
          ctrl._service.detachSpatialLink(l.id)
          ctrl._commandStack.push(createDeleteSpatialLinkCommand(link, ctrl._service))
          ctrl._uiView.showToast(`Disconnected ${link.semanticType}`)
          ctrl._updateNPanel()
        },
      }
    })

    // ADR-032 §9: generic Link to... for Solid / CoordinateFrame
    const linkItems = isSolidOrCF
      ? [{ label: 'Link to... 🔗', onClick: () => {
          ctrl._linkHandler.start()
          ctrl._spatialLinkMode.sourceId = id
        }}]
      : []

    const hasFixedNeighbors = ctrl._service.getConnectedAssembly(id).size > 1
    const assemblyItems = hasFixedNeighbors
      ? [{ label: 'Select Assembly 🔗', onClick: () => ctrl._selectAssembly() }]
      : []

    const items = [
      {
        label: 'Grab',
        onClick: () => ctrl._grabHandler.start(),
      },
      ...(canDup ? [{
        label: 'Duplicate',
        onClick: () => ctrl._duplicateObject(),
      }] : []),
      ...mountItems,
      ...unfastenItems,
      ...disconnectItems,
      ...linkItems,
      ...assemblyItems,
      ...(canAddFrame ? [{
        label: 'Add interface frame ⊞',
        onClick: () => this.promptAddFrame(id),
      }] : []),
      {
        label: 'Rename',
        onClick: () => this.promptRename(id),
      },
      {
        label: 'Delete',
        danger: true,
        onClick: () => ctrl._deleteObject(id),
      },
    ]
    ctrl._uiView.showContextMenu(x, y, items)
  }

  /**
   * Shows a name-input dialog then creates a CoordinateFrame as a child of the
   * given entity. The frame is recorded on the command stack for undo/redo.
   * Called from the long-press context menu (mobile, ADR-033 Phase C-3).
   * @param {string} parentId - ID of the parent entity
   */
  promptAddFrame(parentId) {
    const ctrl = this._ctrl
    if (!ctrl._scene.getObject(parentId)) return
    // Seed the dialog with the same collision-free auto-name the viewport /
    // N-panel "Add Frame" paths use, so accepting the default yields a unique
    // "Frame.NNN" instead of a duplicate literal "Frame" (#9). An empty answer
    // falls back to `null` → the service auto-numbers identically.
    const suggested = ctrl._service.nextEntityName('Frame')
    ctrl._uiView.showRenameDialog(suggested, (name) => {
      if (name === null) return
      const frameName = name.trim() || null
      // User CFs are always parented to the Origin CF of the Solid (ADR-037 §2)
      const parentObj = ctrl._scene.getObject(parentId)
      let effectiveParentId = parentId
      if (parentObj && !(parentObj instanceof CoordinateFrame)) {
        const originFrame = [...ctrl._scene.objects.values()]
          .find(o => o instanceof CoordinateFrame && o.parentId === parentId && o.name === 'Origin')
        if (originFrame) effectiveParentId = originFrame.id
      }
      const frame = ctrl._service.createCoordinateFrame(effectiveParentId, frameName)
      if (!frame) return
      ctrl._commandStack.push(createCreateCoordinateFrameCommand(
        frame, ctrl._service,
        () => {
          const parent = ctrl._scene.getObject(parentId)
          if (parent) ctrl._switchActiveObject(parentId, true)
          else { ctrl._objSelected = false; ctrl._selectedIds.clear(); ctrl._refreshObjectModeStatus(); ctrl._updateMobileToolbar() }
          ctrl._updateNPanel()
        },
        (id) => { ctrl._switchActiveObject(id, true); ctrl._updateNPanel() },
      ))
      ctrl._uiView.showToast(`Frame "${frame.name}" added`)
      ctrl._switchActiveObject(frame.id, true)
      ctrl._updateNPanel()
    }, { title: 'Add Interface Frame' })
  }

  /** Opens the rename prompt for the given object id. */
  promptRename(id) {
    const ctrl = this._ctrl
    const obj = ctrl._scene.getObject(id)
    if (!obj) return
    ctrl._uiView.showRenameDialog(obj.name, (name) => {
      if (name) ctrl._renameObject(id, name)
    })
  }
}
