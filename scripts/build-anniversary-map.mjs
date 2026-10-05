#!/usr/bin/env node
// 30 週年分頁「孩子畫的高雄地圖」：把真實的區界、湖泊、河流與五校位置，做成像孩子用蠟筆畫的 SVG 路徑。
// 產出 web/app/utils/anniversary/map-data.ts（不要手改）；執行時不載任何地圖套件。
//
//   node scripts/build-anniversary-map.mjs           # 用 output/anniversary-map-src/ 的快取
//   node scripts/build-anniversary-map.mjs --fetch   # 重新下載來源再產生
//
// 來源（頁面上要標註）：
// - 鄉鎮市區界線：內政部國土測繪中心（政府資料開放授權條款），取自 taiwan-atlas@2021.9.20 的 towns-10t.json。
// - 湖泊、河流、地標位置：© OpenStreetMap 貢獻者（ODbL），Overpass API，2026-10-04 查詢。
// - 五校座標：ArcGIS World Geocoder 以門牌比對（2026-10-04；義華、明華、崇德、仁武 score 100，
//   國際校 97.88，比對到「林內球場路 59 號」、郵遞區號 833 鳥松），並與 OSM Nominatim 的路段位置交叉檢查。
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = resolve(ROOT, 'output/anniversary-map-src')
const OUT = resolve(ROOT, 'web/app/utils/anniversary/map-data.ts')

const TOWNS_URL = 'https://cdn.jsdelivr.net/npm/taiwan-atlas@2021.9.20/towns-10t.json'
const TOWNS_SHA256 = '250f63cdef76679b67d2a34633a69355c8f1180ae6b55407e6c87789940feab0'
const OVERPASS = 'https://overpass-api.de/api/interpreter'
const OSM_QUERY = '[out:json][timeout:60];(relation(2999045);relation(3886701);way(28274624);way["waterway"="river"]["name"="愛河"](22.62,120.27,22.71,120.39);relation(5663918);node(3933501988););out geom;'

// 地圖框：經緯度範圍（含蓮池潭、澄清湖、高鐵左營站）
const LON0 = 120.284, LON1 = 120.368, LAT0 = 22.630, LAT1 = 22.699
const W = 1000

export const CAMPUS_GEO = {
  yihua: { lat: 22.642413, lon: 120.343731 },
  minghua: { lat: 22.66317, lon: 120.306236 },
  chongde: { lat: 22.673643, lon: 120.307132 },
  international: { lat: 22.655984, lon: 120.336284 },
  renwu: { lat: 22.682728, lon: 120.342961 },
}
const CAMPUS_ORDER = ['yihua', 'minghua', 'chongde', 'international', 'renwu']
// 有校園的區：成立第一所時塗上顏色
const CAMPUS_DISTRICTS = { 三民區: 'yihua', 左營區: 'minghua', 鳥松區: 'international', 仁武區: 'renwu' }

// ── 投影 ──
const KX = Math.cos(((LAT0 + LAT1) / 2) * Math.PI / 180)
const S = W / ((LON1 - LON0) * KX)
const H = Math.round((LAT1 - LAT0) * S)
const proj = ([lon, lat]) => [(lon - LON0) * KX * S, (LAT1 - lat) * S]

// ── 小工具 ──
function mulberry(seed) {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])
const polyLen = (pts) => pts.reduce((s, p, i) => (i ? s + dist(pts[i - 1], p) : 0), 0)

function simplify(pts, tol) {
  if (pts.length < 3) return pts
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1
  const stack = [[0, pts.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()
    let md = 0, mi = -1
    const [ax, ay] = pts[a], [bx, by] = pts[b], L = Math.hypot(bx - ax, by - ay) || 1e-9
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / L
      if (d > md) { md = d; mi = i }
    }
    if (md > tol) { keep[mi] = 1; stack.push([a, mi], [mi, b]) }
  }
  return pts.filter((_, i) => keep[i])
}

/** 等距取樣；keep=true 時保留原本的轉折點（鋸齒塗色的轉角不能被抹圓） */
function resample(pts, step, keep = false) {
  if (keep) {
    const out = [pts[0]]
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], n = Math.max(1, Math.ceil(dist(a, b) / step))
      for (let k = 1; k <= n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n])
    }
    return out
  }
  const out = [pts[0]]
  let carry = 0
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], L = dist(a, b)
    let t = step - carry
    while (t < L) { out.push([a[0] + (b[0] - a[0]) * t / L, a[1] + (b[1] - a[1]) * t / L]); t += step }
    carry = L - (t - step)
  }
  const last = pts[pts.length - 1]
  if (dist(out[out.length - 1], last) > step * 0.3) out.push(last)
  return out
}

/** 手抖：沿法線方向加低頻擾動（幾個不同週期的正弦），頭尾不動 */
function wobble(pts, seed, amp, step = 12, keep = false) {
  const r = mulberry(seed)
  const ph = [r() * 6.28, r() * 6.28, r() * 6.28]
  const rs = resample(pts, step, keep)
  const n = rs.length
  let s = 0
  return rs.map((p, i) => {
    if (i) s += dist(rs[i - 1], p)
    const a = rs[Math.max(0, i - 1)], b = rs[Math.min(n - 1, i + 1)]
    let nx = -(b[1] - a[1]), ny = b[0] - a[0]
    const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l
    const k = amp * (0.6 * Math.sin(s / 90 + ph[0]) + 0.3 * Math.sin(s / 37 + ph[1]) + 0.15 * Math.sin(s / 13 + ph[2]))
    const edge = Math.min(1, i / 3, (n - 1 - i) / 3)
    return [p[0] + nx * k * edge, p[1] + ny * k * edge]
  })
}

/** 整數座標＋相對座標（1000 寬的畫布，四捨五入誤差不到 0.5px），重複的點略過 */
function pathD(pts, close = false) {
  const r = pts.map(([x, y]) => [Math.round(x), Math.round(y)])
  let d = `M${r[0][0]} ${r[0][1]}`, px = r[0][0], py = r[0][1], first = true
  for (let i = 1; i < r.length; i++) {
    const dx = r[i][0] - px, dy = r[i][1] - py
    if (!dx && !dy) continue
    d += (first ? 'l' : dx < 0 ? '' : ' ') + dx + (dy < 0 ? '' : ' ') + dy
    first = false; px = r[i][0]; py = r[i][1]
  }
  return d + (close ? 'z' : '')
}
/** 封閉環：從中間切兩半各自簡化，避免首尾同點讓 Douglas–Peucker 只剩兩點 */
function simplifyRing(ring, tol) {
  const open = dist(ring[0], ring[ring.length - 1]) < 1e-9 ? ring.slice(0, -1) : ring
  const m = Math.floor(open.length / 2)
  return [...simplify(open.slice(0, m + 1), tol), ...simplify([...open.slice(m), open[0]], tol).slice(1, -1)]
}

/** 線段裁到地圖框裡（Liang–Barsky），一條折線可能被切成好幾段 */
function clipPolyline(pts, pad = 0) {
  const x0 = -pad, y0 = -pad, x1 = W + pad, y1 = H + pad
  const out = []
  let cur = []
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i]
    let t0 = 0, t1 = 1
    const dx = bx - ax, dy = by - ay
    const ok = [[-dx, ax - x0], [dx, x1 - ax], [-dy, ay - y0], [dy, y1 - ay]].every(([p, q]) => {
      if (p === 0) return q >= 0
      const t = q / p
      if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t } else { if (t < t0) return false; if (t < t1) t1 = t }
      return true
    })
    if (!ok) { if (cur.length > 1) out.push(cur); cur = []; continue }
    const A = [ax + dx * t0, ay + dy * t0], B = [ax + dx * t1, ay + dy * t1]
    if (!cur.length || dist(cur[cur.length - 1], A) > 1e-6) { if (cur.length > 1) out.push(cur); cur = [A] }
    cur.push(B)
    if (t1 < 1) { out.push(cur); cur = [] }
  }
  if (cur.length > 1) out.push(cur)
  return out
}

/** 多邊形裁到地圖框（Sutherland–Hodgman） */
function clipPolygon(ring) {
  const edges = [
    (p) => p[0] >= 0, (p) => p[0] <= W, (p) => p[1] >= 0, (p) => p[1] <= H
  ]
  const inter = (a, b, k) => {
    const [ax, ay] = a, [bx, by] = b
    const t = k === 0 ? (0 - ax) / (bx - ax) : k === 1 ? (W - ax) / (bx - ax) : k === 2 ? (0 - ay) / (by - ay) : (H - ay) / (by - ay)
    return [ax + (bx - ax) * t, ay + (by - ay) * t]
  }
  let poly = ring
  edges.forEach((inside, k) => {
    const res = []
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length]
      if (inside(b)) { if (!inside(a)) res.push(inter(a, b, k)); res.push(b) } else if (inside(a)) res.push(inter(a, b, k))
    }
    poly = res
  })
  return poly
}

function area(ring) { let s = 0; for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; s += a[0] * b[1] - b[0] * a[1] } return s / 2 }

/** 掃描線：水平線 y 與多邊形的交點 x（偶數個） */
function scanX(rings, y) {
  const xs = []
  for (const ring of rings) for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length]
    if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) xs.push(a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0]))
  }
  return xs.sort((p, q) => p - q)
}

/**
 * 孩子塗色：斜的來回鋸齒線。先把多邊形轉到斜線方向，掃描線取每一段，
 * 一段一段來回接起來；太短的段落略過。回傳多條折線（一筆塗不完會斷開）。
 */
function scribble(rings, { angle = -28, gap = 14, inset = 4, seed = 1 } = {}) {
  const r = mulberry(seed)
  const a = angle * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a)
  const rot = ([x, y]) => [x * ca + y * sa, -x * sa + y * ca]
  const unrot = ([x, y]) => [x * ca - y * sa, x * sa + y * ca]
  const rr = rings.map((g) => g.map(rot))
  const ys = rr.flat().map((p) => p[1])
  const ymin = Math.min(...ys), ymax = Math.max(...ys)
  const strokes = []
  let cur = null, lastY = null, dir = 1
  for (let y = ymin + gap * 0.6; y < ymax; y += gap * (0.85 + r() * 0.3)) {
    const xs = scanX(rr, y)
    const segs = []
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const a0 = inset + (r() - 0.35) * inset * 1.6, a1 = inset + (r() - 0.35) * inset * 1.6
      if (xs[i + 1] - xs[i] > a0 + a1 + 6) segs.push([xs[i] + a0, xs[i + 1] - a1])
    }
    if (!segs.length) { if (cur) strokes.push(cur); cur = null; continue }
    // 最寬的那段接續鋸齒，其他段另起一筆
    segs.sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]))
    const [x0, x1] = segs[0]
    const j = () => (r() - 0.5) * 6
    const pts = dir > 0 ? [[x0 + j(), y], [x1 + j(), y]] : [[x1 + j(), y], [x0 + j(), y]]
    if (cur && lastY !== null && y - lastY < gap * 2) cur.push(pts[0], pts[1])
    else { if (cur) strokes.push(cur); cur = [pts[0], pts[1]] }
    for (const s of segs.slice(1)) strokes.push([[s[0], y], [s[1], y]])
    lastY = y; dir = -dir
  }
  if (cur) strokes.push(cur)
  return strokes.map((s) => s.map(unrot))
}

// ── 來源 ──
async function fetchSources() {
  mkdirSync(SRC, { recursive: true })
  const towns = await (await fetch(TOWNS_URL)).text()
  writeFileSync(resolve(SRC, 'towns-10t.json'), towns)
  const res = await fetch(OVERPASS, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'ivy-website-build/1.0' }, body: `data=${encodeURIComponent(OSM_QUERY)}` })
  if (!res.ok) throw new Error(`Overpass ${res.status}`)
  writeFileSync(resolve(SRC, 'osm.json'), await res.text())
}

function decodeTopo(topo) {
  const [sx, sy] = topo.transform.scale, [tx, ty] = topo.transform.translate
  return topo.arcs.map((arc) => { let x = 0, y = 0; return arc.map(([dx, dy]) => { x += dx; y += dy; return [x * sx + tx, y * sy + ty] }) })
}

/** OSM 關聯的外圈：把成員 way 首尾相接成封閉環 */
function joinWays(ways) {
  const pool = ways.map((w) => w.slice())
  const rings = []
  while (pool.length) {
    let ring = pool.shift()
    let grown = true
    while (grown && dist(ring[0], ring[ring.length - 1]) > 1e-9) {
      grown = false
      for (let i = 0; i < pool.length; i++) {
        const w = pool[i], end = ring[ring.length - 1]
        if (dist(w[0], end) < 1e-9) { ring = ring.concat(w.slice(1)) } else if (dist(w[w.length - 1], end) < 1e-9) { ring = ring.concat(w.slice().reverse().slice(1)) } else continue
        pool.splice(i, 1); grown = true; break
      }
    }
    rings.push(ring)
  }
  return rings
}

async function main() {
  if (process.argv.includes('--fetch') || !existsSync(resolve(SRC, 'towns-10t.json'))) await fetchSources()
  const townsRaw = readFileSync(resolve(SRC, 'towns-10t.json'))
  const sha = createHash('sha256').update(townsRaw).digest('hex')
  if (TOWNS_SHA256 && sha !== TOWNS_SHA256) throw new Error(`towns-10t.json sha256 不符：${sha}`)
  const topo = JSON.parse(townsRaw.toString('utf8'))
  const osm = JSON.parse(readFileSync(resolve(SRC, 'osm.json'), 'utf8'))
  const arcs = decodeTopo(topo).map((a) => a.map(proj))

  // ── 區界：每條 arc 只畫一次 ──
  const geoms = topo.objects.towns.geometries.filter((g) => g.properties.COUNTYNAME === '高雄市')
  const used = new Set()
  const ringsOf = (g) => {
    const polys = g.type === 'Polygon' ? [g.arcs] : g.arcs
    return polys.map((poly) => poly.map((ringArcs) => ringArcs.flatMap((ai, k) => {
      const pts = ai >= 0 ? arcs[ai] : arcs[~ai].slice().reverse()
      return k ? pts.slice(1) : pts
    })))
  }
  const districts = []
  for (const g of geoms) {
    const outer = ringsOf(g).map((p) => p[0])
    const clipped = outer.map(clipPolygon).filter((r) => r.length > 2 && Math.abs(area(r)) > 50)
    if (!clipped.length) continue
    const polys = g.type === 'Polygon' ? [g.arcs] : g.arcs
    for (const poly of polys) for (const ring of poly) for (const ai of ring) used.add(ai < 0 ? ~ai : ai)
    // 標籤位置：最大那塊的質心，之後在 LABEL_NUDGE 微調
    const big = clipped.sort((p, q) => Math.abs(area(q)) - Math.abs(area(p)))[0]
    let cx = 0, cy = 0, A = 0
    for (let i = 0; i < big.length; i++) { const a = big[i], b = big[(i + 1) % big.length], c = a[0] * b[1] - b[0] * a[1]; A += c; cx += (a[0] + b[0]) * c; cy += (a[1] + b[1]) * c }
    districts.push({ name: g.properties.TOWNNAME, rings: clipped, label: [cx / (3 * A), cy / (3 * A)], area: Math.abs(area(big)) })
  }
  const borderPieces = [...used].flatMap((ai) => clipPolyline(simplify(arcs[ai], 1.6), 2)).filter((p) => polyLen(p) > 8)
  const border = borderPieces.map((p, i) => pathD(wobble(p, 101 + i, 2.2, 14))).join('') + borderPieces.map((p, i) => pathD(wobble(p, 701 + i, 1.6, 18).map(([x, y]) => [x + 1, y + 1]))).join('')

  // ── 水：湖泊外框兩次＋鋸齒塗色；愛河一條線 ──
  const elems = osm.elements
  const lakeOf = (el) => {
    if (el.type === 'way') return [el.geometry.map((p) => proj([p.lon, p.lat]))]
    const outers = el.members.filter((m) => m.type === 'way' && m.role !== 'inner').map((m) => m.geometry.map((p) => [p.lon, p.lat]))
    return joinWays(outers).map((r) => r.map(proj))
  }
  // 湖名放在湖的旁邊或下面，不壓在塗色上
  const LAKE_LABEL = { 蓮池潭: [0, 78], 澄清湖: [47, 50], 金獅湖: [0, -42] }
  const LAKES = [['蓮池潭', 'relation', 2999045], ['澄清湖', 'relation', 3886701], ['金獅湖', 'way', 28274624]]
  const water = LAKES.map(([name, type, id], li) => {
    const el = elems.find((e) => e.type === type && e.id === id)
    if (!el) throw new Error(`找不到 ${name}`)
    const rings = lakeOf(el).map((r) => simplifyRing(r, 1.2)).filter((r) => r.length > 3)
    const outline = rings.map((r, i) => pathD(wobble([...r, r[0]], 300 + li * 10 + i, 1.4, 8), true)).join('')
      + rings.map((r, i) => pathD(wobble([...r, r[0]], 900 + li * 10 + i, 1.1, 9).map(([x, y]) => [x + 0.8, y - 0.5]), true)).join('')
    const fill = scribble(rings, { angle: 24, gap: 7, inset: 2.5, seed: 40 + li }).map((s) => pathD(wobble(s, 500 + li, 1, 30, true))).join('')
    const all = rings.flat()
    const box = [Math.min(...all.map((p) => p[0])), Math.min(...all.map((p) => p[1])), Math.max(...all.map((p) => p[0])), Math.max(...all.map((p) => p[1]))]
    const shape = rings.map((r) => pathD(r, true)).join('')
    const nudge = LAKE_LABEL[name] ?? [0, 0]
    const label = [Math.round((box[0] + box[2]) / 2 + nudge[0]), Math.round((box[1] + box[3]) / 2 + nudge[1])]
    return { name, outline, fill, shape, label }
  })
  const riverWays = elems.filter((e) => e.type === 'way' && e.tags?.waterway === 'river' && e.tags?.name === '愛河').map((e) => e.geometry.map((p) => [p.lon, p.lat]))
  const riverLines = joinWays(riverWays).flatMap((l) => clipPolyline(simplify(l.map(proj), 1.2), 2))
  const river = riverLines.map((l, i) => pathD(wobble(l, 1200 + i, 1.8, 10))).join('')
  const riverLabel = (() => { const l = riverLines.sort((a, b) => polyLen(b) - polyLen(a))[0]; const p = resample(l, 4); return p[Math.round(p.length * 0.55)] })()

  // ── 地標 ──
  const dome = elems.find((e) => e.type === 'relation' && e.id === 5663918)
  const hsr = elems.find((e) => e.type === 'node' && e.id === 3933501988)
  const landmarks = [
    { name: '高鐵左營站', at: proj([hsr.lon, hsr.lat]) },
    { name: '高雄巨蛋', at: proj([(dome.bounds.minlon + dome.bounds.maxlon) / 2, (dome.bounds.minlat + dome.bounds.maxlat) / 2]) },
  ]

  // ── 五校與路線 ──
  const campuses = Object.fromEntries(Object.entries(CAMPUS_GEO).map(([k, g]) => [k, proj([g.lon, g.lat]).map((n) => Math.round(n * 10) / 10)]))
  for (const [k, [x, y]] of Object.entries(campuses)) if (x < 20 || y < 20 || x > W - 20 || y > H - 20) throw new Error(`${k} 不在地圖框內`)
  const route = CAMPUS_ORDER.slice(1).map((to, i) => {
    const from = CAMPUS_ORDER[i]
    const a = campuses[from], b = campuses[to]
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, L = dist(a, b)
    const side = i % 2 ? 1 : -1
    const nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L
    const c = [mx + nx * L * 0.22 * side, my + ny * L * 0.22 * side]
    const pts = []
    for (let t = 0; t <= 1.0001; t += 1 / 40) pts.push([(1 - t) ** 2 * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0], (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1]])
    return { from, to, d: pathD(wobble(pts, 2000 + i, 2.4, 9)) }
  })

  // ── 區名與塗色 ──
  // 區名避開校園、路線與湖（以 1000×890 畫布量）
  const LABEL_NUDGE = { 左營區: [134, -150], 三民區: [60, 150], 鳥松區: [128, -104], 仁武區: [130, -60], 鼓山區: [0, 0], 鳳山區: [0, 10] }
  const shown = new Set(['左營區', '三民區', '鳥松區', '仁武區', '鼓山區', '鳳山區'])
  const districtOut = districts.filter((d) => shown.has(d.name)).map((d, i) => {
    const campus = CAMPUS_DISTRICTS[d.name] ?? null
    const nudge = LABEL_NUDGE[d.name] ?? [0, 0]
    const fill = campus ? scribble(d.rings, { angle: -32 + i * 7, gap: 15, inset: 7, seed: 70 + i }).map((s, j) => pathD(wobble(s, 3000 + i * 50 + j, 1.4, 40, true))).join('') : null
    return { name: d.name, campus, label: [Math.round(d.label[0] + nudge[0]), Math.round(d.label[1] + nudge[1])], fill }
  })

  const data = {
    width: W, height: H,
    frame: { lon: [LON0, LON1], lat: [LAT0, LAT1] },
    border, districts: districtOut, water, river, riverLabel: riverLabel.map(Math.round), landmarks: landmarks.map((l) => ({ name: l.name, at: l.at.map((n) => Math.round(n)) })),
    campuses, route,
  }
  const json = JSON.stringify(data, null, 1)
  const ts = `// 由 scripts/build-anniversary-map.mjs 產生，不要手改。
// 區界：內政部國土測繪中心鄉鎮市區界線（政府資料開放授權條款，taiwan-atlas@2021.9.20 towns-10t.json，sha256 ${sha.slice(0, 16)}…）。
// 湖泊、河流、地標：© OpenStreetMap 貢獻者（ODbL）。五校座標：門牌比對（見產生器註解）。
export interface AnniMapDistrict { name: string; campus: string | null; label: [number, number]; fill: string | null }
export interface AnniMapWater { name: string; outline: string; fill: string; shape: string; label: [number, number] }
export interface AnniMapData {
  width: number
  height: number
  frame: { lon: [number, number]; lat: [number, number] }
  border: string
  districts: AnniMapDistrict[]
  water: AnniMapWater[]
  river: string
  riverLabel: [number, number]
  landmarks: Array<{ name: string; at: [number, number] }>
  campuses: Record<string, [number, number]>
  route: Array<{ from: string; to: string; d: string }>
}
export const ANNI_MAP: AnniMapData = ${json}
`
  writeFileSync(OUT, ts)
  console.log(`map-data.ts ${(ts.length / 1024).toFixed(1)} KB；viewBox ${W}×${H}；towns sha256 ${sha}`)
  console.log('區標籤', districtOut.map((d) => `${d.name}@${d.label}`).join(' '))
  console.log('五校', JSON.stringify(campuses))
}

main().catch((e) => { console.error(e); process.exit(1) })
