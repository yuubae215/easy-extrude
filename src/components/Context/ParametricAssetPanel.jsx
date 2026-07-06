import { useUIStore } from '../../store/uiStore.js'
import {
  PARAMETRIC_CATALOG,
  getParametricAsset,
  assetCommitEntries,
} from '../../context/ParametricAssets.js'

/**
 * ParametricAssetPanel — the parametric 3-D asset viewer tab (ADR-063 Phase 4,
 * "選択優先インテーク").
 *
 * Two screens: a picker (catalog cards — recognition over recall) and the
 * viewer (one slider per parameter). Sliders fire `onAssetParam` live — the
 * controller rebuilds the ghost preview in 3-D — and the ONLY doc-mutating
 * exit is the explicit Commit button (`onAssetViewerCommit`), which records
 * the converted numbers/text (variables + one asserted fact). The commit
 * preview line prints exactly what will be written, so the "3-D is the input
 * device, the doc is the artifact" contract is visible, not implied.
 *
 * The panel only READS `context.assetViewer`; ContextController is the sole
 * writer (grasp/wizard discipline — ADR-057 / PHILOSOPHY #5).
 */

const cardStyle = {
  background: '#2a2a2a', border: '1px solid #3a3a3a', borderRadius: '5px',
  padding: '8px 10px', marginBottom: '7px', cursor: 'pointer',
  transition: 'border-color 0.15s',
}

function AssetPicker({ onOpen, embedded }) {
  return (
    <div>
      {!embedded && (
        <div style={{ fontSize: '10px', color: '#999', lineHeight: 1.6, marginBottom: '8px' }}>
          Pick an asset and shape it with sliders — the 3-D ghost responds live.
          Committing writes <b>numbers</b> (design variables + an asserted fact)
          into the document; the boxes are never the artifact.
        </div>
      )}
      {PARAMETRIC_CATALOG.map(a => (
        <div
          key={a.id}
          style={cardStyle}
          onClick={() => onOpen(a.id)}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#3a7bd5' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = '#3a3a3a' }}
        >
          <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#5a9bf5' }}>{a.name}</div>
          <div style={{ fontSize: '10px', color: '#aaa', lineHeight: 1.5, marginTop: '2px' }}>
            {a.description}
          </div>
          <div style={{ fontSize: '9px', color: '#777', marginTop: '3px' }}>
            {a.params.map(p => p.label).join(' · ')}
          </div>
        </div>
      ))}
    </div>
  )
}

function ParamSlider({ param, value, onChange }) {
  return (
    <div style={{ marginBottom: '9px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', fontSize: '10px', marginBottom: '2px' }}>
        <span style={{ color: '#bbb' }}>{param.label}</span>
        <span style={{ marginLeft: 'auto', fontFamily: 'monospace', color: '#5a9bf5' }}>
          {value} {param.unit}
        </span>
      </div>
      <input
        type="range"
        min={param.min} max={param.max} step={param.step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: '#3a7bd5' }}
      />
      <div style={{ display: 'flex', fontSize: '8px', color: '#666' }}>
        <span>{param.min}</span>
        <span style={{ marginLeft: 'auto' }}>{param.max}</span>
      </div>
    </div>
  )
}

function AssetViewer({ viewer, callbacks }) {
  const asset = getParametricAsset(viewer.assetId)
  if (!asset) return null
  const { variables, fact } = assetCommitEntries(asset, viewer.values)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: '2px' }}>
        <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#e0e0e0' }}>{asset.name}</span>
        <button
          onClick={() => callbacks.onAssetViewerClose?.()}
          title="Close viewer (discards the preview; committed entries stay)"
          style={{
            marginLeft: 'auto', background: 'transparent', border: 'none',
            color: '#888', cursor: 'pointer', fontSize: '10px', fontFamily: 'inherit',
          }}
        >
          ← catalog
        </button>
      </div>
      <div style={{ fontSize: '9px', color: '#888', lineHeight: 1.5, marginBottom: '8px' }}>
        Drag the sliders — the blue ghost in 3-D is the live preview. Nothing is
        written until you commit.
      </div>

      {asset.params.map(p => (
        <ParamSlider
          key={p.key} param={p} value={viewer.values[p.key]}
          onChange={v => callbacks.onAssetParam?.(p.key, v)}
        />
      ))}

      {/* Honest commit preview: exactly the entries a commit writes. */}
      <div style={{
        background: 'rgba(58,123,213,0.08)', border: '1px solid #3a7bd544',
        borderRadius: '4px', padding: '6px 8px', margin: '4px 0 8px',
        fontSize: '9px', color: '#9ab', lineHeight: 1.6, fontFamily: 'monospace',
      }}>
        <div style={{ color: '#5a9bf5', fontFamily: 'system-ui, sans-serif' }}>Commit writes:</div>
        {variables.map(v => (
          <div key={v.ref}>{v.ref} · {v.unit} · domain [{v.domain[0]}, {v.domain[1]}]</div>
        ))}
        <div>{fact.ref} · {Object.entries(fact.attrs).map(([k, a]) => `${k}=${a.value}${a.unit}`).join(', ')}</div>
      </div>

      <button
        onClick={() => callbacks.onAssetViewerCommit?.()}
        style={{
          width: '100%', padding: '6px', borderRadius: '3px', border: 'none',
          background: '#3a7bd5', color: '#fff', fontSize: '11px', cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        ✓ Commit as variables + fact (undoable)
      </button>
    </div>
  )
}

/**
 * @param {{embedded?: boolean}} props — embedded mode (wizard step) drops the
 *   long intro line; behaviour is otherwise identical (same callbacks, same
 *   single write path).
 */
export function ParametricAssetPanel({ embedded = false } = {}) {
  const viewer    = useUIStore(s => s.context.assetViewer)
  const callbacks = useUIStore(s => s.callbacks)

  return (
    <div style={{ paddingBottom: '6px' }}>
      {viewer
        ? <AssetViewer viewer={viewer} callbacks={callbacks} />
        : <AssetPicker embedded={embedded} onOpen={id => callbacks.onAssetViewerOpen?.(id)} />}
    </div>
  )
}
