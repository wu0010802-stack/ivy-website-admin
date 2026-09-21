/**
 * 「孩子的一天」拍立得的 WebGL 紙張版（比稿 R，2026-09-18；2026-09-21 併進 Nuxt）。
 *
 * DOM 卡片（DayMomentCard.vue）照舊負責版面、鍵盤、aria、inert 與
 * `webgl-ready` class（要走 Vue 的 :class，手動 classList 會被 patch 蓋掉）；這裡只是
 * 把正反面畫成貼圖、貼到一張會彎曲、抬升、翻面的紙上，蓋在 DOM 卡片上方。
 * 和 design/day-timeline-directions/round8.js 的差異：
 *
 * - 整頁只開一個 WebGL context（共用 renderer），每張卡自己的 <canvas> 是
 *   2D 的，渲染完再 drawImage 複製過去；R 的六個 context 在低階裝置吃力。
 * - 貼圖的字型、顏色、字級、版位都從 DOM 的 computed style 與 rect 取，
 *   不寫死 hex；DOM 卡片雖然 opacity:0 但仍有版面，所以位置是真的。
 * - 減少動態、無 WebGL、three 載入失敗：回傳 null，元件維持 CSS 3D 版。
 */
import type * as ThreeNS from 'three'

type Three = typeof ThreeNS

export interface PaperCopy {
  kicker: string
  titleLines: string[]
  caption: string
  time: string
  story: string
  question: string
  answer: string
}

export interface PaperHandle {
  setFlipped(flipped: boolean): void
  setRevealed(): void
  setActive(active: boolean): void
  pointerMove(clientX: number, clientY: number): void
  pointerLeave(): void
  dispose(): void
}

const MARGIN = 70 // 四周留給彎曲與抬升
const FLIP_MS = 1100
// 手機顯影縮到 1 秒內，與 styles.css 的 .print-photo 手機 transition 對齊。
const DEVELOP_MS = 3200
const DEVELOP_MS_MOBILE = 900
const developMs = () => (window.matchMedia('(max-width: 760px)').matches ? DEVELOP_MS_MOBILE : DEVELOP_MS)
const SEGMENTS = 28

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

let threePromise: Promise<Three | null> | null = null
let shared: { renderer: ThreeNS.WebGLRenderer; three: Three; users: number } | null = null

function canUseWebGL(): boolean {
  if (typeof window === 'undefined') return false
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false
  if (!('WebGLRenderingContext' in window)) return false
  try {
    const probe = document.createElement('canvas')
    return Boolean(probe.getContext('webgl2') || probe.getContext('webgl'))
  } catch {
    return false
  }
}

function loadThree(): Promise<Three | null> {
  if (!threePromise) {
    threePromise = import('three').then(
      (mod) => mod as unknown as Three,
      () => null
    )
  }
  return threePromise
}

function acquireRenderer(three: Three) {
  if (!shared) {
    const renderer = new three.WebGLRenderer({ alpha: true, antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = three.PCFShadowMap
    shared = { renderer, three, users: 0 }
  }
  shared.users += 1
  return shared.renderer
}

function releaseRenderer() {
  if (!shared) return
  shared.users -= 1
  if (shared.users <= 0) {
    shared.renderer.dispose()
    shared = null
  }
}

// ---- 讀 DOM 樣式，讓貼圖跟 CSS 同一套 token ----

function fontOf(el: Element | null, fallback: string): string {
  if (!el) return fallback
  const cs = getComputedStyle(el)
  return `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
}

function colorOf(el: Element | null, prop: 'color' | 'backgroundColor', fallback: string): string {
  if (!el) return fallback
  const value = getComputedStyle(el)[prop]
  return value && value !== 'rgba(0, 0, 0, 0)' ? value : fallback
}

function pxOf(el: Element | null, prop: 'fontSize' | 'lineHeight', fallback: number): number {
  if (!el) return fallback
  const n = parseFloat(getComputedStyle(el)[prop])
  return Number.isFinite(n) ? n : fallback
}

function setFill(ctx: CanvasRenderingContext2D, value: string, fallback: string) {
  ctx.fillStyle = fallback
  ctx.fillStyle = value
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const out: string[] = []
  for (const raw of text.split('\n')) {
    let line = ''
    for (const ch of raw) {
      if (line && ctx.measureText(line + ch).width > max) {
        out.push(line)
        line = ch
      } else {
        line += ch
      }
    }
    out.push(line)
  }
  return out
}

interface Box {
  x: number
  y: number
  w: number
  h: number
}

function boxIn(el: Element | null, origin: DOMRect): Box | null {
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height }
}

async function waitImage(img: HTMLImageElement): Promise<HTMLImageElement> {
  if (img.complete && img.naturalWidth) return img
  await new Promise<void>((resolve) => {
    img.addEventListener('load', () => resolve(), { once: true })
    img.addEventListener('error', () => resolve(), { once: true })
  })
  return img
}

// ---- 主入口 ----

export async function mountPaper(wrap: HTMLElement, copy: PaperCopy): Promise<PaperHandle | null> {
  if (!canUseWebGL()) return null
  const loadedThree = await loadThree()
  if (!loadedThree) return null
  const three: Three = loadedThree
  if (!wrap.isConnected) return null

  const front = wrap.querySelector<HTMLElement>('.print-front')
  const back = wrap.querySelector<HTMLElement>('.print-back')
  const img = wrap.querySelector<HTMLImageElement>('.print-photo')
  if (!front || !back || !img) return null
  await waitImage(img)
  if (!wrap.isConnected || !img.naturalWidth) return null
  try {
    await document.fonts.ready
  } catch {
    /* 沒有 FontFaceSet 也照畫 */
  }

  const DPR = Math.min(window.devicePixelRatio || 1, 2)
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)')
  const renderer = acquireRenderer(three)

  // 元件狀態（由 DayMomentCard 透過 handle 餵進來）
  let flipped = false
  let revealed = false
  let active = false
  let disposed = false

  // 每次尺寸變動就整組重建（貼圖尺寸與幾何都綁著像素寬）
  let scene: ReturnType<typeof buildScene> | null = null
  let resizeFrame = 0
  let lastWidth = 0

  const view = document.createElement('canvas')
  view.className = 'paper-view'
  view.setAttribute('aria-hidden', 'true')
  wrap.append(view)
  const viewCtx = view.getContext('2d')
  if (!viewCtx) {
    view.remove()
    releaseRenderer()
    return null
  }

  function buildScene() {
    const frontRect = front!.getBoundingClientRect()
    const W = Math.round(frontRect.width)
    const H = Math.round(frontRect.height)
    if (!W || !H) return null
    const VW = W + MARGIN * 2
    const VH = H + MARGIN * 2

    view.width = VW * DPR
    view.height = VH * DPR
    view.style.width = `${VW}px`
    view.style.height = `${VH}px`
    view.style.left = `${-MARGIN}px`
    view.style.top = `${-MARGIN}px`

    // 版位與樣式全部從 DOM 取
    const figure = front!.querySelector('.print-figure')
    const figcaption = front!.querySelector('figcaption')
    const stamp = front!.querySelector('.print-stamp')
    const kickerEl = front!.querySelector('.print-kicker')
    const titleEl = front!.querySelector('h3')
    const backKicker = back!.querySelector('.print-kicker')
    const storyEl = back!.querySelector('.print-story')
    const askEl = back!.querySelector('.print-ask')
    const questionEl = back!.querySelector('.print-question')
    const answerEl = back!.querySelector('.print-answer')
    const backRect = back!.getBoundingClientRect()

    const style = {
      frontBg: colorOf(front, 'backgroundColor', '#fffdf7'),
      backBg: colorOf(back, 'backgroundColor', '#fff6df'),
      figureBg: colorOf(figure, 'backgroundColor', '#e8e2d2'),
      lineColor: 'rgb(32 64 47 / .07)',
      capFont: fontOf(figcaption, "400 9px 'PingFang TC', sans-serif"),
      capColor: colorOf(figcaption, 'color', '#fff'),
      capBg: colorOf(figcaption, 'backgroundColor', 'rgb(32 64 47 / .72)'),
      stampFont: fontOf(stamp, "400 22px 'Source Sans 3', sans-serif"),
      stampColor: colorOf(stamp, 'color', '#ffb347'),
      kickerFont: fontOf(kickerEl, "400 10px 'PingFang TC', sans-serif"),
      kickerColor: colorOf(kickerEl, 'color', '#7a8570'),
      titleFont: fontOf(titleEl, "700 22px 'LINE Seed TW', 'PingFang TC', sans-serif"),
      titleColor: colorOf(titleEl, 'color', '#203f32'),
      titleLine: pxOf(titleEl, 'lineHeight', 32),
      storyFont: fontOf(storyEl, "400 15px 'PingFang TC', sans-serif"),
      storyColor: colorOf(storyEl, 'color', '#3f5045'),
      storyLine: pxOf(storyEl, 'lineHeight', 31),
      questionFont: fontOf(questionEl, "600 13px 'PingFang TC', sans-serif"),
      questionColor: colorOf(questionEl, 'color', '#203f32'),
      questionLine: pxOf(questionEl, 'lineHeight', 22),
      answerFont: fontOf(answerEl, "400 13px 'PingFang TC', sans-serif"),
      answerColor: colorOf(answerEl, 'color', '#6e7c5b'),
      answerLine: pxOf(answerEl, 'lineHeight', 25)
    }
    const box = {
      figure: boxIn(figure, frontRect) ?? { x: W * 0.08, y: W * 0.08, w: W * 0.84, h: W * 0.84 },
      figcaption: boxIn(figcaption, frontRect),
      stamp: boxIn(stamp, frontRect),
      kicker: boxIn(kickerEl, frontRect),
      title: boxIn(titleEl, frontRect),
      backKicker: boxIn(backKicker, backRect),
      story: boxIn(storyEl, backRect),
      ask: boxIn(askEl, backRect),
      question: boxIn(questionEl, backRect),
      answer: boxIn(answerEl, backRect)
    }

    const frontCanvas = document.createElement('canvas')
    const backCanvas = document.createElement('canvas')
    frontCanvas.width = backCanvas.width = W * DPR
    frontCanvas.height = backCanvas.height = H * DPR
    const fctx = frontCanvas.getContext('2d')!
    const bctx = backCanvas.getContext('2d')!

    function drawFront(develop: number, isActive: boolean) {
      const ctx = fctx
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0)
      ctx.clearRect(0, 0, W, H)
      setFill(ctx, style.frontBg, '#fffdf7')
      ctx.fillRect(0, 0, W, H)
      const f = box.figure
      setFill(ctx, style.figureBg, '#e8e2d2')
      ctx.fillRect(f.x, f.y, f.w, f.h)
      // 照片顯影：從糊、淡、偏黃慢慢到清楚（跟 .print-photo 的 CSS 同參數）
      const cover = Math.max(f.w / img!.naturalWidth, f.h / img!.naturalHeight)
      const dw = img!.naturalWidth * cover
      const dh = img!.naturalHeight * cover
      ctx.save()
      ctx.beginPath()
      ctx.rect(f.x, f.y, f.w, f.h)
      ctx.clip()
      const d = develop
      ctx.filter =
        d >= 1
          ? 'none'
          : `sepia(${(1 - d) * 0.55}) contrast(${0.28 + 0.72 * d}) brightness(${1.55 - 0.55 * d}) saturate(${0.35 + 0.65 * d}) blur(${(1 - d) * 2.5}px)`
      ctx.globalAlpha = 0.28 + 0.72 * d
      ctx.drawImage(img!, f.x + (f.w - dw) / 2, f.y + (f.h - dh) * 0.4, dw, dh)
      ctx.filter = 'none'
      ctx.globalAlpha = 1
      if (d < 1) {
        ctx.fillStyle = `rgba(226,233,231,${(1 - d) * 0.8})`
        ctx.fillRect(f.x, f.y, f.w, f.h)
      }
      const gloss = ctx.createLinearGradient(f.x, f.y, f.x + f.w * 0.6, f.y + f.h)
      gloss.addColorStop(0, 'rgba(255,255,255,.18)')
      gloss.addColorStop(0.4, 'rgba(255,255,255,0)')
      ctx.fillStyle = gloss
      ctx.fillRect(f.x, f.y, f.w, f.h)
      // 左上角的說明籤
      const cap = box.figcaption
      if (cap && copy.caption) {
        setFill(ctx, style.capBg, 'rgba(32,64,47,.72)')
        ctx.fillRect(cap.x, cap.y, cap.w, cap.h)
        setFill(ctx, style.capColor, '#fff')
        ctx.font = style.capFont
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.fillText(copy.caption, cap.x + 8, cap.y + cap.h / 2 + 0.5)
      }
      // 橘色時間戳：顯影到六成後浮現，停在該段時再亮一階
      const stampAlpha = Math.max(0, (d - 0.6) / 0.4) * (isActive ? 1 : 0.85)
      const st = box.stamp
      if (stampAlpha > 0 && st) {
        ctx.save()
        ctx.globalAlpha = stampAlpha
        ctx.font = style.stampFont
        ctx.textAlign = 'right'
        ctx.textBaseline = 'alphabetic'
        setFill(ctx, style.stampColor, '#ffb347')
        ctx.shadowColor = 'rgba(255,138,0,.75)'
        ctx.shadowBlur = 6
        ctx.transform(1, 0, -0.105, 1, 0, 0)
        const baseline = st.y + st.h * 0.82
        ctx.fillText(copy.time, st.x + st.w + baseline * 0.105, baseline)
        ctx.restore()
      }
      ctx.restore()
      ctx.strokeStyle = 'rgba(0,0,0,.08)'
      ctx.lineWidth = 1
      ctx.strokeRect(f.x + 0.5, f.y + 0.5, f.w - 1, f.h - 1)
      // 編號小標與手寫標題
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
      const k = box.kicker
      if (k) {
        setFill(ctx, style.kickerColor, '#7a8570')
        ctx.font = style.kickerFont
        ctx.fillText(copy.kicker, k.x, k.y + k.h * 0.78)
      }
      const t = box.title
      if (t) {
        ctx.save()
        ctx.translate(t.x, t.y)
        ctx.rotate(-0.014)
        setFill(ctx, style.titleColor, '#203f32')
        ctx.font = style.titleFont
        let y = style.titleLine * 0.76
        for (const line of copy.titleLines) {
          ctx.fillText(line, 0, y)
          y += style.titleLine
        }
        ctx.restore()
      }
    }

    function drawBack() {
      const ctx = bctx
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0)
      ctx.clearRect(0, 0, W, H)
      setFill(ctx, style.backBg, '#fff6df')
      ctx.fillRect(0, 0, W, H)
      ctx.strokeStyle = style.lineColor
      ctx.lineWidth = 1
      for (let y = 31.5; y < H; y += 32) {
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(W, y)
        ctx.stroke()
      }
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
      const bk = box.backKicker
      if (bk) {
        setFill(ctx, style.kickerColor, '#6e7c5b')
        ctx.font = style.kickerFont
        ctx.fillText(copy.kicker, bk.x, bk.y + bk.h * 0.78)
      }
      const s = box.story
      if (s) {
        setFill(ctx, style.storyColor, '#3f5045')
        ctx.font = style.storyFont
        let y = s.y + style.storyLine * 0.72
        for (const line of wrapLines(ctx, copy.story, s.w)) {
          ctx.fillText(line, s.x, y)
          y += style.storyLine
        }
      }
      const a = box.ask
      if (a) {
        ctx.setLineDash([3, 4])
        ctx.strokeStyle = 'rgba(32,63,50,.25)'
        ctx.beginPath()
        ctx.moveTo(a.x, a.y + 0.5)
        ctx.lineTo(a.x + a.w, a.y + 0.5)
        ctx.stroke()
        ctx.setLineDash([])
      }
      const q = box.question
      if (q) {
        setFill(ctx, style.questionColor, '#203f32')
        ctx.font = style.questionFont
        let y = q.y + style.questionLine * 0.72
        for (const line of wrapLines(ctx, copy.question, q.w)) {
          ctx.fillText(line, q.x, y)
          y += style.questionLine
        }
      }
      const an = box.answer
      if (an) {
        setFill(ctx, style.answerColor, '#6e7c5b')
        ctx.font = style.answerFont
        let y = an.y + style.answerLine * 0.72
        for (const line of wrapLines(ctx, copy.answer, an.w)) {
          ctx.fillText(line, an.x, y)
          y += style.answerLine
        }
      }
    }

    let develop = revealed ? 1 : 0
    drawFront(develop, active)
    drawBack()
    const frontTex = new three.CanvasTexture(frontCanvas)
    const backTex = new three.CanvasTexture(backCanvas)
    frontTex.colorSpace = backTex.colorSpace = three.SRGBColorSpace
    frontTex.anisotropy = backTex.anisotropy = 4

    const sceneObj = new three.Scene()
    const fov = 24
    const dist = VH / 2 / Math.tan(three.MathUtils.degToRad(fov / 2))
    const camera = new three.PerspectiveCamera(fov, VW / VH, 10, dist * 3)
    camera.position.z = dist

    const geoF = new three.PlaneGeometry(W, H, SEGMENTS, SEGMENTS)
    const geoB = new three.PlaneGeometry(W, H, SEGMENTS, SEGMENTS)
    const matF = new three.MeshStandardMaterial({ map: frontTex, roughness: 0.62, metalness: 0 })
    const matB = new three.MeshStandardMaterial({ map: backTex, roughness: 0.8, metalness: 0 })
    const meshF = new three.Mesh(geoF, matF)
    const meshB = new three.Mesh(geoB, matB)
    meshB.rotation.y = Math.PI
    meshF.castShadow = meshB.castShadow = true
    const paper = new three.Group()
    paper.add(meshF, meshB)
    sceneObj.add(paper)
    // 後面一片地板接影子，抬起時影子變大，才讀得出高度
    const floor = new three.Mesh(new three.PlaneGeometry(VW * 2, VH * 2), new three.ShadowMaterial({ opacity: 0.28 }))
    floor.position.z = -26
    floor.receiveShadow = true
    sceneObj.add(floor)
    sceneObj.add(new three.AmbientLight(0xffffff, 1.35))
    const key = new three.DirectionalLight(0xfff4e0, 1.6)
    key.position.set(W * 0.6, H * 0.9, dist * 0.7)
    key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    key.shadow.camera.left = -VW
    key.shadow.camera.right = VW
    key.shadow.camera.top = VH
    key.shadow.camera.bottom = -VH
    key.shadow.camera.far = dist * 2
    key.shadow.radius = 6
    sceneObj.add(key)
    const glare = new three.PointLight(0xffffff, 0, dist * 1.5, 1.4)
    glare.position.z = dist * 0.35
    sceneObj.add(glare)

    const base = Float32Array.from(geoF.attributes.position!.array as ArrayLike<number>)
    const halfW = W / 2
    function bend(amount: number) {
      const pf = geoF.attributes.position!
      const pb = geoB.attributes.position!
      const af = pf.array as Float32Array
      const ab = pb.array as Float32Array
      for (let i = 0; i < pf.count; i++) {
        const x = base[i * 3]!
        const z = (amount * (x * x)) / halfW * 0.55
        af[i * 3 + 2] = z
        ab[i * 3 + 2] = -z
      }
      pf.needsUpdate = pb.needsUpdate = true
      geoF.computeVertexNormals()
      geoB.computeVertexNormals()
    }

    let flip = flipped ? 1 : 0
    let flipTarget = flip
    let flipStart = 0
    let flipFrom = 0
    let tiltX = 0
    let tiltY = 0
    let aimX = 0
    let aimY = 0
    let glareAim = 0
    let lift = 0
    let liftAim = 0
    let frame = 0
    let developStart = 0
    let dirtyFront = false

    function render() {
      frame = 0
      if (disposed) return
      const now = performance.now()
      let busy = false
      if (flip !== flipTarget) {
        const t = Math.min(1, (now - flipStart) / FLIP_MS)
        const e = ease(t)
        flip = flipFrom + (flipTarget - flipFrom) * e
        bend(Math.sin(t * Math.PI) * 0.6)
        lift = Math.sin(t * Math.PI) * 34
        if (t >= 1) {
          flip = flipTarget
          bend(0)
          lift = 0
        }
        busy = true
      }
      tiltX += (aimX - tiltX) * 0.18
      tiltY += (aimY - tiltY) * 0.18
      if (Math.abs(aimX - tiltX) > 0.0005 || Math.abs(aimY - tiltY) > 0.0005) busy = true
      glare.intensity += (glareAim - glare.intensity) * 0.15
      if (Math.abs(glareAim - glare.intensity) > 0.01) busy = true
      paper.rotation.set(tiltX, tiltY + flip * Math.PI, 0)
      paper.position.z = lift + liftAim
      if (developStart) {
        const d = Math.min(1, (now - developStart) / developMs())
        develop = ease(d)
        dirtyFront = true
        if (d >= 1) developStart = 0
        else busy = true
      }
      if (dirtyFront) {
        drawFront(develop, active)
        frontTex.needsUpdate = true
        dirtyFront = false
      }
      renderer.setSize(VW, VH, false)
      renderer.render(sceneObj, camera)
      viewCtx!.setTransform(1, 0, 0, 1, 0, 0)
      viewCtx!.clearRect(0, 0, view.width, view.height)
      viewCtx!.drawImage(renderer.domElement, 0, 0, view.width, view.height)
      if (busy) frame = requestAnimationFrame(render)
    }
    const kick = () => {
      if (!frame && !disposed) frame = requestAnimationFrame(render)
    }

    return {
      W,
      kick,
      setFlipped(next: boolean) {
        const target = next ? 1 : 0
        if (target === flipTarget) return
        flipFrom = flip
        flipTarget = target
        flipStart = performance.now()
        kick()
      },
      startDevelop() {
        if (develop >= 1 || developStart) return
        developStart = performance.now()
        kick()
      },
      redrawFront() {
        dirtyFront = true
        kick()
      },
      aim(x: number, y: number) {
        aimY = x * 0.28
        aimX = -y * 0.2
        glareAim = 3.2
        liftAim = 10
        glare.position.x = x * W * 1.2
        glare.position.y = -y * H * 1.2
        kick()
      },
      rest() {
        aimX = aimY = 0
        glareAim = 0
        liftAim = 0
        kick()
      },
      dispose() {
        cancelAnimationFrame(frame)
        frame = 0
        geoF.dispose()
        geoB.dispose()
        matF.dispose()
        matB.dispose()
        frontTex.dispose()
        backTex.dispose()
        floor.geometry.dispose()
        ;(floor.material as ThreeNS.Material).dispose()
      }
    }
  }

  function rebuild() {
    resizeFrame = 0
    if (disposed) return
    const width = front!.getBoundingClientRect().width
    if (scene && Math.abs(width - lastWidth) < 1) return
    scene?.dispose()
    scene = buildScene()
    lastWidth = width
    if (scene) {
      if (revealed) scene.startDevelop()
      scene.kick()
    }
  }

  scene = buildScene()
  if (!scene) {
    view.remove()
    releaseRenderer()
    return null
  }
  lastWidth = scene.W
  const resizer = new ResizeObserver(() => {
    if (!resizeFrame && !disposed) resizeFrame = requestAnimationFrame(rebuild)
  })
  resizer.observe(front)
  scene.kick()

  return {
    setFlipped(next) {
      flipped = next
      scene?.setFlipped(next)
    },
    setRevealed() {
      revealed = true
      scene?.startDevelop()
    },
    setActive(next) {
      if (active === next) return
      active = next
      scene?.redrawFront()
    },
    pointerMove(clientX, clientY) {
      if (!fine.matches || !scene) return
      const r = wrap.getBoundingClientRect()
      scene.aim((clientX - r.left) / r.width - 0.5, (clientY - r.top) / r.height - 0.5)
    },
    pointerLeave() {
      scene?.rest()
    },
    dispose() {
      if (disposed) return
      disposed = true
      cancelAnimationFrame(resizeFrame)
      resizer.disconnect()
      scene?.dispose()
      scene = null
      view.remove()
      releaseRenderer()
    }
  }
}
