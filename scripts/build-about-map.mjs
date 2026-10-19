#!/usr/bin/env node
// 關於頁手機版第一章「一頁一校」的高雄立體地圖：每一區切成一張紙（封閉多邊形），翻到哪一校、那一區浮起來上色。
// 產出 web/app/generated/about-map.ts（不要手改）；執行時不載任何地圖套件。
//
//   node scripts/build-about-map.mjs           # 用 output/anniversary-map-src/ 的快取（同 30 週年地圖）
//   node scripts/build-about-map.mjs --fetch   # 重新下載區界再產生
//
// 來源（頁面上要標註，同 30 週年地圖那行小字）：
// - 鄉鎮市區界線：內政部國土測繪中心（政府資料開放授權條款），taiwan-atlas@2021.9.20 的 towns-10t.json。
// - 投影、地圖框、五校座標、湖泊與愛河：直接讀 web/app/utils/anniversary/map-data.ts（scripts/build-anniversary-map.mjs 產生，
//   湖泊與河流 © OpenStreetMap 貢獻者），兩張地圖的座標系一樣，五校位置不必再比對一次。
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = resolve(ROOT, 'output/anniversary-map-src')
const ANNI = resolve(ROOT, 'web/app/utils/anniversary/map-data.ts')
const OUT = resolve(ROOT, 'web/app/generated/about-map.ts')
const TOWNS_URL = 'https://cdn.jsdelivr.net/npm/taiwan-atlas@2021.9.20/towns-10t.json'
const TOWNS_SHA256 = '250f63cdef76679b67d2a34633a69355c8f1180ae6b55407e6c87789940feab0'

// 投影同 build-anniversary-map.mjs（地圖框 1000 寬）
const LON0 = 120.284, LON1 = 120.368, LAT0 = 22.630, LAT1 = 22.699
const W = 1000
const KX = Math.cos(((LAT0 + LAT1) / 2) * Math.PI / 180)
const S = W / ((LON1 - LON0) * KX)
const H = Math.round((LAT1 - LAT0) * S)
const proj = ([lon, lat]) => [(lon - LON0) * KX * S, (LAT1 - lat) * S]

// 手機只看五校附近：x 120–900、y 120–800（五校、澄清湖、金獅湖都在框內，蓮池潭露一半）
const VIEW = [120, 120, 780, 680]
const PAD = 30
// 區名位置：避開五校小房子與校名（座標同地圖）。框裡看不到的區不標
// 鳳山區不標：右下角放資料來源小字
const LABELS = { 左營區: [345, 222], 鼓山區: [182, 548], 三民區: [440, 650], 鳥松區: [712, 372], 仁武區: [842, 266] }

function decodeTopo(topo) {
  const { scale, translate } = topo.transform
  return topo.arcs.map((arc) => {
    let x = 0, y = 0
    return arc.map(([dx, dy]) => { x += dx; y += dy; return [x * scale[0] + translate[0], y * scale[1] + translate[1]] })
  })
}
const area = (p) => p.reduce((s, q, i) => { const r = p[(i + 1) % p.length]; return s + q[0] * r[1] - r[0] * q[1] }, 0) / 2
// Sutherland–Hodgman：切到地圖框（外擴 PAD）
function clip(poly) {
  const [x0, y0] = [VIEW[0] - PAD, VIEW[1] - PAD], [x1, y1] = [VIEW[0] + VIEW[2] + PAD, VIEW[1] + VIEW[3] + PAD]
  const edges = [
    [(p) => p[0] >= x0, (a, b) => [x0, a[1] + (b[1] - a[1]) * (x0 - a[0]) / (b[0] - a[0])]],
    [(p) => p[0] <= x1, (a, b) => [x1, a[1] + (b[1] - a[1]) * (x1 - a[0]) / (b[0] - a[0])]],
    [(p) => p[1] >= y0, (a, b) => [a[0] + (b[0] - a[0]) * (y0 - a[1]) / (b[1] - a[1]), y0]],
    [(p) => p[1] <= y1, (a, b) => [a[0] + (b[0] - a[0]) * (y1 - a[1]) / (b[1] - a[1]), y1]]
  ]
  for (const [inside, cut] of edges) {
    if (!poly.length) break
    const out = []
    poly.forEach((cur, i) => {
      const prev = poly[(i + poly.length - 1) % poly.length]
      if (inside(cur)) { if (!inside(prev)) out.push(cut(prev, cur)); out.push(cur) } else if (inside(prev)) out.push(cut(prev, cur))
    })
    poly = out
  }
  return poly
}
function simplify(pts, tol) {
  if (pts.length < 3) return pts
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1
  const stack = [[0, pts.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()
    const [ax, ay] = pts[a], [bx, by] = pts[b], L = Math.hypot(bx - ax, by - ay) || 1e-9
    let md = 0, mi = -1
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / L
      if (d > md) { md = d; mi = i }
    }
    if (md > tol) { keep[mi] = 1; stack.push([a, mi], [mi, b]) }
  }
  return pts.filter((_, i) => keep[i])
}
// 封閉環頭尾是同一點，直接簡化會整圈消失：從離起點最遠的點切成兩段各自簡化
function simplifyRing(ring, tol) {
  let far = 0
  ring.forEach((p, i) => { if (Math.hypot(p[0] - ring[0][0], p[1] - ring[0][1]) > Math.hypot(ring[far][0] - ring[0][0], ring[far][1] - ring[0][1])) far = i })
  return [...simplify(ring.slice(0, far + 1), tol).slice(0, -1), ...simplify([...ring.slice(far), ring[0]], tol).slice(0, -1)]
}
const ringD = (r) => `M${r.map(([x, y]) => `${Math.round(x)} ${Math.round(y)}`).join('L')}Z`

async function fetchTowns() {
  mkdirSync(SRC, { recursive: true })
  const res = await fetch(TOWNS_URL)
  if (!res.ok) throw new Error(`towns-10t.json ${res.status}`)
  writeFileSync(resolve(SRC, 'towns-10t.json'), Buffer.from(await res.arrayBuffer()))
}

async function main() {
  if (process.argv.includes('--fetch') || !existsSync(resolve(SRC, 'towns-10t.json'))) await fetchTowns()
  const raw = readFileSync(resolve(SRC, 'towns-10t.json'))
  const sha = createHash('sha256').update(raw).digest('hex')
  if (sha !== TOWNS_SHA256) throw new Error(`towns-10t.json sha256 不符：${sha}`)
  const topo = JSON.parse(raw.toString('utf8'))
  const arcs = decodeTopo(topo).map((a) => a.map(proj))
  const anniSrc = readFileSync(ANNI, 'utf8')
  const anni = JSON.parse(anniSrc.slice(anniSrc.indexOf('= {') + 2))

  const districts = []
  for (const g of topo.objects.towns.geometries.filter((g) => g.properties.COUNTYNAME === '高雄市')) {
    const polys = g.type === 'Polygon' ? [g.arcs] : g.arcs
    const rings = polys.map((poly) => clip(poly[0].flatMap((ai, k) => { const pts = ai >= 0 ? arcs[ai] : arcs[~ai].slice().reverse(); return k ? pts.slice(1) : pts })))
      .filter((r) => r.length > 2 && Math.abs(area(r)) > 300)
      .map((r) => simplifyRing(r, 1.6))
    if (!rings.length) continue
    const name = g.properties.TOWNNAME
    districts.push({ name, d: rings.map(ringD).join(''), label: LABELS[name] ?? null })
  }
  const data = {
    view: VIEW,
    districts,
    lakes: anni.water.map((w) => ({ name: w.name, d: w.shape, label: w.label })),
    river: anni.river,
    campuses: anni.campuses
  }
  const ts = `// 由 scripts/build-about-map.mjs 產生，不要手改。
// 區界：內政部國土測繪中心鄉鎮市區界線（政府資料開放授權條款，taiwan-atlas@2021.9.20 towns-10t.json，sha256 ${sha.slice(0, 16)}…）。
// 投影、五校座標、湖泊與愛河同 utils/anniversary/map-data.ts（湖泊、河流 © OpenStreetMap 貢獻者，ODbL）。
export interface AboutMapDistrict { name: string; d: string; label: [number, number] | null }
export interface AboutMapData {
  view: [number, number, number, number]
  districts: AboutMapDistrict[]
  lakes: Array<{ name: string; d: string; label: [number, number] }>
  river: string
  campuses: Record<string, [number, number]>
}
export const ABOUT_MAP: AboutMapData = ${JSON.stringify(data)}
`
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, ts)
  console.log(`about-map.ts ${(ts.length / 1024).toFixed(1)} KB；${districts.length} 區（${districts.map((d) => d.name).join('、')}）；地圖框 ${W}×${H}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
