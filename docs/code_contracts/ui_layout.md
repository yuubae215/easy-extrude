# Mental Model: UI & Layout Adaptability

Detail file for `docs/CODE_CONTRACTS.md` Section 3.

---

## Mobile Toolbar Stability

- **Principle**: Mobile UI elements must maintain consistent layout dimensions and button placements to prevent misclicks caused by layout shifts during state changes.
- **Concrete Rule**: Each mode shows a fixed number of slots. Object mode uses **5 slots** (widest); Edit 3D uses **4 slots**. Within a mode, use `disabled: true` for temporarily unavailable actions. Pad with `{ spacer: true }` invisible placeholders so the slot count stays constant and the toolbar width never changes.

| Mode | Slot 1 | Slot 2 | Slot 3 | Slot 4 | Slot 5 |
|------|--------|--------|--------|--------|--------|
| Object (generic / no selection) | Add | Grab | Edit | Delete | Stack |
| Object (Solid selected) | Add | **Grab** | Edit | Delete | Rotate |
| Object (CoordinateFrame selected) | Add Frame | **Move** | *(spacer)* | Delete | Rotate |
| Edit 2D sketch | <- Object | *(spacer)* | *(spacer)* | Extrude | — |
| Edit 2D extrude | Cancel | *(spacer)* | *(spacer)* | Confirm | — |
| Edit 3D | <- Object | Vertex | Edge | Face | — |
| Grab active | Cancel | Stack | *(spacer)* | Confirm | — |
| Rotate active | Cancel | *(spacer)* | *(spacer)* | Confirm | — |

**Semantic slot rule (transient operation bars)**: Slot 1 is always Cancel/Back (retreat). Slot 4 is always Confirm (advance). Slots 2–3 are contextual tools. This fixed semantic mapping enables muscle memory — users always tap the same corner to abandon or commit an operation, regardless of what operation is active.

### Why sequential (pack-left) mapping is forbidden

3D modelling operations demand high visual attention on the canvas preview. When a user's eyes are tracking a grab position or rotation angle, they cannot afford to scan the toolbar to locate Cancel or Confirm. If those buttons shift position because a different operation has one fewer contextual tool, every operation becomes a visual search task.

The forbidden anti-pattern is **sequential mapping**: filling slots left-to-right with only the available buttons, so the slot count drops when fewer actions are relevant. This makes Cancel appear at index 0 in Measure mode but at index 2 in Rotate mode — breaking muscle memory silently.

The correct pattern is **semantic mapping**: slot semantics are fixed for the entire category of transient operation bars, regardless of how many contextual tools the current operation needs. Missing actions become spacers, never position shifts.

### Transient operation bar — 4-slot layout contract

All states that interrupt Object mode (Grab, Rotate, Edit-extrude, Edit-sketch, Measure, Frame-placement, Map) use a **4-slot bar**. The semantic assignment is:

| Index | Role | Visual treatment |
|-------|------|-----------------|
| **0** (leftmost) | **Cancel / Back** — always retreat | `danger: true` |
| **1** | Contextual tool A | `active` reflects toggle state |
| **2** | Contextual tool B | `active` reflects toggle state |
| **3** (rightmost) | **Confirm / Advance** — always commit | default style |

When no contextual tool is needed, use `{ spacer: true }` at slots 1 and/or 2. Never omit the slot — omission causes index shift.

```js
// ❌ forbidden — Cancel moves from index 0 to index 1 when a contextual tool is absent
this._uiView.setMobileToolbar([
  { icon: ICONS.confirm, label: 'Confirm', onClick: () => this._confirm() },
  { icon: ICONS.cancel,  label: 'Cancel',  onClick: () => this._cancel(), danger: true },
])

// ✓ correct — semantic positions are fixed; absent tools become spacers
this._uiView.setMobileToolbar([
  { icon: ICONS.cancel,  label: 'Cancel',  onClick: () => this._cancel(), danger: true }, // [0] always
  { spacer: true },                                                                         // [1] unused
  { spacer: true },                                                                         // [2] unused
  { icon: ICONS.confirm, label: 'Confirm', onClick: () => this._confirm() },               // [3] always
])
```

Object mode is a **5-slot home state** with different semantics (Add / Grab / Edit / Delete / Rotate-or-Stack) — it does not follow the 4-slot transient rule. ADR-042 defines the target unified 4-slot design (`[ Deselect | Grab | Rotate | Add [Context] ]`) to be adopted in a future implementation pass.

`{ spacer: true }` renders as a `visibility: hidden` div of identical dimensions. It occupies layout space without being tappable.

Grab and Edit are disabled for `ImportedMesh`. Edit and Stack are also disabled for `CoordinateFrame` (CF has its own toolbar). Delete remains enabled for all object types. Dup was removed from the toolbar to make room for Grab; it remains available via the long-press context menu. All Object-mode slots maintain consistent disabled states so slot positions never shift.

**Origin CF disabled actions**: Move, Delete, and Rotate are disabled for the Origin CF (`name === 'Origin'`) since it is rigidly fixed to its parent Solid's centroid. Only Add Frame remains enabled. ADR-042 §2 defines the planned locked-state visual treatment (🔒 icon + toast) to replace the current silent `disabled` state.

**CoordinateFrame exception**: when a CoordinateFrame is selected the entire toolbar switches to a specialised 5-slot layout `[Add Frame | Move | spacer | Delete | Rotate]`. Slot 2 (Move/Grab) and slot 5 (Rotate) intentionally mirror the Solid toolbar positions so that the muscle memory for "tap slot 2 to move, tap slot 5 to rotate" carries across both entity types. Add Frame (slot 1) is **always enabled** — even for the auto-managed Origin CF, adding a child CF is valid per ADR-037.

**Axis sub-bar during Grab / Rotate** (planned, ADR-042): a floating axis selector bar will appear above the main toolbar during Grab/Rotate: `[ X | Y | Z ]` for Rotate, `[ X | Y | Z | XY-plane ]` for Grab. The last-used axis is remembered. This supersedes the 5-slot Grab bar expansion planned in ADR-024 §Future; the transient bar will remain 4 slots.

The Object-mode Stack button pre-sets `_grab.stackMode` before a grab gesture. `_startGrab()` does not reset `stackMode`, so the pre-set is respected. `_confirmGrab()` and `_cancelGrab()` reset it to `false` when the grab ends.

Face extrude on mobile is a gesture-only operation (tap face -> drag -> release = confirm). No Extrude button is shown in Edit 3D.

**Consolidated update (2026-07-02, migrated from the CODE_CONTRACTS.md index row — where this overlaps the text above, this is newer):**

Fixed slot counts per mode; use `disabled` + `{spacer: true}` to prevent layout shifts. Object mode (5 slots): `[Add | Grab | Edit | Delete | Rotate-or-Stack]`. Solid selected: slot 5 = Rotate. CF selected: `[Add Frame | Move | spacer | Delete | Rotate]` — slots 2 (Move) and 5 (Rotate) intentionally mirror Solid positions for cross-entity muscle memory; Add Frame is always enabled even for Origin CF. Dup removed from toolbar; remains in long-press context menu. Semantic slot rule for transient operation bars: slot 1 = Cancel/Back, slot 4 = Confirm — fixed regardless of which operation is active.

## Mobile Touch Gesture Model (2026-03-28, updated Phase 2)

- **Principle**: On mobile, the primary navigation gesture (one-finger drag) must always orbit the camera. Intercepting it for object dragging makes navigation unreliable and forces two-step flows to do basic panning.
- **Concrete Rule**: Touch (`e.pointerType === 'touch'`) in Object mode:
  - **Quick tap on object** -> selection (unchanged).
  - **One-finger drag anywhere** -> orbit via OrbitControls (no `_objDragging`, no rect selection).
  - **Long press >= 400 ms, < 8 px movement on a *selected* object** -> `_showLongPressContextMenu()` with options Grab / Duplicate / Delete / Rename. Timer stored in `_longPress.{ timer, pointerId, startX, startY }`. Cancelled in `_onPointerMove` (threshold exceeded) or `_onPointerUp` (quick release).
  - **Touch on empty space** -> orbit (no rect selection started).
  - Rect selection and `_objDragging` are mouse-only paths.
- **OrbitControls config**: `touches.ONE` must be `THREE.TOUCH.ROTATE` (not `null`). AppController returns early for touch so OrbitControls gets all single-finger events.

```js
// _longPress timer pattern (Object mode, touch hit):
if (e.pointerType === 'touch') {
  if (this._objSelected && this._selectedIds.has(obj.id)) {
    this._longPress.timer = setTimeout(() => {
      this._showLongPressContextMenu(startX, startY, obj)
    }, 400)
  }
  return  // no drag setup
}
```

## Long-Press Context Menu

- **Principle**: A single long-press action (previously direct Grab) is too opaque for first-time users. Presenting a small action popup provides discovery and reduces misfire risk.
- **Concrete Rule**: `_showLongPressContextMenu(x, y, obj)` calls `UIView.showContextMenu(x, y, items)`. Items shown depend on entity type:
  - **Grab** — always shown (all non-MeasureLine/non-CoordinateFrame objects can be grabbed).
  - **Duplicate** — hidden for `ImportedMesh` and `Profile` (read-only or un-extruded).
  - **Rename** — always shown (calls `_promptRename(id)` -> `UIView.showRenameDialog()`).
  - **Delete** — always shown (danger style).
- `UIView.showContextMenu` is dismissed on any outside `pointerdown` via a one-shot handler. `UIView.hideContextMenu()` is safe to call multiple times.
- `UIView.showRenameDialog(currentName, callback)` renders an inline modal (not `window.prompt`) with an auto-focused input, OK/Cancel buttons, and Enter/Escape keyboard support.

## Measure Point Placement (Mobile: Hold-to-Snap, Release-to-Confirm)

- **Principle**: On touch devices, placement of a single point requires the user to see snap feedback before committing. A tap-and-release offers no time to adjust; hold-and-release does.
- **Concrete Rule**: Measure point confirmation happens in `_onPointerUp`, not `_onPointerDown`. On `pointerdown`, set `_measure.pressing = true` and `_activeDragPointerId`. On `pointerup`, if `_measure.pressing && _activeDragPointerId === e.pointerId`, call `_confirmMeasurePoint()`. During the hold, `_onPointerMove` continues updating snap candidates so the user sees live snap feedback. `_cancelMeasure()` also resets `pressing = false`.

## Stack Mode (Grab)

- **Principle**: When stacking objects, the Z position should be determined by what is physically below the grabbed object, not by cursor height.
- **Concrete Rule**: Stack mode is toggled with **S** during grab (or the Stack toolbar button on mobile). When active, `_applyStackSnap()` runs after the normal movement each frame — both during `_grab.active` (G-key path) **and** during `_objDragging` (touch-drag path). It casts downward rays (`(0,0,-1)`) from **Z=10000** (not from the object's current bottom) from the 4 bottom-face corners + centroid, and finds the highest surface among non-grabbed objects. `zOffset = highestHitZ - gZMin`; if `|zOffset| >= 0.001`, all selected objects' vertex Z is shifted by `zOffset` so the bottom face rests exactly on that surface. The `_grab.stacking` flag tracks whether a snap surface was found this frame.
- **Why ray origin must be HIGH_Z**: casting from `gZMin + epsilon` misses surfaces whose top face is *above* the grabbed object's current bottom (e.g. target is taller than where we're dragging from). Starting from Z=10000 ensures the ray finds the topmost surface at (x,y) regardless of current object height.
- **Why _objDragging path**: on desktop, mouse-dragging an object uses `_objDragging`, not `_grab.active`. Stack snap must be called in both paths. Note: touch no longer uses `_objDragging` (2026-03-28 — single-finger touch orbits; Grab via long-press uses `_grab.active`). The `_objDragging` path therefore only fires on desktop mouse drag.

## Viewport-Aware Z-Index and Positioning

- **Principle**: Floating UI elements must dynamically adjust their spatial positioning to avoid colliding with or being hidden behind device-specific layouts (like mobile toolbars).
- **Concrete Rule**: The mobile floating toolbar's top edge is at **86px** from the bottom (`bottom: 26px` + `height: 60px`). `showToast()` must check `_isMobile()` and set `bottom: 96px` (instead of the desktop `64px`) so it appears above the toolbar. If the toolbar height or position changes, update both the toolbar CSS and this constant together.

```js
const bottomPx = this._isMobile() ? '96px' : '64px'
```

On mobile, status text is shown in the footer info bar (`_infoEl`) instead of the header, because the mobile header is too narrow and keyboard hints are irrelevant on touch. `setStatus()` and `setStatusRich()` update `_infoEl` on mobile; `_setInfoText()` is a no-op on mobile. The Nodes button (`_nodeEditorBtn`) is desktop-only and hidden on mobile.

**Mobile canvas status pill removed (2026-06-18)**: the React `CanvasStatusPill` (a rounded pill floating over the 3-D canvas at `bottom:96px`) was deleted. It frequently rendered an *empty rounded-rectangle background* because `setStatus('')` produced `[{ text: '' }]` (a non-empty array → the pill rendered with no text). Mobile status now lives only in the footer info bar; the desktop `HeaderStatus` (no background box) is unchanged. `setStatus('')` now yields `[]` so an empty status renders nothing on either surface. Do not reintroduce a canvas-overlay status pill — the empty-background artifact is the reason it was removed.

**Mobile header right-alignment**: `_headerStatusEl` uses `visibility: hidden` (not `display: none`) on mobile so it still acts as a `flex: 1` spacer, pushing the right-side buttons (⋯ and N) to the far right without needing `marginLeft: auto` on any individual button.

**Export/Import on mobile**: `_exportJsonBtn` and `_importJsonBtn` are hidden on mobile. They are replaced by `_moreMenuBtn` (⋯), a single overflow button that opens a dropdown containing Export and Import. This keeps the header width within the mobile viewport. The ⋯ button is inserted into the flex header before `_nToggleBtn`, giving the order: `⋯ | N` at the right edge.

**Map button text on mobile**: The Map button shows icon + "Map" label on desktop. On mobile the label is hidden (`display:none` on the `<span>`) and the padding is tightened to `4px`. Without this, the minimum content width of all header items exceeds 375px (a common phone width) by ~9px, causing the N-panel icon to be clipped by the viewport edge. `_applyMobileLayout` toggles both the span visibility and the padding. The header also has `overflow: hidden` so any future content addition cannot push icons off-screen.

**Mode dropdown must be appended to body**: `_modeDropdownEl` uses `position: fixed` and is appended to `document.body`, NOT to the `_modeSelectorEl` inside the header. The header has `overflow: hidden`, which clips absolutely-positioned children that extend below the header boundary. The dropdown's `top`/`left` are set dynamically via `getBoundingClientRect()` on the button each time it opens. The outside-click handler must check both `_modeSelectorEl` and `_modeDropdownEl` since they are now separate DOM subtrees.

## Pointer-Anchored Popovers Clamp Themselves Into the Viewport

- **Principle**: a popover that opens AT the pointer (`AddMenu`, `ContextMenu`, `LinkTypePicker`) decides its own reachability: its height and the pointer's position together determine whether the last item can be clicked. Anchoring blindly to `(x, y)` puts items off-screen for pointers near an edge — they are in the DOM, they pass `toBeVisible()`, and they cannot be clicked. "It exists" is not "it is reachable" (PHILOSOPHY #16 / #11).
- **Concrete rule**: clamp horizontally (`Math.max(gap, Math.min(x, W − width))`), and vertically either clamp (`LinkTypePicker`) or anchor to the opposite edge when the pointer is past the midpoint and cap the height with `overflowY: auto` (`AddMenu`, whose length is data-driven). Flip the CSS transform origin with the anchor so the grow-from-the-click-point motion still points at the click.
- **Bug history (2026-08-02, ADR-106 D3)**: `AddMenu` gained the Assets group (5 catalog entries moved out of the floor) and, with the pointer in the lower half of the viewport, the new group fell off the bottom. `ContextMenu` and `LinkTypePicker` had clamped for years — **two of three popovers already implemented the rule and nowhere was it written down**, so the one that did not was invisible to anyone reading the ones that did (PHILOSOPHY #31's shape). Caught by the smoke E2E (`element is outside of the viewport`), which is where this is asked: the interaction of z-index, layout and pointer position is not statically visible.
- **Corollary**: relocating a feature asks about the CAPACITY of its new address, not only its meaning. ADR-106 chose `+ Add` as the Assets group's home on responsibility grounds and that choice stands — the container simply had to grow a rule it never had.

---

## Edge-Anchored Panels Must Coordinate Occupancy

- **Principle**: A `position: fixed` element anchored to a screen edge implicitly claims that edge. Any other element anchored to the same edge must either own a higher z-index *and* be transient (drawer, dropdown), or offset itself past the occupant. Layering two persistent opaque panels on the same edge silently hides the lower one (PHILOSOPHY #26).
- **Concrete Rules** (desktop):
  - **Left edge**: the Outliner (180px, z:90, opaque, always visible) owns `left:0`. `LinkNetworkView` (`setMobile(false)`) and the Map Mode toolbar (`MapToolbar.jsx`) sit beside it at `left:188px`; on mobile the Outliner is a drawer, so `left:8px` is free.
  - **Left-edge column is also shared vertically**: the Link Network panel grows *upward* from `bottom:34px` while the Map toolbar (`top:50%`, ~259px tall → lower edge ≈490px on a 720px viewport) hangs into the same `left:188px` column. The panel's SVG height is therefore capped at `MAX_PANEL_H = 160` (ADR-048 §2.3); the 192px candidate overlapped the toolbar by 23.5px. The legend strip (`LEGEND_H = 14`, ADR-094) lives INSIDE that height — the graph area is `svgH − LEGEND_H`, so adding the legend cost rows, not clearance. Since the ADR-094 fusion dropped the common scene from 3 rows to 2, the panel now usually sits at `MIN_PANEL_H = 152` and reaches the cap only on real CF-under-CF depth. Raising the cap requires re-measuring both elements together (Playwright, 1280×720, Map mode + links present).
  - **Bottom edge (ADR-106 D6)**: the InfoBar (26px, z:100) owns `bottom:0` and **never moves** — the floor opens *above* it (PHILOSOPHY #15: the key hints must not change position when the floor opens). Everything else at that edge derives its `bottom` from **one owner**, `bottomEdgeOffset({ isMobile, tier, floorOpen })` in `src/view/EdgeOccupancy.js`. Never write a `bottom` literal on a bottom-anchored fixed element. The bottom edge differs from the right edge in that occupants **stack** (InfoBar → mobile toolbar → floor → floating), so the occupancy is a function of a **tier**, and the tier table `BOTTOM_TIER` **throws on an undeclared tier** (PHILOSOPHY #31 — a fall-through would silently place an unconsidered occupant on the InfoBar and hide it the day the floor opens). Declared tiers: `above-infobar` (mobile toolbar) / `floor` (the floor container itself) / `dock` (Outliner, N panel, document intake) / `floating` (LinkNetworkView, StoryBar, TourCard) / `toast`.
  - **Right edge (ADR-106 D2)**: the **only** permanent occupant is the N panel (200px). The 280px slot the tutorial Inspector and the production floor both wanted is retired — both moved to the bottom. The world gizmo offset is owned **solely** by `AppController._updateGizmoOffset()` and is now `16 + 200·nPanel` (**two terms**); never call `GizmoView.setRightOffset()` from individual toggle handlers. `src/FloorContainerCensus.test.js` counts the right-edge occupants and the terms of that sum from the syntax, so a second occupant fails the build rather than being discovered visually.
  - **A container never resolves an edge collision by shifting, deleting, or covering another occupant.** Those three were the workarounds ADR-106 removed — written independently, unaware of each other, so fixing any one of them produced a *green* build with the other two alive. If a new panel cannot state its tier, add a tier to the owner; do not patch at the call site.
  - **Full-screen overlays**: the Context demo hides the Link Network panel because it would spoil the staged step-⑤ link reveal — that is **choreography**, and it is the only surviving reason. (The "and the StoryBar sweeps across it" half of the old justification was an address collision, and ADR-106 D6 removed it: the StoryBar and the panel both read the bottom-edge owner now.) `ContextDemoController` calls `LinkNetworkView.setForceHidden(true)` on `_start()` and `false` on `exit()`; `_applyVisibility()` is the sole writer of **both** display styles — the panel's (`forceHidden` × `hasContent`) and the SVG canvas's (`collapsed`) — so the two orthogonal axes cannot drift apart (PHILOSOPHY #4; `_toggleCollapse()` owns the axis, never the pixel).
- **Bug history (2026-06-12)**: the Link Network panel rendered fully behind the Outliner (z:50 < 90, same `left:8px`); the Map Mode toolbar floated on top of the Outliner rows (`left:8px`, z:150); the N panel and world gizmo rendered behind the Context DSL demo inspector. All were silent overlaps — no error, the element simply "disappeared" or blocked another.
- **Bug history (2026-08-02, ADR-106)**: opening the production floor hid the world gizmo and the projection toggle. The gizmo occupies `right:[16,112]`, which is strictly inside the floor's `[0,280]`, and the floor carried `z:100` — so this was not a bug anyone wrote, it was the *third* workaround for the right edge being over-subscribed. Two more findings came out of the census that closed it: the toast stack carried `bottom:96px` as a literal **identical on mobile**, where the toolbar alone eats 86px; and `TourCard` cited PHILOSOPHY #26 in a comment while writing `left:192` and `bottom:38` as literals. A comment is not a computation — the two drift, and only the comment claims otherwise.

---

## Three.js Canvas Must Mount in #canvas-container

> Migrated verbatim from the CODE_CONTRACTS.md index row (2026-07-02); the index now carries a summary.

`SceneView` appends `renderer.domElement` to `document.getElementById('canvas-container')` (fallback: `document.body`). Never append directly to `document.body` — the implicit stacking order is fragile when a React overlay exists. Explicit z-index contract: `#canvas-container` (z-index:0) → GizmoView canvas (z-index:10, `position:fixed`) → `#react-ui-root` (z-index:100). Adding React UI layers without this container caused a black-screen regression after Phase 5.

---

## CF Label getBoundingClientRect Cache

> Migrated verbatim from the CODE_CONTRACTS.md index row (2026-07-02); the index now carries a summary.

`CoordinateFrameView.updateLabelPosition()` caches the result of `canvas.getBoundingClientRect()` (keyed on `clientWidth`/`clientHeight`) and reuses it across frames. Calling `getBoundingClientRect()` every frame on mobile returns slightly varying values during viewport-resize animations (address-bar show/hide), which pushes the rounded pixel position across a 0.5-pixel boundary on alternate frames and causes visible jitter. The cache is invalidated whenever canvas dimensions change (i.e., on window resize). Additionally, the transform is only written to the DOM when the rounded position changes, preventing GPU recomposition on static scenes.

---

## Mobile Header Overflow

> Migrated verbatim from the CODE_CONTRACTS.md index row (2026-07-02); the index now carries a summary.

Export/Import hidden on mobile; replaced by `_moreMenuBtn` (⋯) dropdown. `_headerStatusEl` uses `visibility:hidden` (not `display:none`) to remain a flex:1 spacer. Map button hides its `<span>` text label on mobile (padding tightened to `4px`) — without this the N-panel icon is clipped on 375px viewports. Header has `overflow:hidden`. Mode dropdown (`_modeDropdownEl`) is appended to `document.body` with `position:fixed` and positioned via `getBoundingClientRect()` — if placed inside the header it gets clipped by `overflow:hidden`


## Outside-Click Dismissal: One Predicate, and `pointerdown` (ADR-113 D1)

A popup that escapes `overflow:hidden` by rendering `position:fixed` is **not a
DOM descendant of its trigger**, so "did this click land inside me?" must be
asked of the trigger *and* the surface. Ask only the trigger and every in-panel
click reads as an outside click — invisible wherever selecting a row happens to
close the menu anyway, and fatal wherever a row only changes state.

- The predicate has ONE owner: `isInsideDropdown(target, { trigger, surface })`
  in `src/view/DropdownContainment.js`. It **throws** if you pass only one of
  the two fields, so the defective call shape cannot be written. Re-deriving it
  (`ref.current.contains(e.target)`) is caught by `IDENTITY_RULES` in
  `src/IdentityContainment.test.js` — that rule declares `scope: 'all'`, which
  is what makes the guard scan `.jsx` (the default `js` scope would silently
  never fire for a presentation-layer rule).
- **Listen on `pointerdown`, not `click`.** React flushes the state change a
  row's own `onClick` made *before* a `document` click listener runs, so the
  clicked row can already be detached from the document — and a detached node is
  inside nothing, so even a correct predicate reads "outside". `pointerdown`
  asks while the target is still in the tree.
- A menu with levels keeps the level **inside** its one state
  (`src/view/OverflowMenuState.js`), never as a second field beside a boolean:
  `{closed, verb:'export'}` must not be representable, and the level must be
  decided when *opening* rather than reset when closing (closing paths multiply;
  opening paths do not).

## Full-Screen Overlays Do Not Choose Their Own z-index (ADR-113 D3)

Any overlay that takes the whole screen (`position:'fixed'` + `inset:0`) is a
declared **screen claim** in `src/view/ScreenClaim.js`, with a tier
(`stage` / `coach` / `dialog`) and no z-index of its own — `tierZIndex(tier)` is
the single owner of the order, the same discipline PHILOSOPHY #26 applies to
screen edges. Two overlays that each pick the same literal have their winner
decided by mount order, a fact written in neither file.

- The `stage` tier is **one slot** (`uiStore.stage`), so two starting points
  cannot be up at once. Write it only through `claimStage` / `releaseStage`;
  release **names its claim**, so a late close cannot clear a claim someone else
  has taken since.
- `src/ScreenClaimCensus.test.js` derives its population by scanning
  `src/components/**` and counts BOTH undeclared overlays and overlays that pick
  their own z. Counting only the first is not enough: the original defect was in
  the *order*, and every overlay already had a flag.

---

## Disabled-as-Quest: Locked Chrome Controls Explain Their Gate (ADR-065 Phase 3)

Every disable-able chrome control (mobile toolbar slots, header undo/redo)
derives its `disabled` flag AND the rendered reason from ONE gate-predicate
return value in `src/view/ChromeGates.js` (`{enabled, reason}`). The shape
makes the ADR-058 "same function reference" rule structural: a locked gate
always carries a non-empty reason and an open gate always carries
`reason: null` (machine-tested in `ChromeGates.test.js`), so a disable can
never drift apart from its explanation and a *silent* disabled is
unrepresentable (PHILOSOPHY #11/#25).

- Presentation: the locked state is stylized (`ChromeMath.lockedStyle()` —
  dashed border, legible label, `cursor:help`), replacing the former mute
  `opacity:0.35`-only treatment. Tapping a locked control calls
  `onLockedTap(reason)` → info toast (`uiStore.actions.pushToast`); desktop
  additionally sets `title={reason}`. Do NOT set the native `disabled`
  attribute — it swallows the tap and the quest reason with it; use
  `aria-disabled` instead.
- The gates restate the entity-capability contracts (§1 "Entity Capability
  Contracts", PHILOSOPHY #2 instanceof); when a capability changes, update the
  gate and the contract row in the same commit.
- Tier A chrome motion (press spring, hover lift, active-tool breathing glow,
  toast/menu/hint entry) derives via the pure `ChromeMath` (PHILOSOPHY #30):
  fragments carry ONLY transform/transition/animation — colours stay
  component-owned so affordance motion cannot fake a Tier F judgment. Under
  reduced motion every fragment degrades to the static colour/glow cue
  (single boundary `src/theme/motion.js` via `useReducedMotion`). Keyframes
  live in `ChromeMath.CHROME_CSS`, mounted once by `ChromeDefs` in `UIShell`;
  the breathing-glow keyframes are generated from `MotionMath.breathe` so the
  CSS and the curve cannot drift (§1.1).

---

## An Entrance Is a Verb; Its Objects Are Arguments (ADR-108)

**表示条件が同じであることは、同じ場所に居る理由ではない。** ヘッダの常設入口が
担うのは**動詞**であり、対象 (シーン / サーバ / Context 文書、レイアウトテンプレ /
Context テンプレ / 物語 / クエスト / 誘導フォーム) は入口ではなく**引数**である。

### なぜ (実際に起きたこと)

`{持ち出す, 持ち込む} × {シーン, サーバ, Context}` の直積が 6 つの平坦なボタンになり、
`{始める} × 5 種` が 5 つの入口になっていた。対象ごとに入口を生やすと**対象が増える
たびにヘッダが伸び、伸びは有界でない** (ADR-060 が契約について禁じた「`optional`
兄弟を生やさない」の UI 版)。

さらに `Nodes` (Geometry DAG の編集器) が `Save` / `Load` の隣に居たのは、3 つとも
「BFF 接続時のみ表示」で**表示条件が一致していた**からで、動詞を共有していたからでは
なかった。同じ誤分類は `Assets` でも起きている (実装された**時期**が住所を決めた)。

### 規則

1. **入口を足すのは動詞を足すこと。** 対象を足したいだけなら宣言表
   (`FILE_TARGETS_BY_VERB` / `START_ENTRY_BY_KIND`) に行を足す — 入口の個数は動かない。
2. **分類の権威は `src/view/HeaderEntrances.js` ただ 1 つ。** ヘッダの component が
   `callbacks.onExportJson?.()` のような配線を直に持つと、その 1 行が第二の源になり、
   次の対象は「そこにもう 1 行足す」形で入る (= 平坦な 6 個が戻る経路)。
3. **可用性は住所ではない。** 前提が満たされない入口・引数は**消さず**、
   `availabilityOf()` が返す理由つきで disabled にする (原則 #15 / #11)。
   消える入口は「入口の個数」を接続状態の関数にし、上界が二値になる。
4. **未宣言の種・動詞・前提・作業面で throw する。** fall-through は「宣言された既定」と
   「誰も考えなかった種」を区別不能にする (原則 #31)。
5. **多入口が正当な動詞は宣言する** (`MULTI_ENTRANCE_VERBS`)。今日は `toggle-surface`
   だけ — トグルは対象を選ばず、**その面の状態の表示そのもの**なので、メニューへ畳むと
   1 タップの可逆操作が 2 手になり開閉が画面から消える (原則 #15 / #4)。

### 機械側の問い所

`src/HeaderEntranceCensus.test.js` — 母集団は `Header.jsx` の 2 つのレイアウト関数直下の
JSX 要素を**構文で**導出する (手書きの入口リストを持たない — ADR-102)。常設入口の個数は
desktop 7 / mobile 7 の ratchet で、**超えても下回っても** fail する。
`src/InventoryCoverage.test.js` — `01-inventory.md` の 48 行のうち住所を持たない行が 0 個。
