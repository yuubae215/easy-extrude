/**
 * Entry point - assembles MVC components and starts the app
 */
import { createInitialCorners } from './model/CuboidModel.js'
import { SceneView }            from './view/SceneView.js'
import { MeshView }             from './view/MeshView.js'
import { UIView }               from './view/UIView.js'
import { GizmoView }            from './view/GizmoView.js'
import { AppController }        from './controller/AppController.js'

const model      = { corners: createInitialCorners() }
const sceneView  = new SceneView()
const meshView   = new MeshView(sceneView.scene)
const uiView     = new UIView()
const gizmoView  = new GizmoView(sceneView.camera, sceneView.controls)
const controller = new AppController(model, sceneView, meshView, uiView, gizmoView)

controller.start()
