// 30 週年分頁：五張立體書卡片與校徽「印上去」的算圖。
// 共用一個離屏 WebGL2：每次畫到自己的大小，再 drawImage 到各自的 2D canvas，
// 不必每張卡片開一個 WebGL context。卡片與校徽的時間場由 scripts/build-anniversary-media.py 產生
// （R＝鉛筆描到的時間、G＝水彩暈到的時間、B＝模切形狀；校徽 R＝出現時間、G＝不透明度、B＝孩子）。

const VS = `#version 300 es
in vec2 aP; out vec2 vUV;
void main(){ vUV = vec2(aP.x, 1.0 - aP.y); gl_Position = vec4(aP * 2.0 - 1.0, 0.0, 1.0); }`

const HEAD = `#version 300 es
precision highp float;
float sstep(float a, float b, float x){ float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
in vec2 vUV; out vec4 o;
uniform sampler2D uPaper; uniform vec2 uPx; uniform vec3 uPaperCol;
float grain(){ return texture(uPaper, gl_FragCoord.xy / 300.0).r; }
`

const CARD_FS = HEAD + `
uniform sampler2D uLines, uFields, uColour; uniform float uDraw, uWash;
void main(){
  vec3 F = texture(uFields, vUV).rgb;
  float a = F.b;
  if (a < 0.003) { o = vec4(0.0); return; }
  float g = grain();
  vec3 alb = uPaperCol * (0.93 + 0.07 * g);
  // 水彩：前緣顏料堆積、紙紋凹處沉澱
  float wt = F.g, wf = uWash * 1.08;
  float wet = sstep(wt - 0.05, wt, wf);
  float ring = sstep(wt - 0.06, wt - 0.012, wf) * (1.0 - sstep(wt - 0.012, wt, wf));
  vec3 col = texture(uColour, vUV).rgb;
  vec3 pig = clamp((col - 0.08) / 0.86, 0.0, 1.0);
  float pl = dot(pig, vec3(0.299, 0.587, 0.114));
  pig = clamp(mix(vec3(pl), pig, 1.22), 0.0, 1.0);
  pig = pow(pig, vec3(1.18));
  float gran = 0.9 + 0.2 * sstep(0.85, 1.0, g);
  alb *= mix(vec3(1.0), pig, clamp(wet * gran, 0.0, 1.0));
  alb *= mix(vec3(1.0), pig * pig, ring * 0.4 * wet);
  // 鉛筆：沿測地時間描出（從地面往上長）
  float lum = dot(texture(uLines, vUV).rgb, vec3(0.299, 0.587, 0.114));
  float ln = pow(clamp((0.969 - lum) / 0.282, 0.0, 1.0), 0.8);
  float drawn = sstep(F.r - 0.015, F.r, uDraw);
  alb *= 1.0 - clamp(ln * 1.2, 0.0, 1.0) * drawn * 0.86 * mix(0.75, 1.0, g);
  // 模切邊：紙的厚度
  alb *= 1.0 - 0.32 * sstep(0.97, 0.55, a);
  o = vec4(alb * a, a);
}`

const CREST_FS = HEAD + `
uniform sampler2D uCrest, uCrestF; uniform float uT;
void main(){
  vec3 F = texture(uCrestF, vUV).rgb;
  float a = F.g;
  if (a < 0.003) { o = vec4(0.0); return; }
  float t = F.r;
  float n = hash(floor(vUV * 160.0)) * 0.02 + hash(floor(vUV * 40.0)) * 0.04;
  float show = sstep(t, t + 0.05, uT + n - 0.03);
  if (show <= 0.0) { o = vec4(0.0); return; }
  vec3 c = texture(uCrest, vUV).rgb;
  // 油墨：紙紋凹處吃墨少一點
  float g = grain();
  c = mix(c, c * uPaperCol, 0.18) * mix(0.9, 1.0, g);
  float aa = a * show;
  o = vec4(c * aa, aa);
}`

interface Prog { p: WebGLProgram; u: Record<string, WebGLUniformLocation | null> }

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const im = new Image()
    im.decoding = 'async'
    im.onload = () => res(im)
    im.onerror = () => rej(new Error(`載入失敗：${src}`))
    im.src = src
  })
}

/** 任何 CSS 顏色轉成 0–1 的 RGB；含 var(--token) 的先交給瀏覽器算出實際顏色 */
export function cssColorRGB(css: string): [number, number, number] {
  if (css.includes('var(')) {
    const probe = document.createElement('span')
    probe.style.color = css
    probe.hidden = true
    document.body.appendChild(probe)
    css = getComputedStyle(probe).color
    probe.remove()
  }
  const c = document.createElement('canvas')
  c.width = c.height = 1
  const g = c.getContext('2d', { willReadFrequently: true })!
  g.fillStyle = css
  g.fillRect(0, 0, 1, 1)
  const d = g.getImageData(0, 0, 1, 1).data
  return [d[0]! / 255, d[1]! / 255, d[2]! / 255]
}

export interface CardTextures { lines: WebGLTexture; fields: WebGLTexture; colour: WebGLTexture; aspect: number }
export interface CrestTextures { crest: WebGLTexture; fields: WebGLTexture }

export class PaperGL {
  readonly canvas: HTMLCanvasElement
  private gl: WebGL2RenderingContext
  private card: Prog
  private crestProg: Prog
  private paper: WebGLTexture | null = null
  private paperCol: [number, number, number]

  static create(paperColor: string): PaperGL | null {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false, preserveDrawingBuffer: true })
    if (!gl) return null
    try { return new PaperGL(canvas, gl, paperColor) } catch (e) { console.error(e); return null }
  }

  private constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext, paperColor: string) {
    this.canvas = canvas
    this.gl = gl
    this.paperCol = cssColorRGB(paperColor)
    this.card = this.program(CARD_FS, ['uLines', 'uFields', 'uColour', 'uPaper', 'uDraw', 'uWash', 'uPx', 'uPaperCol'])
    this.crestProg = this.program(CREST_FS, ['uCrest', 'uCrestF', 'uPaper', 'uT', 'uPx', 'uPaperCol'])
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  }

  private program(fs: string, names: string[]): Prog {
    const gl = this.gl
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader')
      return s
    }
    const p = gl.createProgram()!
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS))
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs))
    gl.bindAttribLocation(p, 0, 'aP')
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link')
    return { p, u: Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(p, n)])) }
  }

  private texture(src: TexImageSource, repeat = false): WebGLTexture {
    const gl = this.gl
    const t = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src)
    gl.generateMipmap(gl.TEXTURE_2D)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap)
    return t
  }

  async loadPaper(src: string) {
    this.paper = this.texture(await loadImage(src), true)
  }

  async loadCard(lines: string, colour: string, fields: string): Promise<CardTextures> {
    const [l, c, f] = await Promise.all([loadImage(lines), loadImage(colour), loadImage(fields)])
    return { lines: this.texture(l), colour: this.texture(c), fields: this.texture(f), aspect: l.naturalWidth / l.naturalHeight }
  }

  async loadCrest(crest: string, fields: string): Promise<CrestTextures> {
    const [c, f] = await Promise.all([loadImage(crest), loadImage(fields)])
    return { crest: this.texture(c), fields: this.texture(f) }
  }

  private begin(target: HTMLCanvasElement, prog: Prog) {
    const gl = this.gl
    const w = target.width, h = target.height
    if (this.canvas.width < w || this.canvas.height < h) {
      this.canvas.width = Math.max(this.canvas.width, w)
      this.canvas.height = Math.max(this.canvas.height, h)
    }
    gl.viewport(0, 0, w, h)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.useProgram(prog.p)
    gl.uniform2f(prog.u.uPx!, 1 / w, 1 / h)
    gl.uniform3fv(prog.u.uPaperCol!, this.paperCol)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.paper)
    gl.uniform1i(prog.u.uPaper!, 0)
  }

  private end(target: HTMLCanvasElement) {
    const gl = this.gl
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    const g = target.getContext('2d')!
    g.clearRect(0, 0, target.width, target.height)
    // WebGL 的原點在左下：畫在離屏 canvas 底部那一塊
    g.drawImage(this.canvas, 0, this.canvas.height - target.height, target.width, target.height, 0, 0, target.width, target.height)
  }

  drawCard(tx: CardTextures, target: HTMLCanvasElement, draw: number, wash: number) {
    const gl = this.gl, u = this.card.u
    this.begin(target, this.card)
    const bind = (unit: number, t: WebGLTexture, name: string) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(u[name]!, unit) }
    bind(1, tx.lines, 'uLines'); bind(2, tx.fields, 'uFields'); bind(3, tx.colour, 'uColour')
    gl.uniform1f(u.uDraw!, draw)
    gl.uniform1f(u.uWash!, wash)
    this.end(target)
  }

  drawCrest(tx: CrestTextures, target: HTMLCanvasElement, t: number) {
    const gl = this.gl, u = this.crestProg.u
    this.begin(target, this.crestProg)
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tx.crest); gl.uniform1i(u.uCrest!, 1)
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, tx.fields); gl.uniform1i(u.uCrestF!, 2)
    gl.uniform1f(u.uT!, t)
    this.end(target)
  }

  destroy() {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
}

export { loadImage }
