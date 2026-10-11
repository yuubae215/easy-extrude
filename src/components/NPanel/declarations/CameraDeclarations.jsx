import { useUIStore } from '../../../store/uiStore.js'
import { COLOR } from '../../../theme/tokens.js'
import { DEFAULT_CAMERA_DECLARATION, CAMERA_STATE } from '../../../domain/visionCamera.js'
import { CommitField, FaceChip } from '../../Grasp/GraspFields.jsx'
import { Section } from '../npanelShared.jsx'

const fmt = (v) => (Math.round(v * 1000) / 1000).toString()
const fullDeg = (half) => Math.round((2 * half * 180) / Math.PI)

/**
 * CameraDeclarations — "can it be seen" is asked from THIS frame (ADR-164 D3, the
 * VISION domain of D1). Before D3 the camera was a card of React state in the
 * grasp panel and belonged to no entity (DEF-033); now it is a frame carrying a
 * `camera` declaration, and this is its panel.
 *
 * What is declared here is only what the pose cannot say: the field of view.
 * Where it stands and which way it looks ARE the frame's pose (Location /
 * Rotation above — ROS optical frame: +Z is the line of sight, +Y image-down),
 * moved with G / R or by "copy the current view". The wire's viewAxis is read
 * back below, derived — so what is sent is checkable before Run (原則 #33 (4)).
 *
 * Shown on every non-robot frame: the checkbox is how an existing frame (a
 * wrist-camera frame under the tcp, say) becomes a camera, and how a camera
 * stops being one. `camera` is null when the frame is not a camera.
 */
export function CameraDeclarations({ camera, frameId }) {
  const callbacks = useUIStore(s => s.callbacks)
  if (!frameId) return null
  const set = (next) => callbacks.onSetCamera?.(frameId, next)
  const isCamera = camera != null
  return (
    <Section title="Declarations (vision camera)">
      <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10px', color: COLOR.textSecondary, marginBottom: '6px' }}>
        <input
          type="checkbox"
          checked={isCamera}
          onChange={e => set(e.target.checked ? { ...DEFAULT_CAMERA_DECLARATION } : null)}
        />
        this frame is a vision camera
      </label>
      {isCamera && <CameraEditor camera={camera} frameId={frameId} onSet={set} callbacks={callbacks} />}
    </Section>
  )
}

function CameraEditor({ camera, frameId, onSet, callbacks }) {
  const fov = camera.fovHalfAngle
  const malformed = camera.state === CAMERA_STATE.MALFORMED
  return (
    <div data-declaration="camera" style={{ fontSize: '10px', color: COLOR.textSecondary }}>
      {malformed && (
        <div style={{ color: COLOR.cautionTone, marginBottom: '4px' }}>
          {(camera.errors ?? []).map((e, i) => <div key={i}>· {e}</div>)}
        </div>
      )}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '4px' }}>
        <CommitField
          label="field-of-view half angle (rad)"
          value={fov ?? null}
          step="0.05"
          onCommit={(v) => { if (v > 0 && v < Math.PI / 2) onSet({ fovHalfAngle: v }) }}
        />
        {fov != null && (
          <FaceChip label="no field of view" active={false} onClick={() => onSet({})} />
        )}
      </div>
      <div style={{ marginBottom: '6px' }}>
        {fov != null
          ? <>≈ {fullDeg(fov)}° across. Drawn as the square whose inscribed cone is what is judged — the four corners are drawn, not judged.</>
          : !malformed && <>no field of view declared — only the line of sight is judged, and no frustum is drawn</>}
      </div>

      <button
        type="button"
        data-testid="camera-copy-view"
        disabled={camera.parented}
        title={camera.parented
          ? 'This camera hangs from another frame — its pose is local to that frame. Copy the view onto a world-placed camera, or unparent it first.'
          : 'Put this camera where the viewport is, looking where it looks (one undo)'}
        onClick={() => callbacks.onCopyViewToCamera?.(frameId)}
        style={{
          padding: '3px 8px', borderRadius: '4px', border: `1px solid ${COLOR.border}`,
          background: COLOR.surfaceRaised, color: camera.parented ? COLOR.textSecondary : COLOR.textPrimary,
          fontSize: '10px', cursor: camera.parented ? 'not-allowed' : 'pointer', marginBottom: '6px',
        }}
      >📷 copy the current view</button>

      {camera.wire && (
        <div style={{ marginBottom: '4px' }}>
          looks along ({camera.wire.viewAxis.map(fmt).join(', ')}) — its +Z, image-up is its −Y
        </div>
      )}
      <SearchLine camera={camera} frameId={frameId} callbacks={callbacks} />
    </div>
  )
}

/** Whether the search asks from this camera — and the way to make it, with N cameras. */
function SearchLine({ camera, frameId, callbacks }) {
  if (camera.inSearch) {
    return <div style={{ color: COLOR.factTone }}>the grasp search asks "can it be seen" from this camera</div>
  }
  return (
    <div style={{ display: 'flex', gap: '4px', alignItems: 'baseline', flexWrap: 'wrap' }}>
      <span>{camera.cardinality === 'multi' ? 'not the camera the search asks from' : 'not asked from'}</span>
      <button
        type="button"
        data-testid="camera-use-in-search"
        onClick={() => callbacks.onSelectCamera?.(frameId)}
        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: COLOR.infoTone, fontSize: '10px' }}
      >▸ ask from this camera</button>
    </div>
  )
}
