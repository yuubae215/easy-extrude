import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeLayout, PANEL_W, MIN_PANEL_H, MAX_PANEL_H, LEGEND_H,
} from './LinkNetworkLayout.js'
import { ORIGIN_FRAME_NAME } from '../domain/originFrame.js'

/**
 * This file is WHERE ADR-094's rules are asked (CLAUDE.md「After fixing a bug」Q3).
 *
 * Three of them cannot survive as prose:
 *
 *  1. "The Y axis means TF depth and nothing else." Before ADR-094 row 0 held
 *     Solids — entities that are not TF frames at all — so the axis meant a mix
 *     of TF depth and containment depth. Nothing in the code said so; the defect
 *     was only visible as a complaint about the picture. It is asserted here as a
 *     property over the whole node set.
 *  2. "Same scene → same pixels." ADR-048 promised determinism in 2026-06 and
 *     never had a test, because the layout mutated `this` inside a DOM view.
 *     Extracting the pure function is what makes the promise checkable, so the
 *     check is the point of the extraction, not a bonus.
 *  3. Cardinality (原則 #31). Row crowding and label collisions appear only with
 *     N Solids; the 0-link case is a legal state that hides the whole panel and
 *     must not be reached by an empty canvas. A single-fixture suite sees
 *     neither — the same blind spot ADR-093 hit with animation lockstep.
 */

// ── Fixtures ────────────────────────────────────────────────────────────────

/** A Solid + its auto body frame + optional user CFs, in controller shape. */
function solidWithFrames(infos, { id, name, userFrames = [] }) {
  infos.set(id, { name, type: 'cuboid', parentId: null })
  const originId = `${id}_origin`
  infos.set(originId, { name: ORIGIN_FRAME_NAME, type: 'frame', parentId: id })
  for (const cf of userFrames) {
    infos.set(cf.id, { name: cf.name, type: 'frame', parentId: cf.parentId ?? originId })
  }
  return originId
}

function link(id, sourceId, targetId, extra = {}) {
  return { id, sourceId, targetId, semanticType: 'mounts', jointType: null, ...extra }
}

/** Two Solids, each with a user CF under its body frame, linked CF→CF. */
function twoSolidScene() {
  const infos = new Map()
  const oA = solidWithFrames(infos, {
    id: 'solidA', name: 'Base', userFrames: [{ id: 'cfA', name: 'MountA' }],
  })
  const oB = solidWithFrames(infos, {
    id: 'solidB', name: 'Arm', userFrames: [{ id: 'cfB', name: 'MountB' }],
  })
  return { infos, originA: oA, originB: oB, links: [link('l1', 'cfA', 'cfB')] }
}

/** N Solids, each linked to the next — the cardinality that hides row defects. */
function nSolidScene(n) {
  const infos = new Map()
  const links = []
  for (let i = 0; i < n; i++) {
    solidWithFrames(infos, {
      id: `solid${i}`, name: `Part${i}`, userFrames: [{ id: `cf${i}`, name: `Face${i}` }],
    })
    if (i > 0) links.push(link(`l${i}`, `cf${i - 1}`, `cf${i}`))
  }
  return { infos, links }
}

// ── 1. TF invariants — the Y axis is TF depth, and only that ────────────────

test('every non-root node sits strictly below its TF parent', () => {
  const { infos, links } = nSolidScene(4)
  const { nodes } = computeLayout(infos, links)

  let checked = 0
  for (const [, nd] of nodes) {
    if (nd.parentId == null) continue
    const parent = nodes.get(nd.parentId)
    assert.ok(parent, 'a node\'s parent must itself be a node')
    assert.equal(nd.layer, parent.layer + 1)
    assert.ok(nd.y > parent.y, `${nd.label} must render below ${parent.label}`)
    checked++
  }
  assert.ok(checked > 0, 'fixture must actually contain child nodes')
})

test('tree edges lead every node to exactly one root', () => {
  const { infos, links } = nSolidScene(3)
  const { nodes } = computeLayout(infos, links)

  const roots = new Set()
  for (const [id] of nodes) {
    let cur = id
    for (let hop = 0; hop <= nodes.size; hop++) {
      const pid = nodes.get(cur).parentId
      if (pid == null) break
      cur = pid
      assert.ok(nodes.has(cur), 'tree walk must stay inside the graph (no cycles, no dangling)')
    }
    assert.equal(nodes.get(cur).parentId, null)
    roots.add(cur)
  }
  // One root per Solid — the fused node IS that Solid's body frame.
  assert.equal(roots.size, 3)
  for (const rootId of roots) assert.equal(nodes.get(rootId).layer, 0)
})

test('the graph contains no entity that is not a coordinate frame position', () => {
  // Every node either fuses a Solid with its body frame, or is a frame/annotation
  // root that has no body frame. No node stands for a Solid *alongside* its frame,
  // which is the category error that made the Y axis meaningless (ADR-094 D1).
  const { infos, links, originA, originB } = twoSolidScene()
  const { nodes } = computeLayout(infos, links)

  assert.ok(!nodes.has(originA))
  assert.ok(!nodes.has(originB))
  assert.deepEqual([...nodes.keys()].sort(), ['cfA', 'cfB', 'solidA', 'solidB'])
  for (const id of ['solidA', 'solidB']) assert.equal(nodes.get(id).fused, true)
})

// ── 2. Fusion invariants ────────────────────────────────────────────────────

test('the fused node carries the Solid name and the body frame identity', () => {
  const { infos, links, originA } = twoSolidScene()
  const { nodes } = computeLayout(infos, links)

  const fused = nodes.get('solidA')
  assert.equal(fused.label, 'Base')          // not the body frame's fixed name
  assert.equal(fused.frameId, originA)       // TF identity: the body frame
  assert.equal(fused.entityId, 'solidA')     // click target: the Solid (frame is locked)
})

test('a link to the Solid and a link to its body frame resolve to one node', () => {
  const { infos, originA, originB } = twoSolidScene()
  const { nodes, edges } = computeLayout(infos, [
    link('viaSolid', 'solidA', 'solidB'),
    link('viaFrame', originA, originB),
  ])

  const drawn = [...edges.values()]
  assert.equal(drawn.length, 2)
  for (const e of drawn) {
    assert.equal(e.source, 'solidA')
    assert.equal(e.target, 'solidB')
  }
  assert.ok(nodes.has('solidA') && nodes.has('solidB'))
})

test('either member of a fused pair highlights the same node', () => {
  const { infos, links, originA } = twoSolidScene()
  const { nodeIdByEntity } = computeLayout(infos, links)

  assert.equal(nodeIdByEntity.get('solidA'), 'solidA')
  assert.equal(nodeIdByEntity.get(originA), 'solidA')
})

test('a Solid→body-frame link collapses instead of drawing a self-loop', () => {
  const { infos, originA } = twoSolidScene()
  const { edges } = computeLayout(infos, [
    link('selfish', 'solidA', originA),
    link('real', 'solidA', 'solidB'),
  ])
  assert.deepEqual([...edges.keys()], ['real'])
})

test('the body-frame row is gone: user CFs sit one row below the Solid', () => {
  // ADR-094 D2 — the row of identical body-frame labels alone pushed L to 3 and
  // the panel to its max height, crushing the user's CFs into the bottom row.
  const { infos, links } = twoSolidScene()
  const { nodes, rows, svgH } = computeLayout(infos, links)

  assert.equal(rows, 2)
  assert.equal(svgH, MIN_PANEL_H)
  assert.equal(nodes.get('solidA').layer, 0)
  assert.equal(nodes.get('cfA').layer, 1)
})

test('a CF under a user CF still reaches three rows', () => {
  // The height rule is not deleted, only freed from the noise row: real depth
  // still grows the panel.
  const infos = new Map()
  solidWithFrames(infos, {
    id: 'solidA', name: 'Base',
    userFrames: [{ id: 'cf1', name: 'Mount' }, { id: 'cf2', name: 'Tip', parentId: 'cf1' }],
  })
  solidWithFrames(infos, { id: 'solidB', name: 'Arm' })
  const { rows, svgH } = computeLayout(infos, [link('l1', 'cf2', 'solidB')])

  assert.equal(rows, 3)
  assert.equal(svgH, MAX_PANEL_H)
})

test('roots without a body frame stay plain nodes on row 0', () => {
  const infos = new Map()
  solidWithFrames(infos, { id: 'solidA', name: 'Base' })
  infos.set('pt1', { name: 'Station', type: 'annot-point', parentId: null })
  const { nodes } = computeLayout(infos, [link('l1', 'pt1', 'solidA')])

  assert.equal(nodes.get('pt1').fused, false)
  assert.equal(nodes.get('pt1').frameId, null)
  assert.equal(nodes.get('pt1').layer, 0)
})

test('an orphaned body frame keeps its own node rather than vanishing', () => {
  // Corrupted scene: the host is not in the entity set. Dropping the node would
  // silently lose an endpoint the graph still draws an edge to (原則 #11).
  const infos = new Map()
  infos.set('lost', { name: ORIGIN_FRAME_NAME, type: 'frame', parentId: 'gone' })
  infos.set('pt1', { name: 'Station', type: 'annot-point', parentId: null })
  const { nodes, edges } = computeLayout(infos, [link('l1', 'lost', 'pt1')])

  assert.ok(nodes.has('lost'))
  assert.equal(nodes.get('lost').layer, 0)
  assert.equal(edges.size, 1)
})

// ── 3. Cardinality: 0 / 1 / N (原則 #31) ────────────────────────────────────

test('0 links — an empty result, not an empty canvas', () => {
  const { infos } = twoSolidScene()
  const out = computeLayout(infos, [])

  assert.equal(out.nodes.size, 0)
  assert.equal(out.edges.size, 0)
  assert.equal(out.rows, 0)          // the caller hides the whole panel
  assert.equal(out.svgH, MIN_PANEL_H)
  assert.equal(out.denseMode, false)
})

test('0 links because every endpoint is missing from the scene', () => {
  const { infos } = twoSolidScene()
  const out = computeLayout(infos, [link('ghost', 'deleted1', 'deleted2')])
  assert.equal(out.edges.size, 0)
  assert.equal(out.nodes.size, 0)
})

test('no entities at all — every accessor still answers', () => {
  const out = computeLayout(new Map(), [])
  assert.equal(out.nodes.size, 0)
  assert.equal(out.nodeIdByEntity.size, 0)
  assert.equal(out.graphH, MIN_PANEL_H - LEGEND_H)
})

test('missing inputs collapse to the empty result instead of throwing', () => {
  for (const out of [computeLayout(null, null), computeLayout(undefined, undefined)]) {
    assert.equal(out.nodes.size, 0)
    assert.equal(out.rows, 0)
  }
})

test('1 node pair — a two-node graph places both rows inside the canvas', () => {
  const infos = new Map()
  solidWithFrames(infos, { id: 'solidA', name: 'Base', userFrames: [{ id: 'cfA', name: 'Mount' }] })
  const { nodes, graphH } = computeLayout(infos, [link('l1', 'solidA', 'cfA')])

  assert.equal(nodes.size, 2)
  for (const [, nd] of nodes) {
    assert.ok(nd.y >= 0 && nd.y <= graphH, 'nodes stay inside the graph area')
    assert.ok(Number.isFinite(nd.x) && Number.isFinite(nd.y))
  }
})

test('N Solids — rows stay inside the panel and nodes never coincide', () => {
  // The defect class that only exists at N: rows crowd, labels collide, x values
  // pile up at the margins. One Solid can never show it.
  const { infos, links } = nSolidScene(6)
  const { nodes, graphH, denseMode } = computeLayout(infos, links)

  assert.equal(nodes.size, 12)
  const seen = new Set()
  for (const [, nd] of nodes) {
    assert.ok(nd.x >= 0 && nd.x <= PANEL_W, `x=${nd.x} escaped the panel`)
    assert.ok(nd.y >= 0 && nd.y <= graphH, `y=${nd.y} escaped the graph area`)
    const key = `${nd.x.toFixed(3)}:${nd.y.toFixed(3)}`
    assert.ok(!seen.has(key), 'two nodes must not land on the same point')
    seen.add(key)
  }
  assert.equal(denseMode, false, '6 Solids still fit with labels')
})

test('N grows into dense mode instead of overlapping labels', () => {
  const { infos, links } = nSolidScene(12)
  const { denseMode } = computeLayout(infos, links)
  assert.equal(denseMode, true)
})

test('N Solids keep the fusion 1:1 — one node per Solid, none for its frame', () => {
  const N = 5
  const { infos, links } = nSolidScene(N)
  const { nodes } = computeLayout(infos, links)

  const fusedCount = [...nodes.values()].filter(nd => nd.fused).length
  assert.equal(fusedCount, N)
  assert.equal([...nodes.keys()].filter(id => id.endsWith('_origin')).length, 0)
  // Labels are the Solids' — N identical body-frame labels are what ADR-094 removed.
  const labels = [...nodes.values()].filter(nd => nd.fused).map(nd => nd.label).sort()
  assert.deepEqual(labels, ['Part0', 'Part1', 'Part2', 'Part3', 'Part4'])
})

// ── 4. Determinism — ADR-048's core property, finally machine-held ──────────

/** Node/edge geometry in a comparable shape. */
function snapshot(out) {
  return {
    nodes: [...out.nodes].map(([id, nd]) => [id, nd.layer, nd.x, nd.y, nd.label, nd.parentId]),
    edges: [...out.edges].map(([id, e]) => [id, e.source, e.target, e.directed, e.kinematic]),
    rows: out.rows, svgH: out.svgH, denseMode: out.denseMode,
  }
}

test('same scene → same pixels', () => {
  const a = nSolidScene(5)
  const b = nSolidScene(5)
  assert.deepEqual(snapshot(computeLayout(a.infos, a.links)),
                   snapshot(computeLayout(b.infos, b.links)))
})

test('enumeration order of the scene does not move a single pixel', () => {
  // The controller rebuilds `entityInfos` from a Map whose insertion order
  // follows scene mutations; a layout that depended on it would drift the
  // picture on unrelated edits.
  const { infos, links } = nSolidScene(4)
  const reversedInfos = new Map([...infos].reverse())
  const reversedLinks = [...links].reverse()

  assert.deepEqual(snapshot(computeLayout(infos, links)),
                   snapshot(computeLayout(reversedInfos, reversedLinks)))
})

test('computeLayout mutates neither argument', () => {
  const { infos, links } = twoSolidScene()
  const infosBefore = JSON.stringify([...infos])
  const linksBefore = JSON.stringify(links)

  computeLayout(infos, links)

  assert.equal(JSON.stringify([...infos]), infosBefore)
  assert.equal(JSON.stringify(links), linksBefore)
})

test('repeated calls do not accumulate state', () => {
  const { infos, links } = nSolidScene(3)
  const first = snapshot(computeLayout(infos, links))
  computeLayout(infos, links)
  const third = snapshot(computeLayout(infos, links))
  assert.deepEqual(third, first)
})

// ── 5. Edge classification carried through the fusion ───────────────────────

test('kinematic and directed flags survive endpoint resolution', () => {
  const { infos, originA, originB } = twoSolidScene()
  const { edges } = computeLayout(infos, [
    link('joint', originA, originB, { semanticType: 'mounts', jointType: 'revolute' }),
    link('topo',  'solidA', 'solidB', { semanticType: 'adjacent' }),
  ])

  assert.equal(edges.get('joint').kinematic, true)
  assert.equal(edges.get('joint').directed, true)
  assert.equal(edges.get('topo').kinematic, false)
  assert.equal(edges.get('topo').directed, false)
  assert.equal(edges.get('topo').semanticType, 'adjacent')
})

test('an untyped link falls back to a named type, never to undefined', () => {
  const { infos } = twoSolidScene()
  const { edges } = computeLayout(infos, [
    { id: 'bare', sourceId: 'solidA', targetId: 'solidB' },
  ])
  assert.equal(edges.get('bare').semanticType, 'connects')
})

// ── 6. Panel geometry contract (ADR-048 §2.3, inherited unchanged) ──────────

test('the legend strip is reserved outside the graph area', () => {
  const { infos, links } = twoSolidScene()
  const { svgH, graphH } = computeLayout(infos, links)
  assert.equal(graphH, svgH - LEGEND_H)
})

test('panel height never exceeds the Map toolbar clearance cap', () => {
  for (const n of [1, 2, 6, 12]) {
    const { infos, links } = nSolidScene(n + 1)
    const { svgH } = computeLayout(infos, links)
    assert.ok(svgH <= MAX_PANEL_H, `svgH=${svgH} for ${n} Solids`)
  }
})
