/**
 * UIView - DOM UI 要素の管理
 *
 * 副作用: DOM 要素の生成・追加・スタイル変更を行う。
 */
export class UIView {
  constructor() {
    // Mode bar (top-left)
    this._modeBarEl = document.createElement('div')
    Object.assign(this._modeBarEl.style, {
      position: 'fixed', top: '20px', left: '20px',
      display: 'flex', gap: '8px',
    })
    document.body.appendChild(this._modeBarEl)

    // Status bar (top-center)
    this._statusEl = document.createElement('div')
    Object.assign(this._statusEl.style, {
      position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)',
      color: '#ffeb3b', fontSize: '15px', fontFamily: 'sans-serif',
      background: 'rgba(0,0,0,0.55)', padding: '6px 16px', borderRadius: '6px',
      pointerEvents: 'none', minWidth: '120px', textAlign: 'center',
    })
    document.body.appendChild(this._statusEl)

    // Info bar (bottom-center)
    this._infoEl = document.createElement('div')
    Object.assign(this._infoEl.style, {
      position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)',
      color: '#ccc', fontSize: '13px', fontFamily: 'sans-serif',
      background: 'rgba(0,0,0,0.55)', padding: '8px 18px', borderRadius: '8px',
      pointerEvents: 'none', textAlign: 'center', lineHeight: '1.6',
    })
    document.body.appendChild(this._infoEl)

    this._btnObject = this._makeBtn('オブジェクト (O)')
    this._btnFace   = this._makeBtn('面選択 (F)')
    this._modeBarEl.appendChild(this._btnObject)
    this._modeBarEl.appendChild(this._btnFace)

    this._canvas = null

    // Extrusion label (floating, follows 3D midpoint projected to screen)
    this._extrusionLabelEl = document.createElement('div')
    Object.assign(this._extrusionLabelEl.style, {
      position: 'fixed',
      color: '#ffffff',
      fontSize: '13px',
      fontFamily: 'monospace',
      background: 'rgba(0,0,0,0.72)',
      padding: '3px 10px',
      borderRadius: '4px',
      border: '1px solid rgba(255,255,255,0.45)',
      pointerEvents: 'none',
      display: 'none',
      transform: 'translate(-50%, -50%)',
      whiteSpace: 'nowrap',
    })
    document.body.appendChild(this._extrusionLabelEl)
  }

  _makeBtn(label) {
    const btn = document.createElement('button')
    btn.textContent = label
    Object.assign(btn.style, {
      padding: '7px 15px', borderRadius: '6px', border: '2px solid #555',
      background: 'rgba(0,0,0,0.6)', color: '#aaa', cursor: 'pointer',
      fontSize: '13px', fontFamily: 'sans-serif',
    })
    return btn
  }

  /** モード変更ボタンのコールバックを登録する */
  onModeChange(callback) {
    this._btnObject.addEventListener('click', () => callback('object'))
    this._btnFace.addEventListener('click',   () => callback('face'))
  }

  /** アクティブモードに合わせてボタン外観と説明文を更新する */
  updateMode(mode) {
    const active   = { background: 'rgba(79,195,247,0.25)', color: '#4fc3f7', borderColor: '#4fc3f7' }
    const inactive = { background: 'rgba(0,0,0,0.6)',       color: '#aaa',    borderColor: '#555' }
    Object.assign(this._btnObject.style, mode === 'object' ? active : inactive)
    Object.assign(this._btnFace.style,   mode === 'face'   ? active : inactive)
    this._infoEl.innerHTML = mode === 'object'
      ? 'クリック→選択 &nbsp;|&nbsp; 左ドラッグ→移動 &nbsp;|&nbsp; Ctrl+ドラッグ→Y軸回転 &nbsp;|&nbsp; 右ドラッグ→視点回転'
        + '<br>G→グラブ移動 &nbsp;|&nbsp; G→X/Y/Z→軸制限 &nbsp;|&nbsp; 数値入力→距離指定 &nbsp;|&nbsp; Enter/左クリック→確定 &nbsp;|&nbsp; Esc/右クリック→キャンセル'
      : '面ホバー→ハイライト &nbsp;|&nbsp; 左ドラッグ→面の押し出し &nbsp;|&nbsp; 右ドラッグ→視点回転'
  }

  /** ステータステキストを更新する */
  setStatus(text) {
    this._statusEl.textContent = text
  }

  /**
   * 押し出し量ラベルを表示する
   * @param {string} text - 表示テキスト
   * @param {number} screenX - スクリーン座標 X (px)
   * @param {number} screenY - スクリーン座標 Y (px)
   */
  setExtrusionLabel(text, screenX, screenY) {
    this._extrusionLabelEl.textContent = text
    this._extrusionLabelEl.style.left = `${screenX}px`
    this._extrusionLabelEl.style.top  = `${screenY}px`
    this._extrusionLabelEl.style.display = 'block'
  }

  /** 押し出し量ラベルを非表示にする */
  clearExtrusionLabel() {
    this._extrusionLabelEl.style.display = 'none'
  }

  /** canvas 要素のカーソルスタイルを変更する */
  setCursor(style) {
    if (this._canvas) this._canvas.style.cursor = style
  }

  /** カーソル操作対象の canvas を設定する */
  setCanvas(canvas) {
    this._canvas = canvas
  }
}
