import { useUIStore } from '../store/uiStore.js'

/**
 * UIViewBridge — wraps UIView and mirrors key method calls into the Zustand
 * store so React components can read the same UI state.
 *
 * Forwards every call to the original UIView first, then updates the store.
 * This keeps UIView.js fully functional during the incremental React migration.
 *
 * React takeover flags: once a React component fully covers a UIView section,
 * call enableReact*() to stop forwarding to UIView for that section.
 *
 * Methods bridged:
 *   showToast, setStatus, setStatusRich, setCursor,
 *   setMobileToolbar, updateMode, setExtrusionLabel
 */
export class UIViewBridge {
  // Class fields so the Proxy set-handler keeps them on this instance (not _view).
  _reactMobileToolbar = false

  constructor(uiView) {
    this._view = uiView
    // Hold a direct reference to the native toolbar element so we can hide it
    // when React's MobileToolbar component takes over rendering.
    this._nativeToolbarEl = uiView._mobileToolbarEl ?? null

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

  /**
   * Signal that the React MobileToolbar component is now rendering the toolbar.
   * After this call:
   *   - setMobileToolbar() stops forwarding to UIView (React reads from store)
   *   - The native DOM toolbar container is permanently hidden
   *   - _applyMobileLayout() is patched so resize events don't re-show the native el
   */
  enableReactMobileToolbar() {
    this._reactMobileToolbar = true

    // Hide the native toolbar container immediately.
    if (this._nativeToolbarEl) {
      this._nativeToolbarEl.style.setProperty('display', 'none', 'important')
    }

    // Patch UIView's resize handler so it never re-shows the native toolbar.
    const view = this._view
    const origApply = view._applyMobileLayout.bind(view)
    view._applyMobileLayout = () => {
      origApply()
      if (this._nativeToolbarEl) {
        this._nativeToolbarEl.style.setProperty('display', 'none', 'important')
      }
    }
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
    if (!this._reactMobileToolbar) {
      this._view.setMobileToolbar(buttons)
    }
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
