/**
 * Entry point - assembles MVC components and starts the app
 */
import { SceneView }       from './view/SceneView.js'
import { UIView }          from './view/UIView.js'
import { GizmoView }       from './view/GizmoView.js'
import { OutlinerView }    from './view/OutlinerView.js'
import { AppController }   from './controller/AppController.js'
import { geometryEngine }  from './service/GeometryEngine.js'

// Start the Wasm geometry worker in the background (ADR-027).
// The rest of the app boots synchronously and uses the JS fallback until
// the worker signals ready (~20–100 ms).  Once ready, new geometry calls
// are automatically dispatched to Wasm.
geometryEngine.init().then(() => {
  console.info(`[GeometryEngine] ready — Wasm: ${geometryEngine.isWasmActive}`)
})

const sceneView    = new SceneView()
const uiView       = new UIView()
const gizmoView    = new GizmoView(sceneView.camera, sceneView.controls)
const outlinerView = new OutlinerView()
const controller   = new AppController(sceneView, uiView, gizmoView, outlinerView)

controller.start()
