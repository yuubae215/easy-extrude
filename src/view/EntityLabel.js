// @ts-nocheck — Three.js / DOM access patterns; not yet fully annotated.
/**
 * EntityLabel — shared floating HTML label for 3D entities (ADR-070 決定1).
 *
 * Extracted from CoordinateFrameView's label mechanism (div creation, NDC
 * projection, per-frame update, jitter-suppression caches) so that MeshView
 * and ImportedMeshView can carry the same name/class label without a second
 * implementation (核 §1.1 — one label mechanism, three consumers).
 *
 * Ownership contract (PHILOSOPHY #4 — every visual flag has one owner):
 *   - textContent is written ONLY through setText()
 *   - the accent bar colour ONLY through setAccent()
 *   - desired visibility ONLY through setWanted()
 *   - the screen transform ONLY through updatePosition()
 * Consumers compose these from their own single owner method (e.g.
 * MeshView._syncLabel) — never poke the DOM element directly.
 *
 * Sizing (PHILOSOPHY #27): the label is a screen-space DOM element (constant
 * pixel size) anchored to a projected world point — there is no world-unit
 * constant to collapse at mm scale or balloon when zooming out.
 *
 * HTML overlay rule (CODE_CONTRACTS §1): callers pass `SceneView.activeCamera`
 * to updatePosition() so ortho mode projects correctly.
 */
import { Z } from '../theme/tokens.js'

const BG_DEFAULT     = 'rgba(18,22,36,0.82)'
const FG_DEFAULT     = '#b8c4d8'
const ACCENT_DEFAULT = '#4488ff'
const BG_HIGHLIGHT   = 'rgba(249,115,22,0.88)'
const ACCENT_HL      = '#ffcc00'

export class EntityLabel {
  /**
   * @param {import('three').WebGLRenderer} renderer  Canvas bounds source.
   * @param {HTMLElement} container                   DOM parent for the label.
   * @param {{ accent?: string }} [opts]
   */
  constructor(renderer, container, { accent = ACCENT_DEFAULT } = {}) {
    this._renderer = renderer
    this._accent   = accent
    this._wanted   = false

    // Position cache: avoid redundant style writes and prevent mobile jitter
    // caused by per-frame getBoundingClientRect() variation during viewport
    // animations (moved verbatim from CoordinateFrameView).
    this._lblX        = null   // last rendered pixel X (integer)
    this._lblY        = null   // last rendered pixel Y (integer)
    this._lastRawX    = 0      // raw screen X at last write (pre-rounding)
    this._lastRawY    = 0      // raw screen Y at last write (pre-rounding)
    this._cachedRect  = null   // cached canvas bounding rect
    this._cachedRectW = 0      // canvas clientWidth at cache time
    this._cachedRectH = 0      // canvas clientHeight at cache time

    this._el = document.createElement('div')
    this._el.className = 'ee-entity-label'   // semantic hook (styling/debug); content stays owner-written
    Object.assign(this._el.style, {
      position:        'fixed',
      left:            '0',
      top:             '0',
      pointerEvents:   'none',
      userSelect:      'none',
      fontFamily:      'monospace',
      fontSize:        '10px',
      lineHeight:      '1',
      padding:         '2px 6px',
      borderRadius:    '3px',
      background:      BG_DEFAULT,
      color:           FG_DEFAULT,
      borderLeft:      `2px solid ${accent}`,
      whiteSpace:      'nowrap',
      zIndex:          String(Z.sceneLabel),
      display:         'none',
      transition:      'background 0.12s, border-color 0.12s',
      transformOrigin: 'left center',
      willChange:      'transform',
    })
    container.appendChild(this._el)
  }

  /** Sole writer of the label text. Cheap no-op when unchanged. */
  setText(text) {
    if (this._el && this._el.textContent !== text) this._el.textContent = text
  }

  /** Sole writer of the accent bar colour (e.g. IFC class colour, ADR-070 決定2-A). */
  setAccent(cssColor) {
    if (!this._el || this._accent === cssColor) return
    this._accent = cssColor
    this._el.style.borderLeftColor = cssColor
  }

  /**
   * Highlight styling for minimap-node hover sync (CoordinateFrameView lineage).
   * @param {boolean} highlighted
   */
  setHighlighted(highlighted) {
    if (!this._el) return
    if (highlighted) {
      Object.assign(this._el.style, {
        background:  BG_HIGHLIGHT,
        borderColor: ACCENT_HL,
        color:       '#fff',
        transform:   'scale(1.18)',
      })
    } else {
      Object.assign(this._el.style, {
        background:  BG_DEFAULT,
        borderColor: this._accent,
        color:       FG_DEFAULT,
        transform:   'scale(1)',
      })
    }
  }

  /**
   * Sole writer of the DESIRED visibility. The label may still hide itself
   * when the anchor projects behind the camera (updatePosition).
   * @param {boolean} wanted
   */
  setWanted(wanted) {
    this._wanted = wanted
    if (!wanted) this._setDisplay(false)
  }

  get wanted() { return this._wanted }

  /**
   * Projects `worldPos` to screen space and repositions the label.
   * Call once per animation frame while the owning view is visible.
   * @param {import('three').Camera} camera   Pass `SceneView.activeCamera`.
   * @param {import('three').Vector3} worldPos
   */
  updatePosition(camera, worldPos) {
    if (!this._el || !this._wanted) return

    const ndc = worldPos.clone().project(camera)
    if (ndc.z > 1) { this._setDisplay(false); return }

    // Cache getBoundingClientRect keyed on canvas client size so mobile
    // viewport animations (address-bar show/hide) cannot introduce per-frame
    // rect variation that pushes the rounded position across a 0.5-px boundary.
    const canvas = this._renderer.domElement
    const cw = canvas.clientWidth
    const ch = canvas.clientHeight
    if (!this._cachedRect || cw !== this._cachedRectW || ch !== this._cachedRectH) {
      this._cachedRect  = canvas.getBoundingClientRect()
      this._cachedRectW = cw
      this._cachedRectH = ch
    }
    const rect = this._cachedRect

    const sx = (ndc.x  + 1) / 2 * rect.width  + rect.left
    const sy = (-ndc.y + 1) / 2 * rect.height + rect.top

    // Dead-zone filter: suppress writes when camera drifts < 0.5 px in screen
    // space — OrbitControls inertia straddles rounding boundaries otherwise.
    if (this._lblX !== null &&
        Math.hypot(sx - this._lastRawX, sy - this._lastRawY) < 0.5) {
      this._setDisplay(true)
      return
    }
    this._lastRawX = sx
    this._lastRawY = sy

    const rx = Math.round(sx + 6)
    const ry = Math.round(sy - 16)
    this._lblX = rx
    this._lblY = ry
    this._el.style.transform = `translate3d(${rx}px,${ry}px,0)`
    this._setDisplay(true)
  }

  /** @param {boolean} show */
  _setDisplay(show) {
    if (this._el) this._el.style.display = show ? 'block' : 'none'
  }

  /** Removes the DOM element. Safe to call twice. */
  dispose() {
    this._el?.remove()
    this._el = null
  }
}
