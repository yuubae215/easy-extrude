// Screencast overlay — runs IN the recorded page. A view only: it applies the
// numbers `frameState()` computed and decides nothing (no easing, no timing).
// Lives in a shadow root so the product's CSS can neither reach in nor be
// reached. Installed as window.__screencast = { render(state) }.
;(function install(style) {
  if (window.__screencast) return
  const host = document.createElement('div')
  host.id = '__screencast'
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647'
  document.documentElement.appendChild(host)
  const root = host.attachShadow({ mode: 'open' })
  const A = style.accent, INK = style.ink, SURF = style.surface
  const hexA = (hex, a) => `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${a})`
  const kInset = style.keys.inset ?? [0, 64], cInset = style.captions.inset ?? [40, 64]
  root.innerHTML = `
  <style>
    :host { all: initial; }
    * { box-sizing: border-box; }
    .layer { position: fixed; left: 0; top: 0; width: 100vw; height: 100vh; overflow: visible; font-family: ${style.font}; }
    #screen { transform-origin: 0 0; }
    .cursor { position: absolute; left: 0; top: 0; width: ${style.cursor.size}px; height: ${style.cursor.size * 1.3}px; transform-origin: 2px 2px; filter: drop-shadow(0 2px 3px rgba(0,0,0,.45)) drop-shadow(0 0 1px rgba(0,0,0,.6)); will-change: transform; }
    .halo { position: absolute; left: 0; top: 0; width: 36px; height: 36px; margin: -18px 0 0 -18px; border-radius: 50%; background: radial-gradient(circle, ${hexA(A, 0.55)} 0%, ${hexA(A, 0.18)} 45%, transparent 70%); }
    .dot { position: absolute; left: 0; top: 0; width: 8px; height: 8px; margin: -4px 0 0 -4px; border-radius: 50%; background: ${A}; }
    .ripple { position: absolute; left: 0; top: 0; border-radius: 50%; border: 2px solid ${A}; box-shadow: 0 0 12px ${hexA(A, 0.6)}, inset 0 0 8px ${hexA(A, 0.35)}; }
    .chips { position: absolute; display: flex; gap: 8px; align-items: center; padding: 10px 14px; border-radius: 16px;
             background: ${hexA(SURF, 0.72)}; backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
             border: 1px solid rgba(255,255,255,.10); box-shadow: 0 10px 30px rgba(0,0,0,.35), 0 0 0 1px ${hexA(A, 0.10)}; }
    .cap { min-width: 40px; padding: 7px 12px 6px; border-radius: 9px; color: ${INK}; font-weight: 650; font-size: 19px; letter-spacing: .01em; text-align: center;
           background: linear-gradient(180deg, rgba(255,255,255,.14), rgba(255,255,255,.05)); border: 1px solid rgba(255,255,255,.20);
           border-bottom-width: 3px; border-bottom-color: rgba(0,0,0,.45); white-space: pre; }
    .plus { color: ${hexA(INK, 0.5)}; font-weight: 600; font-size: 16px; }
    .caption { position: absolute; display: flex; align-items: stretch; gap: 14px; }
    .bar { width: 4px; border-radius: 2px; background: ${A}; box-shadow: 0 0 14px ${hexA(A, 0.8)}; transform-origin: 50% 100%; }
    .ctext { display: flex; flex-direction: column; justify-content: center; padding: 2px 0; }
    .cidx { font: 600 13px/1 ui-monospace, "SFMono-Regular", Menlo, monospace; color: ${A}; letter-spacing: .18em; margin-bottom: 7px; }
    .cmain { font-weight: 750; font-size: 30px; line-height: 1.05; color: ${INK}; letter-spacing: -.01em; text-shadow: 0 2px 18px rgba(0,0,0,.65), 0 1px 2px rgba(0,0,0,.8); white-space: nowrap; }
    .title { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
    .tbg { position: absolute; inset: 0; }
    .glow { position: absolute; width: 70vmax; height: 70vmax; left: 50%; top: 50%; margin: -35vmax 0 0 -35vmax; border-radius: 50%;
            background: radial-gradient(circle, ${hexA(A, 0.22)} 0%, ${hexA(A, 0.06)} 38%, transparent 66%); }
    .tline { position: relative; font-weight: 800; font-size: 76px; letter-spacing: -.035em; color: ${INK}; white-space: pre; }
    .tline span { display: inline-block; }
    .rule { position: relative; height: 3px; width: 220px; margin: 22px 0 18px; border-radius: 2px; background: linear-gradient(90deg, transparent, ${A}, transparent); transform-origin: 50% 50%; }
    .tsub { position: relative; font-weight: 500; font-size: 22px; letter-spacing: .02em; color: ${hexA(INK, 0.78)}; white-space: pre; }
  </style>
  <div class="layer" id="page"><div class="halo"></div><div class="trail"></div><div class="ripples"></div>
    <svg class="cursor" viewBox="0 0 22 29"><path d="M2 2 L2 23.5 L7.6 18.4 L11.4 27 L15.2 25.3 L11.5 16.9 L19 16.6 Z" fill="${INK}" stroke="#0b0f14" stroke-width="1.6" stroke-linejoin="round"/></svg></div>
  <div class="layer" id="screen"><div class="title"></div><div class="caption"></div><div class="chips"></div></div>`
  const $ = s => root.querySelector(s)
  const page = $('#page'), screen = $('#screen'), cursor = $('.cursor'), halo = $('.halo')
  const trailBox = $('.trail'), rippleBox = $('.ripples'), chipsEl = $('.chips'), capEl = $('.caption'), titleEl = $('.title')
  const pool = (box, cls, n) => { while (box.children.length < n) { const d = document.createElement('div'); d.className = cls; box.appendChild(d) } return [...box.children] }
  let chipKey = '', capKey = '', titleKey = ''

  function render(s) {
    const W = innerWidth, H = innerHeight, cam = s.camera
    const k = cam.w / W                       // screen-space layer pinned to the output frame
    screen.style.transform = `translate(${cam.x}px,${cam.y}px) scale(${k})`
    // ── cursor (page space: zooms with the product) ─────────────────────────
    const c = s.cursor, show = c.visible && !c.hidden
    cursor.style.opacity = show ? 1 : 0
    cursor.style.transform = `translate(${c.x - 2}px,${c.y - 2}px) scale(${(1 - 0.16 * c.press) * k})`
    halo.style.opacity = show ? 0.15 + 0.85 * c.press : 0
    halo.style.transform = `translate(${c.x}px,${c.y}px) scale(${(0.55 + 0.45 * c.press) * k})`
    const dots = pool(trailBox, 'dot', s.trail.length)
    s.trail.forEach((q, i) => {
      const prev = i === 0 ? c : s.trail[i - 1]
      const speed = Math.hypot(q.x - prev.x, q.y - prev.y)          // px per 14ms
      const a = show ? Math.min(1, Math.max(0, (speed - 2.5) / 10)) * (1 - q.k / 6) * 0.55 : 0
      dots[i].style.opacity = a
      dots[i].style.transform = `translate(${q.x}px,${q.y}px) scale(${(1 - q.k * 0.12) * k})`
    })
    const rings = pool(rippleBox, 'ripple', s.ripples.length)
    rings.forEach((el, i) => {
      const r = s.ripples[i]
      if (!r) { el.style.opacity = 0; return }
      const d = (10 + 52 * r.p) * k
      el.style.width = el.style.height = `${d}px`
      el.style.opacity = (1 - r.p) * 0.95
      el.style.transform = `translate(${r.x - d / 2}px,${r.y - d / 2}px)`
    })
    // ── key HUD (screen space) ──────────────────────────────────────────────
    const ch = s.chips[s.chips.length - 1]
    if (!ch) chipsEl.style.opacity = 0
    else {
      const key = ch.id + ch.caps.join('\u0000')
      if (key !== chipKey) {
        chipKey = key
        chipsEl.innerHTML = ch.caps.map((t, i) => `${i ? '<span class="plus">+</span>' : ''}<span class="cap">${t.replace(/[<&]/g, m => ({ '<': '&lt;', '&': '&amp;' })[m])}</span>`).join('')
      }
      const box = chipsEl.getBoundingClientRect()
      const bw = box.width / k, bh = box.height / k
      const anchor = style.keys.anchor
      const x = anchor === 'bottom-right' ? W - bw - kInset[0] : (W - bw) / 2 + kInset[0]
      const y = anchor === 'top-center' ? kInset[1] : H - bh - kInset[1]
      chipsEl.style.left = `${x}px`; chipsEl.style.top = `${y}px`
      chipsEl.style.opacity = ch.fadeP * (1 - ch.outP)
      chipsEl.style.transform = `translateY(${(1 - ch.inP) * 22 - ch.outP * 12}px) scale(${0.9 + 0.1 * ch.inP})`
      ;[...chipsEl.querySelectorAll('.cap')].forEach((el, i) => {
        const p = ch.caps_p[i] ?? 1
        el.style.transform = `translateY(${(1 - p) * 10}px) scale(${0.7 + 0.3 * p})`
        el.style.opacity = Math.min(1, p * 1.6)
      })
    }
    // ── caption / lower third ───────────────────────────────────────────────
    const cp = s.caption
    if (!cp) capEl.style.opacity = 0
    else {
      const key = cp.index + cp.text
      if (key !== capKey) {
        capKey = key
        capEl.innerHTML = `<div class="bar"></div><div class="ctext">${cp.index ? `<div class="cidx">${cp.index}</div>` : ''}<div class="cmain">${cp.text}</div></div>`
      }
      const anchor = style.captions.anchor
      capEl.style.left = `${anchor === 'top-center' ? (W - capEl.getBoundingClientRect().width / k) / 2 : cInset[0]}px`
      capEl.style.top = anchor === 'bottom-left' ? `${H - cInset[1] - capEl.getBoundingClientRect().height / k}px` : `${cInset[1]}px`
      capEl.style.opacity = 1 - cp.outP
      capEl.style.transform = `translateY(${cp.outP * 10}px)`
      capEl.querySelector('.bar').style.transform = `scaleY(${cp.barP})`
      const t = capEl.querySelector('.ctext')
      t.style.clipPath = `inset(-20px ${(1 - cp.inP) * 100}% -20px -4px)`
      t.style.transform = `translateX(${(1 - cp.inP) * -16}px)`
    }
    // ── title card ──────────────────────────────────────────────────────────
    const tt = s.title
    if (!tt) titleEl.style.opacity = 0
    else {
      const key = tt.text + tt.sub + tt.backdrop
      if (key !== titleKey) {
        titleKey = key
        titleEl.innerHTML = `<div class="tbg"></div><div class="glow"></div><div class="tline">${[...tt.text].map(ch => `<span>${ch === ' ' ? '&nbsp;' : ch}</span>`).join('')}</div><div class="rule"></div><div class="tsub">${tt.sub}</div>`
      }
      titleEl.style.opacity = 1
      const live = 1 - tt.outP
      const bg = titleEl.querySelector('.tbg')
      const a = Math.min(1, tt.inMs / 450) * live
      bg.style.background = tt.backdrop === 'none' ? 'transparent' : tt.backdrop === 'solid' ? hexA(SURF, a) : hexA(SURF, 0.74 * a)
      const blur = tt.backdrop === 'blur' ? `blur(${14 * a}px) saturate(${1 + 0.4 * a})` : 'none'
      bg.style.backdropFilter = blur; bg.style.webkitBackdropFilter = blur
      const g = titleEl.querySelector('.glow')
      g.style.opacity = a
      g.style.transform = `translate(${Math.sin(tt.inMs * 0.0007) * 40}px,${Math.cos(tt.inMs * 0.0005) * 24}px) scale(${1 + 0.04 * Math.sin(tt.inMs * 0.0012)})`
      ;[...titleEl.querySelectorAll('.tline span')].forEach((el, i) => {
        const p = tt.letters[i] ?? 1
        el.style.transform = `translateY(${(1 - p) * 34 - tt.outP * 18}px) rotate(${(1 - p) * 6}deg)`
        el.style.opacity = Math.min(1, Math.max(0, p * 1.4)) * live
      })
      const rule = titleEl.querySelector('.rule'), sub = titleEl.querySelector('.tsub')
      rule.style.transform = `scaleX(${tt.subP})`; rule.style.opacity = live
      sub.style.opacity = tt.subP * live
      sub.style.transform = `translateY(${(1 - tt.subP) * 12 - tt.outP * 10}px)`
    }
  }
  window.__screencast = { render }
})(__STYLE__)
