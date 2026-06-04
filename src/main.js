/**
 * Entry point - assembles MVC components and starts the app
 */
import { createRoot }      from 'react-dom/client'
import { createElement }   from 'react'
import { UIShell }         from './components/UIShell.jsx'
import { SceneView }       from './view/SceneView.js'
import { UIView }          from './view/UIView.js'
import { UIViewBridge }    from './view/UIViewBridge.js'
import { GizmoView }       from './view/GizmoView.js'
import { OutlinerBridge }  from './view/OutlinerBridge.js'
import { AppController }   from './controller/AppController.js'
import { geometryEngine }   from './service/GeometryEngine.js'
import { constraintSolver } from './service/ConstraintSolver.js'

// Mount the React UI overlay.
const reactRoot = document.getElementById('react-ui-root')
if (reactRoot) {
  createRoot(reactRoot).render(createElement(UIShell))
}

// Start the Wasm geometry worker in the background (ADR-027).
// The rest of the app boots synchronously and uses the JS fallback until
// the worker signals ready (~20–100 ms).  Once ready, new geometry calls
// are automatically dispatched to Wasm.
geometryEngine.init().then(() => {
  console.info(`[GeometryEngine] ready — Wasm: ${geometryEngine.isWasmActive}`)
})

// Load the Wasm constraint solver on the main thread for synchronous per-frame math.
// Uses the same .wasm binary as GeometryEngine but a separate instance with independent memory.
constraintSolver.init().then(() => {
  console.info(`[ConstraintSolver] ready — Wasm: ${constraintSolver.isWasmActive}`)
})

const sceneView    = new SceneView()
const uiView       = new UIViewBridge(new UIView())
const gizmoView    = new GizmoView(sceneView.camera, sceneView.controls)
const outlinerView = new OutlinerBridge()
const controller   = new AppController(sceneView, uiView, gizmoView, outlinerView)

// Hand UI sections to React — hides the corresponding UIView native elements.
uiView.enableReactHeader()
uiView.enableReactMobileToolbar()
uiView.enableReactNPanel()
uiView.enableReactExtrusionLabel()
uiView.enableReactInfoBar()
uiView.enableReactModals()
uiView.enableReactMapToolbar()
uiView.enableReactContextMenu()
uiView.enableReactAddMenu()
uiView.enableReactLinkTypePicker()
uiView.enableReactSemanticSuggestion()
uiView.enableReactImportUI()
uiView.enableReactOnboarding()
outlinerView.enableReact()

controller.start()
