import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixedJointFollowers, drivesSourcePose } from './fixedJointFollowers.js'

// bin ← floor frame;  work_i ← origin_i;  origin_i fastened → floor
const objects = [
  { id: 'bin', isFrame: false },
  { id: 'bin_o', parentId: 'bin', isFrame: true },
  { id: 'floor', parentId: 'bin_o', isFrame: true },
  ...[1, 2].flatMap(i => [
    { id: `w${i}`, isFrame: false },
    { id: `w${i}_o`, parentId: `w${i}`, isFrame: true },
  ]),
  { id: 'table', isFrame: false },
]
const fastened = i => ({ sourceId: `w${i}_o`, targetId: 'floor', jointType: 'fixed', semanticType: 'fastened' })

test('動かした物に留まった物は、N 個とも運ばれる (N=2 — 1 個では区別できない)', () => {
  assert.deepEqual([...fixedJointFollowers(objects, [fastened(1), fastened(2)], ['bin'])].sort(), ['w1', 'w2'])
})

test('運ぶのは target 側から source 側だけ — ワークを動かしてもビンは運ばれない', () => {
  assert.deepEqual([...fixedJointFollowers(objects, [fastened(1)], ['w1'])], [])
})

test('推移的に運ぶ (台座 → ロボット → 手先の物)', () => {
  const objs = [...objects, { id: 'tool', isFrame: false }, { id: 'tool_o', parentId: 'tool', isFrame: true }]
  const links = [fastened(1), { sourceId: 'tool_o', targetId: 'w1_o', jointType: 'fixed', semanticType: 'fastened' }]
  assert.deepEqual([...fixedJointFollowers(objs, links, ['bin'])].sort(), ['tool', 'w1'])
})

test('mounts と非 fixed は運ばない (同じ述語 drivesSourcePose)', () => {
  const links = [
    { ...fastened(1), semanticType: 'mounts' },
    { ...fastened(2), jointType: null },
  ]
  assert.equal(drivesSourcePose(links[0]), false)
  assert.equal(drivesSourcePose(links[1]), false)
  assert.equal(fixedJointFollowers(objects, links, ['bin']).size, 0)
})

test('両方とも選択されていれば、運ばれた物として数えない (既に動いている)', () => {
  assert.equal(fixedJointFollowers(objects, [fastened(1)], ['bin', 'w1']).size, 0)
})
