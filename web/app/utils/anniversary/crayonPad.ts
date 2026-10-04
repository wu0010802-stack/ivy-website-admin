// 30 週年分頁「換你畫一個 30」：WebGL2 蠟筆畫板。
// 一筆畫的覆蓋率先用 MAX 混合畫進「這一筆」圖層（接點不會疊出一顆顆的點），
// 放開時才依紙紋把蠟「沉積」到顏料圖層：紙紋凸處上色、凹處留白，跟真的蠟筆一樣。
// 虛線導引是開場影片裡那個「30」的同一組幾何（3 是兩段圓弧加中間小迴轉，0 是橢圓）。
import { ANNI_MEDIA } from './media'
import { cssColorRGB, loadImage } from './paperGL'

const QUAD_VS = `#version 300 es
in vec2 aP; void main(){ gl_Position = vec4(aP * 2.0 - 1.0, 0.0, 1.0); }`

// 一段線段（膠囊形）：頂點帶線段兩端與半徑
const SEG_VS = `#version 300 es
in vec2 aPos; in vec4 aSeg; in float aR;
uniform vec2 uRes;
out vec2 vP; flat out vec4 vSeg; flat out float vR;
void main(){ vP = aPos; vSeg = aSeg; vR = aR; gl_Position = vec4(aPos / uRes * 2.0 - 1.0, 0.0, 1.0); }`
const SEG_FS = `#version 300 es
precision highp float;
in vec2 vP; flat in vec4 vSeg; flat in float vR; out vec4 o;
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
void main(){
  vec2 a = vSeg.xy, b = vSeg.zw, pa = vP - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
  float d = length(pa - ba * h) / vR;
  float rag = 0.12 * (hash(floor(vP * 0.7)) - 0.5) + 0.08 * (hash(floor(vP * 2.3)) - 0.5);
  float cov = 1.0 - smoothstep(0.72, 1.0, d + rag);
  o = vec4(cov);
}`

// 這一筆沉積到顏料層／即時預覽：依紙紋決定蠟附著多少
const DEPOSIT_FS = `#version 300 es
precision highp float;
uniform sampler2D uStroke, uPaper; uniform vec3 uColor; uniform vec2 uRes;
out vec4 o;
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float cov = texture(uStroke, uv).a;
  if (cov <= 0.002) { o = vec4(0.0); return; }
  float tooth = texture(uPaper, gl_FragCoord.xy / 260.0).r;
  float wax = smoothstep(0.6 - cov * 0.55, 0.78 - cov * 0.5, tooth);
  float a = cov * mix(0.38, 0.96, wax);
  o = vec4(uColor * a, a);
}`

// 畫面：紙（白＋紙紋明暗）上疊顏料
const SHOW_FS = `#version 300 es
precision highp float;
uniform sampler2D uPaint, uPaper; uniform vec3 uPaperCol; uniform vec2 uRes;
out vec4 o;
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float g = texture(uPaper, gl_FragCoord.xy / 260.0).r;
  vec3 paper = uPaperCol * (0.9 + 0.1 * g);
  vec4 p = texture(uPaint, uv);
  o = vec4(paper * (1.0 - p.a) + p.rgb, 1.0);
}`

interface Target { fbo: WebGLFramebuffer; tex: WebGLTexture }

/** 開場影片的「30」：取樣成折線，座標在 x∈[-49.7,56]、y∈[-41.5,33.5]（y 往上） */
export function thirtyStrokes(): Array<Array<[number, number]>> {
  const pts3: Array<[number, number]> = []
  const arc = (cx: number, cy: number, r: number, a0: number, a1: number, n: number) => {
    for (let i = 0; i <= n; i++) { const a = (a0 + (a1 - a0) * i / n) * Math.PI / 180; pts3.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]) }
  }
  arc(-37, 17, 16.5, 135, -90, 80)
  arc(-37, -2.5, 3, 90, 270, 16)
  arc(-37, -23.5, 18, 90, -135, 90)
  const pts0: Array<[number, number]> = []
  for (let i = 0; i <= 120; i++) { const a = -Math.PI / 2 + Math.PI * 2 * i / 120; pts0.push([29 + Math.cos(a) * 27, -4 + Math.sin(a) * 37.5]) }
  return [pts3, pts0]
}

export interface CrayonPad {
  setColor(css: string): void
  setGuide(on: boolean): void
  clear(): void
  save(): Promise<string>
  destroy(): void
}

export async function mountCrayonPad(canvas: HTMLCanvasElement, opts: { color: string; guide: boolean }): Promise<CrayonPad | null> {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: true, premultipliedAlpha: true })
  if (!gl) return null
  const box = canvas.parentElement!
  const css = getComputedStyle(box)
  const paperCol = cssColorRGB(css.getPropertyValue('--white').trim() || '#fff')
  let color = cssColorRGB(opts.color)
  const paperImg = await loadImage(ANNI_MEDIA.paper)

  const compile = (vs: string, fs: string, attrs: string[]) => {
    const sh = (t: number, s: string) => { const x = gl.createShader(t)!; gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x) ?? ''); return x }
    const p = gl.createProgram()!
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs))
    attrs.forEach((a, i) => gl.bindAttribLocation(p, i, a))
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? '')
    const u = (n: string) => gl.getUniformLocation(p, n)
    return { p, u }
  }
  const segP = compile(SEG_VS, SEG_FS, ['aPos', 'aSeg', 'aR'])
  const depP = compile(QUAD_VS, DEPOSIT_FS, ['aP'])
  const showP = compile(QUAD_VS, SHOW_FS, ['aP'])

  const quad = gl.createVertexArray()!
  gl.bindVertexArray(quad)
  const qb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, qb)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  const segVao = gl.createVertexArray()!
  gl.bindVertexArray(segVao)
  const sb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, sb)
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 28, 0)
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 8)
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 28, 24)
  gl.bindVertexArray(null)

  const paperTex = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, paperTex)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, paperImg)
  gl.generateMipmap(gl.TEXTURE_2D)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)

  let W = 0, H = 0, dpr = 1
  let paint: Target | null = null, stroke: Target | null = null
  const target = (w: number, h: number): Target => {
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    const fbo = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return { fbo, tex }
  }
  const free = (t: Target | null) => { if (t) { gl.deleteFramebuffer(t.fbo); gl.deleteTexture(t.tex) } }

  // 尺寸改變時保留已經畫好的內容：複製舊的顏料層並縮放
  const resize = () => {
    const nd = Math.min(devicePixelRatio || 1, 2)
    const nw = Math.max(2, Math.round(box.clientWidth * nd)), nh = Math.max(2, Math.round(box.clientHeight * nd))
    if (nw === W && nh === H) return
    const old = paint, ow = W, oh = H
    W = nw; H = nh; dpr = nd
    canvas.width = W; canvas.height = H
    paint = target(W, H)
    free(stroke); stroke = target(W, H)
    if (old) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, old.fbo)
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, paint.fbo)
      gl.blitFramebuffer(0, 0, ow, oh, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.LINEAR)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      free(old)
    }
    drawGuide()
    show()
  }

  const fullQuad = () => { gl.bindVertexArray(quad); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4) }
  const deposit = (to: WebGLFramebuffer | null) => {
    gl.useProgram(depP.p)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, stroke!.tex); gl.uniform1i(depP.u('uStroke'), 0)
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, paperTex); gl.uniform1i(depP.u('uPaper'), 1)
    gl.uniform3fv(depP.u('uColor'), color)
    gl.uniform2f(depP.u('uRes'), W, H)
    gl.bindFramebuffer(gl.FRAMEBUFFER, to)
    gl.viewport(0, 0, W, H)
    gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    fullQuad()
    gl.disable(gl.BLEND)
  }
  const show = (withStroke = drawing) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, W, H)
    gl.useProgram(showP.p)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, paint!.tex); gl.uniform1i(showP.u('uPaint'), 0)
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, paperTex); gl.uniform1i(showP.u('uPaper'), 1)
    gl.uniform3fv(showP.u('uPaperCol'), paperCol)
    gl.uniform2f(showP.u('uRes'), W, H)
    fullQuad()
    if (withStroke) deposit(null)
  }

  // ── 筆畫 ──
  let drawing = false, last: [number, number, number] | null = null, pending: number[] = [], raf = 0
  const baseR = () => Math.max(3, Math.min(W, H) * 0.0105)
  const addSeg = (a: [number, number, number], b: [number, number, number]) => {
    const r = baseR() * (0.7 + 0.6 * (a[2] + b[2]) / 2)
    const minx = Math.min(a[0], b[0]) - r, maxx = Math.max(a[0], b[0]) + r, miny = Math.min(a[1], b[1]) - r, maxy = Math.max(a[1], b[1]) + r
    const v = (x: number, y: number) => pending.push(x, y, a[0], a[1], b[0], b[1], r)
    v(minx, miny); v(maxx, miny); v(minx, maxy); v(minx, maxy); v(maxx, miny); v(maxx, maxy)
    if (!raf) raf = requestAnimationFrame(flush)
  }
  const flush = () => {
    raf = 0
    if (!pending.length || !stroke) return
    gl.bindFramebuffer(gl.FRAMEBUFFER, stroke.fbo)
    gl.viewport(0, 0, W, H)
    gl.useProgram(segP.p)
    gl.uniform2f(segP.u('uRes'), W, H)
    gl.bindVertexArray(segVao)
    gl.bindBuffer(gl.ARRAY_BUFFER, sb)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pending), gl.DYNAMIC_DRAW)
    gl.enable(gl.BLEND); gl.blendEquation(gl.MAX)
    gl.drawArrays(gl.TRIANGLES, 0, pending.length / 7)
    gl.blendEquation(gl.FUNC_ADD); gl.disable(gl.BLEND)
    gl.bindVertexArray(null)
    pending = []
    show(true)
  }
  const pt = (e: PointerEvent, v = 0): [number, number, number] => {
    const r = canvas.getBoundingClientRect()
    const p = e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : Math.max(0.35, 0.85 - v * 0.012)
    return [(e.clientX - r.left) * W / r.width, (r.bottom - e.clientY) * H / r.height, p]
  }
  const down = (e: PointerEvent) => {
    if (e.button > 0) return
    canvas.setPointerCapture(e.pointerId)
    drawing = true
    last = pt(e)
    addSeg(last, [last[0] + 0.01, last[1], last[2]])
    e.preventDefault()
  }
  const move = (e: PointerEvent) => {
    if (!drawing || !last) return
    const evs = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e]
    for (const ev of evs.length ? evs : [e]) {
      const r = canvas.getBoundingClientRect()
      const v = Math.hypot(ev.clientX - (last[0] * r.width / W + r.left), ev.clientY - (r.bottom - last[1] * r.height / H))
      const p = pt(ev, v)
      p[2] = last[2] * 0.6 + p[2] * 0.4
      addSeg(last, p)
      last = p
    }
  }
  const up = () => {
    if (!drawing) return
    flush()
    drawing = false
    last = null
    deposit(paint!.fbo)
    gl.bindFramebuffer(gl.FRAMEBUFFER, stroke!.fbo); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT)
    show(false)
  }
  canvas.addEventListener('pointerdown', down)
  canvas.addEventListener('pointermove', move)
  canvas.addEventListener('pointerup', up)
  canvas.addEventListener('pointercancel', up)

  // ── 虛線導引（SVG 疊在畫紙上，不會存進圖片） ──
  const svgNS = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(svgNS, 'svg')
  svg.setAttribute('aria-hidden', 'true')
  Object.assign(svg.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', color: css.getPropertyValue('--trail').trim() || 'currentColor' })
  box.appendChild(svg)
  function drawGuide() {
    const w = box.clientWidth, h = box.clientHeight
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`)
    const s = Math.min(w * 0.82 / 105.7, h * 0.78 / 75), cx = w / 2 - (56 - 49.7) / 2 * s, cy = h / 2 + (33.5 - 41.5) / 2 * s
    const d = thirtyStrokes().map((pts) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${(cx + x * s).toFixed(1)} ${(cy - y * s).toFixed(1)}`).join(' ')).join(' ')
    svg.innerHTML = `<path d="${d}" fill="none" stroke="currentColor" stroke-width="${Math.max(2, s * 0.5).toFixed(1)}" stroke-linecap="round" stroke-dasharray="1 ${Math.max(8, s * 2.2).toFixed(1)}" opacity=".85"/>`
  }
  const setGuide = (on: boolean) => { svg.style.display = on ? '' : 'none' }
  setGuide(opts.guide)

  const ro = new ResizeObserver(() => resize())
  ro.observe(box)
  resize()

  let lastUrl = ''
  return {
    setColor(c) { up(); color = cssColorRGB(c) },
    setGuide,
    clear() {
      up()
      gl.bindFramebuffer(gl.FRAMEBUFFER, paint!.fbo); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT)
      show(false)
    },
    async save() {
      up()
      show(false)
      // 底下加一條紙邊印上「常春藤 30 週年」
      const foot = Math.round(H * 0.12)
      const out = document.createElement('canvas')
      out.width = W; out.height = H + foot
      const g = out.getContext('2d')!
      g.fillStyle = css.getPropertyValue('--white').trim() || '#fff'
      g.fillRect(0, 0, out.width, out.height)
      g.drawImage(canvas, 0, 0)
      g.fillStyle = css.getPropertyValue('--green').trim() || '#000'
      const font = getComputedStyle(document.body).getPropertyValue('--font-head').trim() || 'sans-serif'
      g.font = `700 ${Math.round(foot * 0.36)}px ${font}`
      g.textBaseline = 'middle'
      g.fillText('常春藤 30 週年　1997—2027', Math.round(W * 0.04), H + foot / 2)
      const blob = await new Promise<Blob | null>((res) => out.toBlob(res, 'image/png'))
      if (!blob) return ''
      if (lastUrl) URL.revokeObjectURL(lastUrl)
      lastUrl = URL.createObjectURL(blob)
      return lastUrl
    },
    destroy() {
      ro.disconnect()
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', up)
      canvas.removeEventListener('pointercancel', up)
      cancelAnimationFrame(raf)
      svg.remove()
      if (lastUrl) URL.revokeObjectURL(lastUrl)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  }
}
