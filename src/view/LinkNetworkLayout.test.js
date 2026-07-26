import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeLayout, laneX, gutterX,
  PANEL_W, MIN_PANEL_H, MAX_PANEL_H, LEGEND_H, ROW_H, MAX_INDENT_DEPTH, MAX_LANES,
} from './LinkNetworkLayout.js'
import { ORIGIN_FRAME_NAME } from '../domain/originFrame.js'

/**
 * This file is WHERE the LINK NETWORK's rules are asked (CLAUDE.md「After fixing
 * a bug」Q3).
 *
 * ADR-094's three:
 *
 *  1. "The Y axis means TF depth and nothing else." Before ADR-094 row 0 held
 *     Solids — entities that are not TF frames at all — so the axis meant a mix
 *     of TF depth and containment depth. It is asserted here as a property over
 *     the whole node set. ADR-095 moved the *axis* (depth is now x) but not the
 *     invariant: a child still renders after its parent, and these tests did not
 *     have to change to say so.
 *  2. "Same scene → same pixels." ADR-048 promised determinism in 2026-06 and
 *     never had a test, because the layout mutated `this` inside a DOM view.
 *     ADR-095 adds a second thing that must be order-independent: the LANE a
 *     cotree edge lands in.
 *  3. Cardinality (原則 #31). Lane collisions, indent saturation and scrolling
 *     appear only with N entities; the 0-link case is a legal state that hides
 *     the whole panel and must not be reached by an empty canvas. A single
 *     fixture sees neither — the blind spot ADR-093 hit with lockstep.
 *
 * And ADR-095's one, which is the reason for the geometry swap:
 *
 *  4. **Degradation runs the other way now.** A label's width must not divide by
 *     the sibling count, and crowding must be paid for by the arcs (lanes →
 *     "+N") instead. `denseMode` — the flag that spelled out "when information
 *     grows, give up on knowing who" — must not come back, so its absence is
 *     asserted rather than assumed (台帳 §既知の負債 3: retired states that stay
 *     in the enum).
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

/** A CF chain `depth` levels below one Solid — the only way to saturate indent. */
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
 * One Solid with k sibling CFs linked consecutively. Adjacent row intervals
 * always alternate between two lanes, so this varies the SIBLING count while
 * holding lane usage — and therefore the gutter — fixed. That separation is the
 * point: ADR-095 claims label width is independent of siblings, not that it is
 * independent of link crowding (a busy gutter does cost width, boundedly).
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
 * One Solid with 2·k CFs and k links, arranged so every link's row interval
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

// ── 1. TF invariants — a child still renders after its parent ───────────────

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

test('the body-frame row is gone: user CFs sit one indent below the Solid', () => {
  // ADR-094 D2 — the row of identical body-frame labels alone pushed the depth
  // to 3. ADR-095 keeps that win and renames where it is visible: depth is the
  // indent now, so it is `depth`, not `rows`, that must read 2.
  const { infos, links } = twoSolidScene()
  const { nodes, depth, svgH } = computeLayout(infos, links)

  assert.equal(depth, 2)
  assert.equal(svgH, MIN_PANEL_H)
  assert.equal(nodes.get('solidA').layer, 0)
  assert.equal(nodes.get('cfA').layer, 1)
  assert.ok(nodes.get('cfA').x > nodes.get('solidA').x, 'the child is indented, not lowered a tier')
})

test('a CF under a user CF still reaches three levels — and no longer grows the panel', () => {
  // The depth rule is not deleted, only disconnected from the panel height:
  // ADR-095 pays for depth in x (indent), so 4 rows of real depth fit at the
  // minimum height instead of forcing the maximum.
  const infos = new Map()
  solidWithFrames(infos, {
    id: 'solidA', name: 'Base',
    userFrames: [{ id: 'cf1', name: 'Mount' }, { id: 'cf2', name: 'Tip', parentId: 'cf1' }],
  })
  solidWithFrames(infos, { id: 'solidB', name: 'Arm' })
  const { nodes, depth, rows, svgH } = computeLayout(infos, [link('l1', 'cf2', 'solidB')])

  assert.equal(depth, 3)
  assert.equal(rows, 4)                       // one row per node, not per tier
  assert.equal(svgH, MIN_PANEL_H)
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

// ── 3. Cardinality: 0 / 1 / N (原則 #31) ────────────────────────────────────

test('0 links — an empty result, not an empty canvas', () => {
  const { infos } = twoSolidScene()
  const out = computeLayout(infos, [])

  assert.equal(out.nodes.size, 0)
  assert.equal(out.edges.size, 0)
  assert.equal(out.rows, 0)          // the caller hides the whole panel
  assert.equal(out.svgH, MIN_PANEL_H)
})

test('0 cotree lanes reserve 0 gutter — an absent thing is not pre-allocated', () => {
  // 原則 #31 / the Yellow Card on defaults: "no links" must not silently reserve
  // a gutter-sized strip the labels then pay for.
  const out = computeLayout(new Map(), [])
  assert.equal(out.lanes, 0)
  assert.equal(out.gutterW, 0)
  assert.equal(out.dropped, 0)
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

test('1 node pair — a two-row outline places both rows inside the canvas', () => {
  const infos = new Map()
  solidWithFrames(infos, { id: 'solidA', name: 'Base', userFrames: [{ id: 'cfA', name: 'Mount' }] })
  const { nodes, contentH, rows, scrollable } = computeLayout(infos, [link('l1', 'solidA', 'cfA')])

  assert.equal(nodes.size, 2)
  assert.equal(rows, 2)
  assert.equal(scrollable, false)
  for (const [, nd] of nodes) {
    assert.ok(nd.y >= 0 && nd.y <= contentH, 'nodes stay inside the outline')
    assert.ok(Number.isFinite(nd.x) && Number.isFinite(nd.y))
  }
})

test('1 cotree edge — exactly one lane, and the gutter is sized for one', () => {
  const { infos, links } = twoSolidScene()
  const out = computeLayout(infos, links)
  assert.equal(out.edges.size, 1)
  assert.equal(out.lanes, 1)
  assert.equal([...out.edges.values()][0].lane, 0)
  assert.equal(out.dropped, 0)
  assert.ok(out.gutterW > 0 && out.gutterW < PANEL_W / 4, 'one lane is a sliver, not a column')
})

test('N Solids — every node owns a row and no two rows coincide', () => {
  // The defect class that only exists at N: rows crowd, labels collide, x values
  // pile up at the margins. One Solid can never show it.
  const { infos, links } = nSolidScene(6)
  const { nodes, contentH, rows } = computeLayout(infos, links)

  assert.equal(nodes.size, 12)
  assert.equal(rows, 12)
  const seenRows = new Set()
  for (const [, nd] of nodes) {
    assert.ok(nd.x >= 0 && nd.x <= PANEL_W, `x=${nd.x} escaped the panel`)
    assert.ok(nd.y >= 0 && nd.y <= contentH, `y=${nd.y} escaped the outline`)
    assert.ok(!seenRows.has(nd.row), 'two nodes must not share a row')
    seenRows.add(nd.row)
  }
  assert.deepEqual([...seenRows].sort((a, b) => a - b), [...Array(12).keys()])
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

// ── 4. G1 — labels never degrade, and never divide by the sibling count ─────

test('the width a label may use does not depend on how many siblings exist', () => {
  // THE ADR-095 claim, stated precisely. Before: usable width was
  // `196 / maxRowCount`, so the sibling count was the divisor. After: width is
  // `PANEL_W − indent − gutter`, in which the sibling count does not appear.
  // The two scenes below differ ONLY in how many siblings they hold — lane
  // usage is held fixed, because the gutter legitimately does cost width.
  const few  = siblingChainScene(3)
  const many = siblingChainScene(10)
  const a = computeLayout(few.infos,  few.links)
  const b = computeLayout(many.infos, many.links)

  assert.equal(b.rows, a.rows + 7, 'the fixtures must really differ in sibling count')
  assert.equal(a.lanes, b.lanes, 'lane usage is the controlled variable here')

  const widthByDepth = (out) => {
    const m = new Map()
    for (const [, nd] of out.nodes) {
      const prev = m.get(nd.layer)
      if (prev != null) assert.equal(prev, nd.labelW, 'same depth ⇒ same label width')
      m.set(nd.layer, nd.labelW)
    }
    return m
  }
  const wa = widthByDepth(a), wb = widthByDepth(b)
  assert.deepEqual([...wa.keys()].sort(), [...wb.keys()].sort())
  for (const [depth, w] of wa) assert.equal(wb.get(depth), w, `depth ${depth}`)
})

test('a crowded scene keeps a readable label column where the old rule left 16px', () => {
  // The floor, in absolute terms. `DENSE_SLOT = 22` said: below 22px per node,
  // stop drawing labels. Twelve Solids put the old layout at 16px — that line
  // firing is exactly the complaint ADR-095 answers.
  const { infos, links } = nSolidScene(12)
  const out = computeLayout(infos, links)

  const oldSlot = (PANEL_W - 24) / 12
  assert.ok(oldSlot < 22, `the old rule degraded here (${oldSlot.toFixed(1)}px per node)`)
  for (const [, nd] of out.nodes) {
    assert.ok(nd.labelW > 8 * oldSlot, `${nd.label} got ${nd.labelW}px`)
  }
})

test('denseMode is gone — no scene of any size brings the dot strip back', () => {
  // 台帳 §既知の負債 3: a retired state that stays in the returned shape is how
  // the next author re-enables it by accident. The flag's ABSENCE is the check.
  for (const n of [2, 3, 6, 12, 24]) {
    const { infos, links } = nSolidScene(n)
    const out = computeLayout(infos, links)
    assert.equal('denseMode' in out, false, `denseMode came back at n=${n}`)
    for (const [, nd] of out.nodes) {
      assert.ok(nd.labelW > 0, `every row keeps a label column at n=${n}`)
    }
  }
})

// ── 5. G2 — depth is the indent, and the indent is bounded ──────────────────

test('x is a function of TF depth and of nothing else', () => {
  const { infos, links } = nSolidScene(8)
  const { nodes } = computeLayout(infos, links)

  const xByDepth = new Map()
  for (const [, nd] of nodes) {
    if (xByDepth.has(nd.layer)) assert.equal(xByDepth.get(nd.layer), nd.x)
    else xByDepth.set(nd.layer, nd.x)
  }
  const depths = [...xByDepth.keys()].sort((a, b) => a - b)
  for (let i = 1; i < depths.length; i++) {
    assert.ok(xByDepth.get(depths[i]) > xByDepth.get(depths[i - 1]),
      'x must be strictly increasing in depth below saturation')
  }
})

test('a child is never left of its parent', () => {
  const { infos, links } = deepChainScene(6)
  const { nodes } = computeLayout(infos, links)
  let checked = 0
  for (const [, nd] of nodes) {
    if (nd.parentId == null) continue
    assert.ok(nd.x >= nodes.get(nd.parentId).x, `${nd.label} drifted left of its parent`)
    checked++
  }
  assert.ok(checked > 0)
})

test('indentation saturates and the depth badge states the real depth', () => {
  // x is finite too. Pouring an unbounded quantity into it is exactly the
  // mistake ADR-095 removed from the sibling axis — so it stops, and the number
  // is written out rather than implied by equal x values.
  const { infos, links } = deepChainScene(MAX_INDENT_DEPTH + 2)
  const { nodes } = computeLayout(infos, links)

  const atCap  = [...nodes.values()].filter(nd => nd.layer === MAX_INDENT_DEPTH)
  const beyond = [...nodes.values()].filter(nd => nd.layer > MAX_INDENT_DEPTH)
  assert.ok(atCap.length > 0 && beyond.length > 0, 'fixture must cross the cap')

  for (const nd of atCap)  assert.equal(nd.depthSaturated, false)
  for (const nd of beyond) {
    assert.equal(nd.depthSaturated, true)
    assert.equal(nd.x, atCap[0].x, 'indent stops at the cap')
    assert.equal(nd.indentDepth, MAX_INDENT_DEPTH)
    // The badge value is the node's real depth — the whole point of the badge.
    assert.ok(nd.layer > MAX_INDENT_DEPTH)
  }
})

// ── 6. Cotree lanes — crowding is paid for HERE, not by the labels ──────────

test('lanes are assigned so that two edges sharing a lane never overlap', () => {
  const { infos, links } = interleavedScene(3)
  const { nodes, edges, lanes } = computeLayout(infos, links)

  assert.equal(lanes, 3)
  const byLane = new Map()
  for (const [, e] of edges) {
    if (e.dropped) continue
    const a = Math.min(nodes.get(e.source).row, nodes.get(e.target).row)
    const b = Math.max(nodes.get(e.source).row, nodes.get(e.target).row)
    for (const other of byLane.get(e.lane) ?? []) {
      assert.ok(b < other.a || a > other.b,
        `lane ${e.lane} holds overlapping intervals [${a},${b}] and [${other.a},${other.b}]`)
    }
    byLane.set(e.lane, [...(byLane.get(e.lane) ?? []), { a, b }])
  }
})

test('lane assignment does not depend on the order the links arrive in', () => {
  // The defect ADR-094 actually hit with edge z-order, now one layer deeper: the
  // caller's link list is ordered by scene mutation history, so deleting and
  // re-adding an unrelated link must not re-shuffle the gutter.
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
  // counted on BOTH of its endpoint rows, so "there is more here" is answerable
  // from either end.
  const k = MAX_LANES + 1
  const { infos, links } = interleavedScene(k)
  const { nodes, edges, lanes, dropped } = computeLayout(infos, links)

  assert.equal(lanes, MAX_LANES)
  assert.equal(dropped, k - MAX_LANES)

  const droppedEdges = [...edges.values()].filter(e => e.dropped)
  assert.equal(droppedEdges.length, dropped)
  for (const e of droppedEdges) assert.equal(e.lane, null)

  const badgeTotal = [...nodes.values()].reduce((s, nd) => s + nd.overflow, 0)
  assert.equal(badgeTotal, dropped * 2, 'each dropped link is counted at both ends')
  for (const e of droppedEdges) {
    assert.ok(nodes.get(e.source).overflow > 0 && nodes.get(e.target).overflow > 0)
  }
})

test('the gutter and its lanes stay inside the panel', () => {
  const { infos, links } = interleavedScene(MAX_LANES)
  const { lanes, gutterW } = computeLayout(infos, links)
  assert.ok(gutterX(gutterW) > PANEL_W / 2, 'the gutter must not eat the label column')
  for (let l = 0; l < lanes; l++) {
    const x = laneX(l, lanes)
    assert.ok(x > gutterX(gutterW) && x < PANEL_W, `lane ${l} at x=${x} escaped the gutter`)
  }
})

// ── 7. Scrolling — the row height is what must NOT degrade ──────────────────

test('the outline scrolls past the cap instead of compressing its rows', () => {
  // The cost ADR-095 accepts: "the whole graph at a glance" becomes "the depth at
  // a glance". What must not happen is rows shrinking to fake the former.
  const s2 = nSolidScene(2), s12 = nSolidScene(12)
  const small = computeLayout(s2.infos,  s2.links)
  const big   = computeLayout(s12.infos, s12.links)

  assert.equal(small.scrollable, false)
  assert.equal(big.scrollable, true)
  assert.ok(big.contentH > big.graphH, 'the outline is taller than its viewport')

  const pitch = (out) => {
    const ys = [...out.nodes.values()].sort((a, b) => a.row - b.row).map(nd => nd.y)
    return ys[1] - ys[0]
  }
  assert.equal(pitch(big), pitch(small), 'row pitch is constant regardless of scene size')
  assert.equal(pitch(big), ROW_H)
})

// ── 8. Determinism — ADR-048's core property, machine-held ──────────────────

/** Node/edge geometry in a comparable shape — lanes included since ADR-095. */
function snapshot(out) {
  return {
    nodes: [...out.nodes].map(([id, nd]) =>
      [id, nd.layer, nd.row, nd.x, nd.y, nd.labelX, nd.labelW, nd.label, nd.parentId]),
    edges: [...out.edges].map(([id, e]) =>
      [id, e.source, e.target, e.directed, e.kinematic, e.lane, e.dropped]),
    rows: out.rows, depth: out.depth, lanes: out.lanes, gutterW: out.gutterW,
    svgH: out.svgH, contentH: out.contentH,
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
