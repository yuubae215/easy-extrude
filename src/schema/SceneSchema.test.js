/**
 * Scene DTO schema conformance + drift binding (ADR-064 Phase 3).
 *
 * schema/scene-1.3.schema.json is the SHAPE contract for the /api/scenes
 * persistence payload (SceneSerializer v1.3). Designed on the Blender datablock
 * principle: the graph skeleton is closed (additionalProperties:false), bulk
 * geometry rides as an opaque base64 blob leaf (envelope-validated only). This
 * suite proves:
 *
 *   1. Conformance — a full v1.3 DTO (every object type + link + transformGraph)
 *      conforms; the ImportedMesh base64 buffers pass as opaque strings.
 *   2. additionalProperties:false — smuggled fields / bad enums are rejected.
 *   3. Drift binding — the schema's version const and object-type enum are
 *      pinned to SCENE_JSON_VERSION and KNOWN_TYPES; the link enums to the
 *      Layout DSL joint/semantic vocabularies (§1.1).
 *
 * The MEANING contract (ref resolution across objects/links/graph) is the
 * domain reconstruct path's job, not the schema's.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import Ajv2020 from 'ajv/dist/2020.js'

import { SCENE_JSON_VERSION, VALID_JOINT_TYPES, VALID_SEMANTIC_TYPES } from '../layout/LayoutDslSchema.js'
import { KNOWN_TYPES } from '../service/SceneImporter.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const readJson = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'))

const schema = readJson('schema/scene-1.3.schema.json')
const ajv = new Ajv2020({ allErrors: true, strict: false })
const validate = ajv.compile(schema)

/** A full v1.3 DTO covering every object type SceneSerializer emits. */
const fullDto = () => ({
  version: '1.3',
  objects: [
    { type: 'Solid', id: 's1', name: 'A', description: '', ifcClass: null, position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 }, localCorners: [{ x: -1, y: -1, z: -1 }, { x: 1, y: 1, z: 1 }] },
    { type: 'Profile', id: 'p1', name: 'P', description: '', sketchRect: { p1: { x: 0, y: 0, z: 0 }, p2: { x: 1, y: 1, z: 0 } } },
    { type: 'MeasureLine', id: 'm1', name: 'M', p1: { x: 0, y: 0, z: 0 }, anchorRef0: null, p2: { x: 1, y: 0, z: 0 }, anchorRef1: 's1' },
    { type: 'CoordinateFrame', id: 'cf1', name: 'F', parentId: null, declaredBy: null, translation: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
    { type: 'ImportedMesh', id: 'im1', name: 'IM', ifcClass: null, positions: 'AAAA', normals: null, indices: null, offset: { x: 0, y: 0, z: 0 } },
    { type: 'AnnotatedLine', id: 'al1', name: 'L', description: '', placeType: null, vertices: [{ id: 'v0', x: 0, y: 0, z: 0 }] },
    { type: 'AnnotatedRegion', id: 'ar1', name: 'R', description: '', placeType: 'Zone', vertices: [{ id: 'v0', x: 0, y: 0, z: 0 }] },
    { type: 'AnnotatedPoint', id: 'ap1', name: 'Pt', description: '', placeType: 'Anchor', vertex: { id: 'v0', x: 0, y: 0, z: 0 } },
  ],
  links: [{ type: 'SpatialLink', id: 'l1', sourceId: 'cf1', targetId: 's1', jointType: null, semanticType: 'adjacent', properties: {} }],
  transformGraph: {
    nodes: [{ id: 'tnode_s1', objectId: 's1', label: 'A', transform: { translation: [0, 0, 0], rotation: [0, 0, 0, 1] } }],
    edges: [{ id: 'tedge_0', parentId: 'tnode_world', childId: 'tnode_s1', constraint: 'fixed' }],
  },
})

// ── 1. Conformance ───────────────────────────────────────────────────────────

test('a full v1.3 DTO (every object type + link + graph) conforms', () => {
  assert.equal(validate(fullDto()), true, JSON.stringify(validate.errors, null, 2))
})

test('an empty scene (objects only) conforms', () => {
  assert.equal(validate({ version: '1.3', objects: [], links: [], transformGraph: { nodes: [], edges: [] } }), true, JSON.stringify(validate.errors))
})

test('a stored scene with an operationGraph blob conforms (declared-open)', () => {
  const dto = fullDto()
  dto.operationGraph = { nodes: [{ id: 'n1', type: 'extrude', params: { h: 5 } }], edges: [] }
  assert.equal(validate(dto), true, JSON.stringify(validate.errors))
})

// ── 2. additionalProperties:false — smuggled fields / bad enums rejected ─────

test('an unknown top-level field is rejected', () => {
  const dto = fullDto(); dto.rogue = 1
  assert.equal(validate(dto), false)
})

test('a bad version is rejected', () => {
  assert.equal(validate({ version: '1.2', objects: [] }), false)
})

test('an unknown object type is rejected', () => {
  assert.equal(validate({ version: '1.3', objects: [{ type: 'Torus', id: 't' }] }), false)
})

test('a smuggled field on a Solid is rejected', () => {
  const dto = fullDto(); dto.objects[0].color = '#f00'
  assert.equal(validate(dto), false)
})

test('a bad link semanticType is rejected', () => {
  const dto = fullDto(); dto.links[0].semanticType = 'glued'
  assert.equal(validate(dto), false)
})

// ── 3. Drift binding: schema pinned to the code's single sources ─────────────

test('schema version const is pinned to SCENE_JSON_VERSION', () => {
  assert.equal(schema.properties.version.const, SCENE_JSON_VERSION)
})

test('schema object-type enum matches KNOWN_TYPES', () => {
  const types = schema.$defs.object.oneOf.map((ref) => {
    const key = ref.$ref.replace('#/$defs/', '')
    return schema.$defs[key].properties.type.const
  })
  assert.deepEqual(types, KNOWN_TYPES)
})

test('schema link jointType enum matches VALID_JOINT_TYPES', () => {
  const jt = schema.$defs.link.properties.jointType.oneOf.find((s) => s.enum)
  assert.deepEqual(jt.enum, VALID_JOINT_TYPES)
})

test('schema link semanticType enum matches VALID_SEMANTIC_TYPES', () => {
  assert.deepEqual(schema.$defs.link.properties.semanticType.enum, VALID_SEMANTIC_TYPES)
})
