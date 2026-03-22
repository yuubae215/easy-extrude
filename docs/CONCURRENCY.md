# Concurrency & State Synchronization Strategy

This document defines the architectural policy for state management, async
operations, and data-race prevention in `easy-extrude`.

The concurrency model applies the philosophy of **RTOS interrupt handling
(ISR vs. background task separation)** to the browser's single-threaded event
loop.

---

## 1. Core Mental Model: The Render Loop Is an ISR

Browser UI input events (Pointer Events) and the Three.js render loop
(`requestAnimationFrame`) are treated as **hard-real-time tasks (ISRs) with a
strict 16.6 ms deadline**.

- **Absolute rule**: never block the main thread (ISR).
- Based on the required degree of real-time responsiveness, use either
  **optimistic** or **pessimistic** locking — never conflate them.

---

## 2. Strategy A — Optimistic Locking (real-time, non-blocking)

For operations where UI responsiveness is paramount, eliminate all
mutex-style waiting and prioritise uninterrupted execution.

**When to apply:**
- Object drag in 3D space (Grab)
- Camera orbit (OrbitControls)
- High-frequency sub-element selection state (`editSelection`) updates

**RTOS analogy:**
Like a sensor ring-buffer read/write — lock-free, always prefer the latest
value, discard stale conflicting writes.

**Implementation rules:**
- **Local First**: reflect user input immediately in the View and local Model.
  Do not wait for async completion or external sync.
- **Last Write Wins / Versioning**: commit to the `SceneModel` aggregate root
  on gesture end (pointer up). If a conflict arises during async processing,
  prefer the latest timestamp/version; silently discard or merge older updates.
- **Prohibited**: never place heavy synchronous work, serial `await` chains,
  or UI-blocking locks inside high-frequency event callbacks.

---

## 3. Strategy B — Pessimistic Locking (consistency-critical, blocking)

For complex transactions where data inconsistency would cause catastrophic
failure (e.g. geometry corruption), sacrifice real-time responsiveness in
favour of full exclusive access.

**When to apply:**
- Complex mesh generation, boolean operations, or other compute-heavy work
- Full-scene export or save/load to external storage
- Atomic bulk updates spanning multiple domain entities

**RTOS analogy:**
A low-priority but critical configuration task in the main loop — use a
semaphore/mutex to lock the resource and prevent any other task from
intervening.

**Implementation rules:**
- **Explicit flag**: before starting the operation, set an explicit lock flag
  on the owning Service (e.g. `this._isProcessing = true`).
- **Disable UI**: while locked, disable pointer events on the affected object
  and show a loading indicator to signal that user intervention is refused.
- **Guaranteed release**: always use `try...finally` so the lock is released
  (`isProcessing = false`) even if an exception is thrown (deadlock prevention).

```js
// Canonical pessimistic lock pattern
async function heavyOperation(entity) {
  this._isProcessing = true
  try {
    await doHeavyWork(entity)
  } finally {
    this._isProcessing = false
    this.emit('processingDone')
  }
}
```

---

## 4. Layer Mapping and Rules for Claude Code

This strategy maps onto the MVC/DDD architecture as follows. Follow these
rules when implementing or modifying any async operation.

| Layer | Role |
|-------|------|
| **Domain** | No locking concepts. Pure entity state only. |
| **Service / Model** | Lock-control owner. Manages optimistic conflict resolution (version compare) and pessimistic flag (`isProcessing`). |
| **Controller** | Catches exceptions from the Service layer (e.g. lock-acquire failures) and translates them into View behaviour. |
| **View** | Observes lock state (`isProcessing`) and focuses on input blocking and feedback (spinner, disabled state). |

**Pre-implementation checklist (check before writing any async operation):**

1. Can this operation complete within 16 ms?
   - Yes → optimistic lock; no blocking.
   - No → offload to background; protect input with pessimistic lock.
2. If it fails, is scene consistency preserved?
   - Yes → `try/catch`, recover, notify user with a toast.
   - No → `try/finally` mandatory; implement transactionally to prevent partial updates.
3. Does it compete with pointer events?
   - Yes → add an `isProcessing` guard in `_onPointerDown` (early return in Controller).
