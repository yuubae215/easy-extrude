import { useUIStore } from '../store/uiStore.js'

/**
 * UIViewBridge — wraps UIView and mirrors key method calls into the Zustand
 * store so React components can read the same UI state.
 *
 * Forwards every call to the original UIView first, then updates the store.
 * This keeps UIView.js fully functional during the incremental React migration.
 * Phase 2 will remove the UIView.js calls once React components cover each area.
 *
 * Methods bridged:
 *   showToast, setStatus, setStatusRich, setCursor,
 *   setMobileToolbar, updateMode, setExtrusionLabel
 */
export class UIViewBridge {
  constructor(uiView) {
    this._view = uiView

    // Expose every property/method on the wrapped view transparently so
    // AppController can use this as a drop-in replacement for UIView.
    return new Proxy(this, {
      get(target, prop) {
        if (prop in target) return typeof target[prop] === 'function'
          ? target[prop].bind(target)
          : target[prop]
        const orig = target._view[prop]
        return typeof orig === 'function' ? orig.bind(target._view) : orig
      },
      set(target, prop, value) {
        if (prop in target) { target[prop] = value; return true }
        target._view[prop] = value
        return true
      },
    })
  }

  // ── Bridged methods ───────────────────────────────────────────────────────

  showToast(msg, opts = {}) {
    this._view.showToast(msg, opts)
    useUIStore.getState().actions.pushToast(msg, opts.type ?? 'info')
  }

  setStatus(text) {
    this._view.setStatus(text)
    useUIStore.getState().actions.setStatus(text)
  }

  setStatusRich(parts) {
    this._view.setStatusRich(parts)
    useUIStore.getState().actions.setStatusRich(parts)
  }

  setCursor(style) {
    this._view.setCursor(style)
    useUIStore.getState().actions.setCursor(style)
  }

  setMobileToolbar(buttons) {
    this._view.setMobileToolbar(buttons)
    useUIStore.getState().actions.setToolbar(buttons)
  }

  updateMode(mode, subtype = null) {
    this._view.updateMode(mode, subtype)
    useUIStore.getState().actions.updateMode(mode, subtype)
  }

  setExtrusionLabel(text, x, y) {
    this._view.setExtrusionLabel(text, x, y)
    useUIStore.getState().actions.setExtrusionLabel(text, x, y)
  }
}
