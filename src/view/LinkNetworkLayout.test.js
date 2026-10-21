import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeLayout, layoutSignature, treeSegments, arcPath, labelLines, estimateTextWidth,
  LABEL_LINES, PANEL_W, MIN_PANEL_H, MAX_PANEL_H, LEGEND_H, MAX_LANES,
  SLOT_W, LEVEL_H, LABEL_PAD, NODE_R, STEM_DY,
  NODE_SIGNATURE_FIELDS, NODE_PRESENTATION_IRRELEVANT,
  EDGE_SIGNATURE_FIELDS, EDGE_PRESENTATION_IRRELEVANT, PANEL_SIGNATURE_FIELDS,
} from './LinkNetworkLayout.js'
import { ORIGIN_FRAME_NAME } from '../domain/originFrame.js'

/**
 * This file is WHERE the LINK NETWORK's rules are asked (CLAUDE.md「After fixing
 * a bug」Q3).
 *
 * ADR-094's three:
 *
 *  1. "The vertical axis means TF depth and nothing else." Before ADR-094 the
 *     top tier held Solids — entities that are not TF frames at all. ADR-095
 *     moved depth to the indent; ADR-167 moves it back to y, where the person
 *     reading the panel wanted it. The invariant never changed: a child renders
 *     below its parent.
 *  2. "Same scene → same pixels." Determinism, including the LANE a cotree edge
 *     lands in — order-independent of the caller's link list.
 *  3. Cardinality (原則 #31). Lane collisions and scrolling appear only with N
 *     entities; the 0-link case is a legal state that hides the whole panel and
 *     must not be reached by an empty canvas.
 *
 * ADR-095's goal, kept through ADR-167's geometry change:
 *
 *  4. **A label's width divides by nothing.** In the old layered drawing it was
 *     `196 / siblings` and degraded to a dot strip (`denseMode`). Now every node
 *     owns a fixed slot and the CONTENT grows and scrolls instead — so the label
 *     width is asserted to be a constant, and `denseMode` is asserted ABSENT.
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

/** A CF chain `depth` levels below one Solid — the scene that grows the tree downward. */
function deepChainScene(depth) {
  const infos = new Map()
  const userFrames = []
  for (let i = 1; i <= depth; i++) {
    userFrames.push({ id: `cf${i}`, name: `Lv${i}`, parentId: i === 1 ? undefined : `cf${i - 1}` })
  }
  solidWithFrames(infos, { id: 'solidA', name: 'Base', userFrames })
  return { infos, links: [link('l1', 'solidA', `cf${depth}`)] }
}

/**
 * One Solid with k sibling CFs linked consecutively. Adjacent column intervals
 * always alternate between two lanes, so this varies the SIBLING count while
 * holding lane usage fixed.
 */
function siblingChainScene(k) {
  const infos = new Map()
  const names = 'ABCDEFGHIJ'.split('').slice(0, k)
  solidWithFrames(infos, {
    id: 'solidA', name: 'Base', userFrames: names.map(n => ({ id: `cf${n}`, name: n })),
  })
  const links = names.slice(1).map((n, i) => link(`e${i}`, `cf${names[i]}`, `cf${n}`))
  return { infos, links }
}

/**
 * One Solid with 2·k CFs and k links, arranged so every link's column interval
 * overlaps every other's — the only shape that can exhaust the lane budget.
 */
function interleavedScene(k) {
  const infos = new Map()
  const names = 'ABCDEFGHIJKL'.split('')
  const userFrames = []
  for (let i = 0; i < 2 * k; i++) userFrames.push({ id: `cf${names[i]}`, name: names[i] })
  solidWithFrames(infos, { id: 'solidA', name: 'Base', userFrames })
  const links = []
  for (let i = 0; i < k; i++) {
    links.push(link(`x${i}`, `cf${names[i]}`, `cf${names[i + k]}`))
  }
  return { infos, links }
}

// ── 1. TF invariants — a child renders below its parent ────────────────────

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
  // which is the category error that made the depth axis meaningless (ADR-094 D1).
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

test('the body-frame tier is gone: user CFs sit one level below the Solid', () => {
  // ADR-094 D2 — the tier of identical body-frame labels alone pushed the depth
  // to 3. That win is kept: depth reads 2, and the child is LOWER (ADR-167),
  // directly under its parent.
  const { infos, links } = twoSolidScene()
  const { nodes, depth, svgH } = computeLayout(infos, links)

  assert.equal(depth, 2)
  assert.equal(svgH, MIN_PANEL_H)
  assert.equal(nodes.get('solidA').layer, 0)
  assert.equal(nodes.get('cfA').layer, 1)
  assert.equal(nodes.get('cfA').y - nodes.get('solidA').y, LEVEL_H)
  assert.equal(nodes.get('cfA').x, nodes.get('solidA').x, 'an only child sits straight under its parent')
})

test('a CF under a user CF reaches three levels and still fits the minimum panel', () => {
  const infos = new Map()
  solidWithFrames(infos, {
    id: 'solidA', name: 'Base',
    userFrames: [{ id: 'cf1', name: 'Mount' }, { id: 'cf2', name: 'Tip', parentId: 'cf1' }],
  })
  solidWithFrames(infos, { id: 'solidB', name: 'Arm' })
  const { nodes, depth, svgH, scrollY } = computeLayout(infos, [link('l1', 'cf2', 'solidB')])

  assert.equal(depth, 3)
  assert.equal(nodes.size, 4)
  assert.equal(svgH, MIN_PANEL_H)
  assert.equal(scrollY, false)
  assert.equal(nodes.get('cf2').layer, 2)
})

test('roots without a body frame stay plain nodes at depth 0', () => {
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

test('a parentId cycle still places every member — as roots, never dropped', () => {
  const infos = new Map()
  infos.set('a', { name: 'A', type: 'frame', parentId: 'b' })
  infos.set('b', { name: 'B', type: 'frame', parentId: 'a' })
  infos.set('pt', { name: 'P', type: 'annot-point', parentId: null })
  const { nodes, depth } = computeLayout(infos, [link('l1', 'a', 'pt')])

  assert.ok(nodes.has('a') && nodes.has('b') && nodes.has('pt'))
  assert.ok(depth <= 2, `a cycle must not grow the tree downward (depth ${depth})`)
  for (const [, nd] of nodes) assert.ok(Number.isFinite(nd.x) && Number.isFinite(nd.y))
})

// ── 3. Cardinality: 0 / 1 / N (原則 #31) ────────────────────────────────────

test('0 links — an empty result, not an empty canvas', () => {
  const { infos } = twoSolidScene()
  const out = computeLayout(infos, [])

  assert.equal(out.nodes.size, 0)
  assert.equal(out.edges.size, 0)
  assert.equal(out.columns, 0)       // the caller hides the whole panel
  assert.equal(out.svgH, MIN_PANEL_H)
})

test('0 cotree lanes reserve 0 arc headroom — an absent thing is not pre-allocated', () => {
  // 原則 #31 / the Yellow Card on defaults: "no arcs" must not silently push the
  // tree down by the height of bows that do not exist.
  const out = computeLayout(new Map(), [])
  assert.equal(out.lanes, 0)
  assert.equal(out.dropped, 0)

  const { infos, links } = twoSolidScene()
  const one = computeLayout(infos, links)
  assert.equal(one.lanes, 1)
  const topY = Math.min(...[...one.nodes.values()].map(nd => nd.y))
  // With one lane in use the top level sits below exactly one lane of headroom.
  assert.ok(topY > NODE_R && topY < NODE_R + 30, `top level at y=${topY}`)
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
  assert.equal(out.contentW, PANEL_W)
})

test('missing inputs collapse to the empty result instead of throwing', () => {
  for (const out of [computeLayout(null, null), computeLayout(undefined, undefined)]) {
    assert.equal(out.nodes.size, 0)
    assert.equal(out.columns, 0)
  }
})

test('1 node pair — parent over child, both inside the content, nothing scrolls', () => {
  const infos = new Map()
  solidWithFrames(infos, { id: 'solidA', name: 'Base', userFrames: [{ id: 'cfA', name: 'Mount' }] })
  const { nodes, contentW, contentH, columns, scrollX, scrollY } =
    computeLayout(infos, [link('l1', 'solidA', 'cfA')])

  assert.equal(nodes.size, 2)
  assert.equal(columns, 1)
  assert.equal(scrollX, false)
  assert.equal(scrollY, false)
  for (const [, nd] of nodes) {
    assert.ok(nd.x >= 0 && nd.x <= contentW, 'nodes stay inside the content')
    assert.ok(nd.y >= 0 && nd.y <= contentH, 'nodes stay inside the content')
  }
})

test('1 cotree edge — exactly one lane', () => {
  const { infos, links } = twoSolidScene()
  const out = computeLayout(infos, links)
  assert.equal(out.edges.size, 1)
  assert.equal(out.lanes, 1)
  assert.equal([...out.edges.values()][0].lane, 0)
  assert.equal(out.dropped, 0)
})

test('N Solids — no two nodes on one level are closer than one slot', () => {
  // The defect class that only exists at N: siblings crowd and labels collide.
  // A one-Solid fixture can never show it.
  const { infos, links } = nSolidScene(6)
  const { nodes, contentW, contentH } = computeLayout(infos, links)

  assert.equal(nodes.size, 12)
  const byLevel = new Map()
  for (const [, nd] of nodes) {
    assert.ok(nd.x >= 0 && nd.x <= contentW, `x=${nd.x} escaped the content`)
    assert.ok(nd.y >= 0 && nd.y <= contentH, `y=${nd.y} escaped the content`)
    byLevel.set(nd.layer, [...(byLevel.get(nd.layer) ?? []), nd.x])
  }
  for (const [level, xs] of byLevel) {
    xs.sort((a, b) => a - b)
    for (let i = 1; i < xs.length; i++) {
      assert.ok(xs[i] - xs[i - 1] >= SLOT_W, `level ${level}: two nodes ${xs[i] - xs[i - 1]}px apart`)
    }
  }
})

test('N Solids keep the fusion 1:1 — one node per Solid, none for its frame', () => {
  const N = 5
  const { infos, links } = nSolidScene(N)
  const { nodes } = computeLayout(infos, links)

  const fusedCount = [...nodes.values()].filter(nd => nd.fused).length
  assert.equal(fusedCount, N)
  assert.equal([...nodes.keys()].filter(id => id.endsWith('_origin')).length, 0)
  const labels = [...nodes.values()].filter(nd => nd.fused).map(nd => nd.label).sort()
  assert.deepEqual(labels, ['Part0', 'Part1', 'Part2', 'Part3', 'Part4'])
})

// ── 4. G1 — a label's width divides by nothing ──────────────────────────────

test('the width a label may use is a constant — not siblings, not depth', () => {
  // THE claim ADR-095 made and ADR-167 keeps under a top-down geometry. The old
  // layered drawing gave `196 / siblings`; the slot width does not divide.
  for (const scene of [siblingChainScene(3), siblingChainScene(10), deepChainScene(6), nSolidScene(12)]) {
    for (const [, nd] of computeLayout(scene.infos, scene.links).nodes) {
      assert.equal(nd.labelW, SLOT_W - LABEL_PAD, `${nd.label} got ${nd.labelW}px`)
    }
  }
  assert.ok(SLOT_W - LABEL_PAD > 2 * 22, 'the slot is well above the old dot-strip threshold (DENSE_SLOT = 22)')
})

test('a wider scene widens the content and scrolls — it never narrows a slot', () => {
  const few  = siblingChainScene(3)
  const many = siblingChainScene(10)
  const a = computeLayout(few.infos,  few.links)
  const b = computeLayout(many.infos, many.links)

  assert.equal(b.columns, a.columns + 7, 'the fixtures must really differ in sibling count')
  assert.equal(a.scrollX, false)
  assert.equal(b.scrollX, true)
  assert.ok(b.contentW > PANEL_W)
  const pitch = (out) => {
    const xs = [...out.nodes.values()].filter(nd => nd.layer === 1).map(nd => nd.x).sort((p, q) => p - q)
    return xs[1] - xs[0]
  }
  assert.equal(pitch(a), SLOT_W)
  assert.equal(pitch(b), SLOT_W, 'sibling pitch is constant regardless of scene size')
})

test('denseMode is gone — no scene of any size brings the dot strip back', () => {
  // 台帳 §既知の負債 3: a retired state that stays in the returned shape is how
  // the next author re-enables it by accident. The flag's ABSENCE is the check.
  for (const n of [2, 3, 6, 12, 24]) {
    const { infos, links } = nSolidScene(n)
    const out = computeLayout(infos, links)
    assert.equal('denseMode' in out, false, `denseMode came back at n=${n}`)
    for (const [, nd] of out.nodes) {
      assert.ok(nd.labelW > 0, `every node keeps a label at n=${n}`)
    }
  }
})

test('a two-word name wraps instead of being cut — "Robot pedestal", not "Robot ped…"', () => {
  const W = SLOT_W - LABEL_PAD
  assert.deepEqual(labelLines('Robot pedestal', W), ['Robot', 'pedestal'])
  assert.deepEqual(labelLines('Workbench', W), ['Workbench'])
  assert.deepEqual(labelLines('Cube', W), ['Cube'])
})

test('a label never exceeds its lines or its width — the loss is one visible ellipsis', () => {
  const W = SLOT_W - LABEL_PAD
  for (const label of [
    'Supply bin A', 'Robot mounting plate on pedestal', 'Infeed station',
    'averyveryverylongsinglewordname', '工程レイアウトの台座', '', 'a b c d e f g h i j k l m n',
  ]) {
    const lines = labelLines(label, W)
    assert.ok(lines.length >= 1 && lines.length <= LABEL_LINES, `${label} → ${lines.length} lines`)
    for (const line of lines) assert.ok(estimateTextWidth(line) <= W, `"${line}" overflows its slot`)
    const shown = lines.join(' ').replace(/…$/, '')
    if (!lines.join('').endsWith('…')) assert.equal(shown, label.split(/\s+/).filter(Boolean).join(' '))
  }
  assert.ok(labelLines('Robot mounting plate on pedestal', W).at(-1).endsWith('…'))
  assert.ok(labelLines('averyveryverylongsinglewordname', W)[0].endsWith('…'))
})

// ── 5. G2 — depth is the vertical position ──────────────────────────────────

test('y is a function of TF depth and of nothing else', () => {
  const { infos, links } = nSolidScene(8)
  const { nodes } = computeLayout(infos, links)

  const yByDepth = new Map()
  for (const [, nd] of nodes) {
    if (yByDepth.has(nd.layer)) assert.equal(yByDepth.get(nd.layer), nd.y)
    else yByDepth.set(nd.layer, nd.y)
  }
  const depths = [...yByDepth.keys()].sort((a, b) => a - b)
  for (let i = 1; i < depths.length; i++) {
    assert.equal(yByDepth.get(depths[i]) - yByDepth.get(depths[i - 1]), LEVEL_H)
  }
})

test('a parent is centred over its first and last child', () => {
  const { infos, links } = siblingChainScene(5)
  const { nodes } = computeLayout(infos, links)
  const kids = [...nodes.values()].filter(nd => nd.parentId === 'solidA').map(nd => nd.x)
  assert.equal(kids.length, 5)
  assert.equal(nodes.get('solidA').x, (Math.min(...kids) + Math.max(...kids)) / 2)
})

test('a deep chain grows downward and scrolls rather than squeezing levels', () => {
  const { infos, links } = deepChainScene(6)
  const out = computeLayout(infos, links)
  assert.equal(out.depth, 7)
  assert.equal(out.scrollY, true)
  assert.ok(out.contentH > out.graphH)
  assert.ok(out.svgH <= MAX_PANEL_H)
})

// ── 6. Tree segments — the skeleton the view draws ──────────────────────────

test('every child hangs from its parent: one drop per child, one stem per parent', () => {
  const { infos, links } = siblingChainScene(4)
  const { nodes } = computeLayout(infos, links)
  const segs = treeSegments(nodes)

  const parent = nodes.get('solidA')
  const kids = [...nodes.values()].filter(nd => nd.parentId === 'solidA')
  const stems = segs.filter(s => s.x1 === parent.x && s.y1 === parent.y + STEM_DY)
  assert.equal(stems.length, 1, 'one stem below the parent\'s label')
  for (const k of kids) {
    const drops = segs.filter(s => s.x1 === k.x && s.x2 === k.x && s.y2 < k.y && s.y2 > parent.y)
    assert.equal(drops.length, 1, `${k.label} must have exactly one drop`)
  }
  // The bar spans exactly the children.
  const bars = segs.filter(s => s.y1 === s.y2)
  assert.equal(bars.length, 1)
  assert.equal(Math.min(bars[0].x1, bars[0].x2), Math.min(...kids.map(k => k.x)))
  assert.equal(Math.max(bars[0].x1, bars[0].x2), Math.max(...kids.map(k => k.x)))
})

test('the stem starts below the parent\'s label, never through it', () => {
  const { infos, links } = twoSolidScene()
  const { nodes } = computeLayout(infos, links)
  for (const seg of treeSegments(nodes)) {
    for (const [, nd] of nodes) {
      const crossesLabel = seg.x1 === nd.x && seg.x2 === nd.x &&
        Math.min(seg.y1, seg.y2) < nd.y + STEM_DY && Math.max(seg.y1, seg.y2) > nd.y + NODE_R
      assert.equal(crossesLabel, false, `a tree line crosses ${nd.label}'s label`)
    }
  }
})

// ── 7. Cotree lanes — crowding is paid for HERE, not by the labels ──────────

test('lanes are assigned so that two edges sharing a lane never overlap', () => {
  const { infos, links } = interleavedScene(3)
  const { nodes, edges, lanes } = computeLayout(infos, links)

  assert.equal(lanes, 3)
  const byLane = new Map()
  for (const [, e] of edges) {
    if (e.dropped) continue
    const a = Math.min(nodes.get(e.source).slot, nodes.get(e.target).slot)
    const b = Math.max(nodes.get(e.source).slot, nodes.get(e.target).slot)
    for (const other of byLane.get(e.lane) ?? []) {
      assert.ok(b < other.a || a > other.b,
        `lane ${e.lane} holds overlapping intervals [${a},${b}] and [${other.a},${other.b}]`)
    }
    byLane.set(e.lane, [...(byLane.get(e.lane) ?? []), { a, b }])
  }
})

test('a higher lane bows higher — overlapping arcs do not draw on top of each other', () => {
  const { infos, links } = interleavedScene(3)
  const { edges } = computeLayout(infos, links)
  const byLane = [...edges.values()].filter(e => !e.dropped).sort((p, q) => p.lane - q.lane)
  for (let i = 1; i < byLane.length; i++) {
    assert.ok(byLane[i].cy < byLane[i - 1].cy, 'lane l+1 must sit above lane l')
  }
})

test('lane assignment does not depend on the order the links arrive in', () => {
  // The caller's link list is ordered by scene mutation history, so deleting and
  // re-adding an unrelated link must not re-shuffle the bows.
  const { infos, links } = interleavedScene(3)
  const laneMap = (ls) => {
    const out = {}
    for (const [id, e] of computeLayout(infos, ls).edges) out[id] = `${e.lane}:${e.dropped}`
    return out
  }
  assert.deepEqual(laneMap([...links].reverse()), laneMap(links))
  assert.deepEqual(laneMap([links[2], links[0], links[1]]), laneMap(links))
})

test('links past the lane budget become a counted badge, never a silent drop', () => {
  // 原則 #11: the degradation is visible arithmetic. Every dropped edge is
  // counted on BOTH of its endpoints, so "there is more here" is answerable
  // from either end.
  const k = MAX_LANES + 1
  const { infos, links } = interleavedScene(k)
  const { nodes, edges, lanes, dropped } = computeLayout(infos, links)

  assert.equal(lanes, MAX_LANES)
  assert.equal(dropped, k - MAX_LANES)

  const droppedEdges = [...edges.values()].filter(e => e.dropped)
  assert.equal(droppedEdges.length, dropped)
  for (const e of droppedEdges) {
    assert.equal(e.lane, null)
    assert.equal(e.cx, null)
  }

  const badgeTotal = [...nodes.values()].reduce((s, nd) => s + nd.overflow, 0)
  assert.equal(badgeTotal, dropped * 2, 'each dropped link is counted at both ends')
})

test('every drawn bow stays inside the content — headroom is reserved for the lanes in use', () => {
  for (const scene of [interleavedScene(MAX_LANES), twoSolidScene(), nSolidScene(6)]) {
    const { nodes, edges, contentW } = computeLayout(scene.infos, scene.links)
    for (const [, e] of edges) {
      if (e.dropped) continue
      const u = nodes.get(e.source), v = nodes.get(e.target)
      // Quadratic Bézier midpoint = the bow's extreme for a symmetric bow.
      const midY = (u.y + 2 * e.cy + v.y) / 4
      const midX = (u.x + 2 * e.cx + v.x) / 4
      assert.ok(midY >= 0, `bow apex at y=${midY} escaped the top`)
      assert.ok(midX >= 0 && midX <= contentW, `bow apex at x=${midX} escaped the sides`)
    }
  }
})

test('an arc meets each dot at its rim, so the arrowhead lands on the target', () => {
  const { infos, links } = twoSolidScene()
  const { nodes, edges } = computeLayout(infos, links)
  const e = [...edges.values()][0]
  const u = nodes.get(e.source), v = nodes.get(e.target)
  const nums = arcPath(e, u, v).match(/-?\d+(\.\d+)?/g).map(Number)
  const [x0, y0] = nums, [x1, y1] = nums.slice(-2)
  assert.ok(Math.abs(Math.hypot(x0 - u.x, y0 - u.y) - (NODE_R + 1)) < 0.05)
  assert.ok(Math.abs(Math.hypot(x1 - v.x, y1 - v.y) - (NODE_R + 1.5)) < 0.05)
})

// ── 8. Determinism — ADR-048's core property, machine-held ──────────────────

/** Node/edge geometry in a comparable shape — lanes and bows included. */
function snapshot(out) {
  return {
    nodes: [...out.nodes].map(([id, nd]) =>
      [id, nd.layer, nd.slot, nd.x, nd.y, nd.labelW, nd.label, nd.parentId, nd.overflow]),
    edges: [...out.edges].map(([id, e]) =>
      [id, e.source, e.target, e.directed, e.kinematic, e.lane, e.dropped, e.cx, e.cy]),
    columns: out.columns, depth: out.depth, lanes: out.lanes,
    svgH: out.svgH, contentH: out.contentH, contentW: out.contentW,
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

// ── 9. Edge classification carried through the fusion ───────────────────────

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

// ── 10. Panel geometry contract (ADR-048 §2.3, inherited unchanged) ─────────

test('the legend strip is reserved outside the graph area', () => {
  const { infos, links } = twoSolidScene()
  const { svgH, graphH } = computeLayout(infos, links)
  assert.equal(graphH, svgH - LEGEND_H)
})

test('panel height never exceeds the Map toolbar clearance cap', () => {
  for (const n of [1, 2, 6, 12, 40]) {
    const { infos, links } = nSolidScene(n + 1)
    const { svgH } = computeLayout(infos, links)
    assert.ok(svgH <= MAX_PANEL_H, `svgH=${svgH} for ${n} Solids`)
    assert.ok(svgH >= MIN_PANEL_H, `svgH=${svgH} shrank below the floor for ${n} Solids`)
  }
})

// ── 11. Layout equivalence (ADR-099) ────────────────────────────────────────
//
// The view rebuilds its DOM only when this signature changes, so the panel's
// row elements outlive the pointer gesture aimed at them (ADR-099 G3). That
// buys back the `click` event and costs one new failure mode — "the layout
// changed but the DOM did not" — which is payable only here, on the pure side.
//
// The field list is therefore asserted COMPLETE by counting rather than by
// eyeballing: a field added to a layout node without a decision about it fails
// this test instead of quietly dropping out of the equivalence (原則 #31 — the
// unaccounted field has no node to walk, so a check that walks the declared
// fields would never see it).

test('署名の欄は勘定が合っている — 未分類のフィールドが 0 個 (両向き)', () => {
  const { infos, links } = nSolidScene(4)
  const layout = computeLayout(infos, links)
  assert.ok(layout.nodes.size > 0 && layout.edges.size > 0, '検査が空回りしている')

  const nodeDeclared = new Set([...NODE_SIGNATURE_FIELDS, ...NODE_PRESENTATION_IRRELEVANT])
  for (const nd of layout.nodes.values()) {
    assert.deepEqual(Object.keys(nd).filter(k => !nodeDeclared.has(k)), [],
      'レイアウトノードに、署名でも「描画に無関係」でもないフィールドが在る')
    assert.deepEqual([...nodeDeclared].filter(k => !Object.hasOwn(nd, k)), [],
      '宣言された欄が実在しない — 署名が実体から離れている')
  }

  const edgeDeclared = new Set([...EDGE_SIGNATURE_FIELDS, ...EDGE_PRESENTATION_IRRELEVANT])
  for (const e of layout.edges.values()) {
    assert.deepEqual(Object.keys(e).filter(k => !edgeDeclared.has(k)), [])
    assert.deepEqual([...edgeDeclared].filter(k => !Object.hasOwn(e, k)), [])
  }

  for (const f of PANEL_SIGNATURE_FIELDS) {
    assert.ok(Object.hasOwn(layout, f), `パネル欄 ${f} がレイアウト結果に無い`)
  }
})

test('同じシーンは同じ署名 — hover しても選択しても再構築されない', () => {
  const { infos, links } = twoSolidScene()
  // 署名は選択・hover を一切見ない (見ていたら、見た瞬間にあの閉路が戻る)。
  assert.equal(layoutSignature(computeLayout(infos, links)),
               layoutSignature(computeLayout(infos, links)))
})

test('レイアウトを変える変更はすべて署名を変える (DOM が古くならない)', () => {
  const base = () => {
    const { infos, links } = twoSolidScene()
    return { infos, links }
  }
  const sig = (m) => {
    const { infos, links } = base()
    m(infos, links)
    return layoutSignature(computeLayout(infos, links))
  }
  const original = sig(() => {})

  const mutations = {
    'ラベルの変更 (ノードのテキスト)': (infos) => {
      infos.set('solidA', { ...infos.get('solidA'), name: 'Renamed' })
    },
    '実体種の変更 (ドットの色)': (infos) => {
      infos.set('solidA', { ...infos.get('solidA'), type: 'imported' })
    },
    'ノードの追加 (列が増える)': (infos, links) => {
      infos.set('solidC', { name: 'Extra', type: 'cuboid', parentId: null })
      links.push(link('l2', 'cfA', 'solidC'))
    },
    'リンク種の変更 (弧の色と矢印)': (infos, links) => {
      links[0] = link('l1', 'cfA', 'cfB', { semanticType: 'adjacent' })
    },
    '関節の付与 (弧の太さ)': (infos, links) => {
      links[0] = link('l1', 'cfA', 'cfB', { jointType: 'revolute' })
    },
  }

  for (const [what, mutate] of Object.entries(mutations)) {
    assert.notEqual(sig(mutate), original,
      `${what} が署名に現れない — 「レイアウトが変わったのに DOM が古い」が書ける`)
  }
})
