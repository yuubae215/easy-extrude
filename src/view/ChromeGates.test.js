import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  gateGrab, gateEdit, gateStack, gateDelete,
  gateFrameTransform, gateFrameDelete, gateExtrudeRect, gateUndo, gateRedo,
} from './ChromeGates.js'
import { TOOL_MOUNT_EDIT_DEFERRED_REASON } from '../domain/robotTool.js'
import { Solid }           from '../domain/Solid.js'
import { ImportedMesh }    from '../domain/ImportedMesh.js'
import { MeasureLine }     from '../domain/MeasureLine.js'
import { CoordinateFrame } from '../domain/CoordinateFrame.js'
import { AnnotatedRegion } from '../domain/AnnotatedRegion.js'
import { SpatialLink }     from '../domain/SpatialLink.js'

// instanceof needs only the prototype chain — capability is the runtime type
// (PHILOSOPHY #2), so the gates must never read constructor-initialised state.
const fake = (Cls, props = {}) => Object.assign(Object.create(Cls.prototype), props)

const solid    = () => fake(Solid)
const imported = () => fake(ImportedMesh)
const measure  = () => fake(MeasureLine)
const frame    = (name = 'TCP') => fake(CoordinateFrame, { name })
const region   = () => fake(AnnotatedRegion)
const link     = () => fake(SpatialLink)

test('a locked gate ALWAYS carries a reason; an open gate never does (no silent disabled)', () => {
  const samples = [
    gateGrab(null), gateGrab(solid()), gateGrab(imported()),
    gateEdit(null), gateEdit(solid()), gateEdit(frame()), gateEdit(region()), gateEdit(link()),
    gateStack(null), gateStack(solid()), gateStack(measure()),
    gateDelete(null), gateDelete(solid()),
    gateFrameTransform(null), gateFrameTransform(frame('Origin')), gateFrameTransform(frame()),
    gateExtrudeRect(false), gateExtrudeRect(true),
    gateUndo(false), gateUndo(true), gateRedo(false), gateRedo(true),
  ]
  for (const g of samples) {
    if (g.enabled) assert.equal(g.reason, null)
    else assert.ok(typeof g.reason === 'string' && g.reason.length > 0, 'locked ⇒ non-empty reason')
  }
})

test('gateGrab: selection required; imported geometry is read-only', () => {
  assert.equal(gateGrab(null).enabled, false)
  assert.match(gateGrab(null).reason, /Select an object/)
  assert.match(gateGrab(imported()).reason, /read-only/)
  assert.equal(gateGrab(solid()).enabled, true)
  assert.equal(gateGrab(measure()).enabled, true)
})

test('gateEdit mirrors the entity capability contract (Solid/Sketch/MeasureLine editable)', () => {
  assert.equal(gateEdit(solid()).enabled, true)
  assert.equal(gateEdit(measure()).enabled, true)   // 1D endpoint edit
  assert.equal(gateEdit(imported()).enabled, false)
  assert.equal(gateEdit(frame()).enabled, false)
  assert.equal(gateEdit(region()).enabled, false)
  assert.equal(gateEdit(link()).enabled, false)
})

test('gateStack excludes ImportedMesh / MeasureLine / annotated / links', () => {
  assert.equal(gateStack(solid()).enabled, true)
  assert.equal(gateStack(imported()).enabled, false)
  assert.equal(gateStack(measure()).enabled, false)
  assert.equal(gateStack(region()).enabled, false)
  assert.equal(gateStack(link()).enabled, false)
})

test('gateFrameTransform pins the Origin frame, frees user frames', () => {
  assert.match(gateFrameTransform(frame('Origin')).reason, /Origin frame is fixed/)
  assert.equal(gateFrameTransform(frame('TCP')).enabled, true)
})

test('extrude / undo / redo gates phrase the unmet condition as the next step', () => {
  assert.match(gateExtrudeRect(false).reason, /rectangle/)
  assert.match(gateUndo(false).reason, /undo/i)
  assert.match(gateRedo(false).reason, /redo/i)
})

test('a flange-mounted tcp cannot be moved or rotated yet, and says why (ADR-151 stage 1)', () => {
  const tcp = fake(CoordinateFrame, { name: 'tcp', robotRole: 'tcp', mountedOn: 'flange' })
  const g = gateFrameTransform(tcp)
  assert.equal(g.enabled, false)
  assert.equal(g.reason, TOOL_MOUNT_EDIT_DEFERRED_REASON)
})

test('…but it can be deleted: a robot with no tcp is a declared state, not a forbidden one', () => {
  const tcp = fake(CoordinateFrame, { name: 'tcp', robotRole: 'tcp', mountedOn: 'flange' })
  assert.equal(gateFrameDelete(tcp).enabled, true)
  assert.equal(gateFrameDelete(frame('Origin')).enabled, false)
  assert.match(gateFrameDelete(null).reason, /Select a frame/)
})
