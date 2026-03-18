/**
 * Entry point - assembles MVC components and starts the app
 */
import { SceneView }     from './view/SceneView.js'
import { UIView }        from './view/UIView.js'
import { GizmoView }     from './view/GizmoView.js'
import { OutlinerView }  from './view/OutlinerView.js'
import { AppController } from './controller/AppController.js'

const sceneView    = new SceneView()
const uiView       = new UIView()
const gizmoView    = new GizmoView(sceneView.camera, sceneView.controls)
const outlinerView = new OutlinerView()
const controller   = new AppController(sceneView, uiView, gizmoView, outlinerView)

controller.start()
