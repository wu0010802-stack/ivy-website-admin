// 關於頁第一章紀念章的面圖（2026-10-03）：three.js 正面視角渲染一次，build.py 截圖轉成 WebP 給 CSS 3D 翻面用。
// 來源是比稿 C 紀念章（design/logo-3d-directions-20261003/badge-c.js，本機工作檔），這裡只留靜態渲染：
// 墨綠琺瑯外圈＋36 顆金珠＋金細環；正面米白圓心＋校徽原色，背面金色校徽剪影（偏上，下方留給 HTML 疊的校名與年份）。
// 兩層做法照舊：底層印刷面保原色，上面疊金屬嵌片（只有金色部分反光）。
import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'

const FRAME = 1.75 // canvas 邊長 ÷ 徽章邊長
const THICK = 0.15
const GOLD = '#efbc4b' // --gold
const FOREST = '#203f32' // --ivy-forest
const IVORY = '#fffdf5' // --ivy-ivory
const TAU = Math.PI * 2

const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })

// 同一張圖畫兩份：底色（琺瑯、米白、校徽原色）與金色遮罩（金屬嵌片只出現在白色處）
function paint(size, draw) {
  const out = {}
  for (const mode of ['color', 'gold']) {
    const cv = document.createElement('canvas')
    cv.width = cv.height = size
    draw(cv.getContext('2d'), mode, size)
    out[mode] = cv
  }
  return out
}

const tone = {
  enamel: { color: FOREST, gold: '#000' },
  gold: { color: '#7a5c1e', gold: '#fff' },
  ivory: { color: IVORY, gold: '#000' },
}

function beads(ctx, mode, R, count, ring, r) {
  ctx.fillStyle = tone.gold[mode]
  for (let i = 0; i < count; i++) {
    const a = (i / count) * TAU
    ctx.beginPath()
    ctx.arc(R + Math.cos(a) * ring, R + Math.sin(a) * ring, r, 0, TAU)
    ctx.fill()
  }
}

function tinted(img, color, size) {
  const cv = document.createElement('canvas')
  cv.width = cv.height = size
  const c = cv.getContext('2d')
  c.drawImage(img, 0, 0, size, size)
  c.globalCompositeOperation = 'source-in'
  c.fillStyle = color
  c.fillRect(0, 0, size, size)
  return cv
}

function ring(ctx, mode, R) {
  ctx.fillStyle = tone.enamel[mode]
  ctx.fillRect(0, 0, R * 2, R * 2)
  beads(ctx, mode, R, 36, R * 0.885, R * 0.032)
  ctx.strokeStyle = tone.gold[mode]
  ctx.lineWidth = R * 0.022
  ctx.beginPath()
  ctx.arc(R, R, R * 0.8, 0, TAU)
  ctx.stroke()
}

function front(crest) {
  return paint(1024, (ctx, mode, S) => {
    const R = S / 2
    ring(ctx, mode, R)
    ctx.fillStyle = tone.ivory[mode]
    ctx.beginPath()
    ctx.arc(R, R, R * 0.775, 0, TAU)
    ctx.fill()
    if (mode === 'color') {
      const s = R * 1.5
      ctx.drawImage(crest, R - s / 2, R - s / 2 + R * 0.02, s, s)
    }
  })
}

// 背面：校徽剪影縮成 0.5R 放在上方（0.3R 起），下方的校名／SINCE／年份由 AboutMedal.vue 的 SVG 疊上
function back(crest) {
  return paint(1024, (ctx, mode, S) => {
    const R = S / 2
    ring(ctx, mode, R)
    const s = R * 0.5
    ctx.drawImage(tinted(crest, tone.gold[mode], 1024), R - s / 2, R * 0.3, s, s)
  })
}

// 正面帶字版（2026-10-04 正反交替）：米白圓心、原色校徽縮成 0.68R 放在上方，下方留給 HTML 疊的校名與年份（墨綠字）
function label(crest) {
  return paint(1024, (ctx, mode, S) => {
    const R = S / 2
    ring(ctx, mode, R)
    ctx.fillStyle = tone.ivory[mode]
    ctx.beginPath()
    ctx.arc(R, R, R * 0.775, 0, TAU)
    ctx.fill()
    if (mode === 'color') {
      const s = R * 0.68
      ctx.drawImage(crest, R - s / 2, R * 0.2, s, s)
    }
  })
}

export async function render(host, { size, side, crestUrl }) {
  const box = Math.round(size * FRAME)
  const canvas = document.createElement('canvas')
  canvas.style.width = canvas.style.height = `${box}px`
  host.append(canvas)
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.setSize(box, box, false)
  renderer.outputColorSpace = THREE.SRGBColorSpace

  const scene = new THREE.Scene()
  const pmrem = new THREE.PMREMGenerator(renderer)
  // 不掛 scene.environment：r186 會用 scene.environmentIntensity 蓋掉材質的 envMapIntensity，印刷面就沒辦法單獨調低
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  pmrem.dispose()
  const fov = 20
  const camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 100)
  camera.position.set(0, 0, FRAME / Math.tan(THREE.MathUtils.degToRad(fov / 2)))
  const key = new THREE.DirectionalLight(0xffffff, 1.4)
  key.position.set(-2.2, 3, 4.2)
  scene.add(key)

  const texture = (cv, srgb = true) => {
    const tex = new THREE.CanvasTexture(cv)
    if (srgb) tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy()
    return tex
  }
  // 底層：琺瑯與印刷面，發光托底保原色（環境反射會把校徽洗白，所以幾乎不吃環境光）
  const faceMaterial = (maps) => {
    const map = texture(maps.color)
    return new THREE.MeshPhysicalMaterial({ map, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: 0.66, roughness: 0.55, clearcoat: 0.35, clearcoatRoughness: 0.2, envMap: env, envMapIntensity: 0.06 })
  }
  const gold = new THREE.MeshStandardMaterial({ color: GOLD, metalness: 1, roughness: 0.3, envMap: env, envMapIntensity: 1.25 })
  const inlay = (maps) => {
    const mesh = new THREE.Mesh(
      new THREE.CircleGeometry(0.99, 96),
      new THREE.MeshStandardMaterial({ color: GOLD, metalness: 1, roughness: 0.28, envMap: env, envMapIntensity: 1.25, alphaMap: texture(maps.gold, false), transparent: true, depthWrite: false }),
    )
    mesh.position.z = THICK / 2 + 0.002
    return mesh
  }

  const crest = await loadImage(crestUrl)
  const maps = side === 'back' ? back(crest) : side === 'label' ? label(crest) : front(crest)
  const body = new THREE.CylinderGeometry(1, 1, THICK, 96, 1)
  body.rotateX(Math.PI / 2) // 頂面朝 +z（面向鏡頭）
  const pos = body.attributes.position
  const nrm = body.attributes.normal
  const uvs = body.attributes.uv
  for (let i = 0; i < pos.count; i++) {
    if (Math.abs(nrm.getZ(i)) > 0.5) uvs.setXY(i, pos.getX(i) * 0.5 + 0.5, pos.getY(i) * 0.5 + 0.5)
  }
  const coin = new THREE.Group()
  coin.add(new THREE.Mesh(body, [gold, faceMaterial(maps), faceMaterial(maps)]))
  coin.add(inlay(maps))
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.965, 0.045, 14, 120), gold)
  rim.position.z = THICK / 2
  coin.add(rim)
  scene.add(coin)
  renderer.render(scene, camera)
}
