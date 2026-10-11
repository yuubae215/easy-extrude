/**
 * The arm's reach envelope is declared per robot (ADR-164 D1): with N arms, the
 * envelope declared on robot A's panel is not robot B's, and a robot nobody
 * declared for reads as UNDECLARED — never a seeded default (ADR-120).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { useUIStore, UNDECLARED_REACH } from './uiStore.js'

test('starts with no declaration for any robot (0 rows is the honest start)', () => {
  assert.deepEqual(useUIStore.getState().context.reachDeclarations, {})
  assert.equal(UNDECLARED_REACH.enabled, false)
})

test('a patch for robot A leaves robot B undeclared (N arms never share one envelope)', () => {
  const { contextSetReachDeclaration } = useUIStore.getState().actions
  contextSetReachDeclaration('robot_a', { enabled: true, reachMax: '0.85' })
  const rows = useUIStore.getState().context.reachDeclarations
  assert.deepEqual(rows.robot_a, { ...UNDECLARED_REACH, enabled: true, reachMax: '0.85' })
  assert.equal(rows.robot_b, undefined)
  contextSetReachDeclaration('robot_a', { touched: true })
  assert.equal(useUIStore.getState().context.reachDeclarations.robot_a.reachMax, '0.85')
})
