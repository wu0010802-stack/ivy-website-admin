/**
 * 「孩子的一天」拍立得：右下角被風掀起時的紙張彎曲（2026-09-23 定案 A 角落捲起，
 * 比稿 design/flip-wind-20260923/）。純數學、不 import three：WebGL 版（paperPrints.ts）
 * 拿來逐點彎網格，CSS 版拿 curlAngle 算兩片三角紙的角度。
 *
 * 折線過 (ox, oy)、法向 (nx, ny) 指向被掀起的那側，z 朝觀者。離折線 u（0–1，以 reach 為 1）處的轉角
 *   θ(u) = hinge·(1−(1−u)³) + tip·u³
 * 轉角集中在折線附近、外側接近一整片，像被風翻起的一頁；tip 為負＝末端逆風往回彎。
 * （比稿時試過 φ·u^p：越到末端越彎，只有尖端翻得過 90°，從正面看像缺了一角，看不到背面。）
 * 沿邊緣傳遞的波：預先積分 K 組「轉角 ×(1±ripple)」的表，逐點在相鄰兩組之間內插。
 */

export const CURL_SAMPLES = 64
export const CURL_LEVELS = 7

interface CurlTable {
  x: Float32Array
  z: Float32Array
  angle: Float32Array
}

export interface Curl {
  active: boolean
  nx: number
  ny: number
  ox: number
  oy: number
  reach: number
  ripple: number
  rippleK: number
  rippleW: number
  tables: CurlTable[]
}

export interface CurlParams {
  hinge: number
  tip: number
  nx: number
  ny: number
  ox: number
  oy: number
  reach: number
  ripple?: number
  rippleK?: number
  rippleW?: number
}

export interface CurlPoint {
  x: number
  y: number
  z: number
}

/** 離折線 u 處的轉角（弧度）。 */
export function curlAngle(hinge: number, tip: number, u: number): number {
  return hinge * (1 - (1 - u) ** 3) + tip * u ** 3
}

export function createCurl(): Curl {
  const tables = Array.from({ length: CURL_LEVELS }, () => ({
    x: new Float32Array(CURL_SAMPLES + 1),
    z: new Float32Array(CURL_SAMPLES + 1),
    angle: new Float32Array(CURL_SAMPLES + 1)
  }))
  return { active: false, nx: 1, ny: 0, ox: 0, oy: 0, reach: 1, ripple: 0, rippleK: 0, rippleW: 0, tables }
}

/** 換一組彎曲參數並重建積分表（每張每幀約 1.8k 次三角函數）。hinge、tip 都接近 0 時標成不作用。 */
export function setCurl(curl: Curl, params: CurlParams): void {
  const { hinge, tip } = params
  curl.active = params.reach > 0 && (Math.abs(hinge) > 1e-4 || Math.abs(tip) > 1e-4)
  curl.nx = params.nx
  curl.ny = params.ny
  curl.ox = params.ox
  curl.oy = params.oy
  curl.reach = params.reach
  curl.ripple = params.ripple ?? 0
  curl.rippleK = params.rippleK ?? 0
  curl.rippleW = params.rippleW ?? 0
  if (!curl.active) return
  const n = CURL_SAMPLES
  const sub = 4
  for (let k = 0; k < CURL_LEVELS; k++) {
    const m = 1 + curl.ripple * ((2 * k) / (CURL_LEVELS - 1) - 1)
    const table = curl.tables[k]!
    let x = 0
    let z = 0
    for (let j = 1; j <= n; j++) {
      for (let q = 0; q < sub; q++) {
        const th = m * curlAngle(hinge, tip, (j - 1 + (q + 0.5) / sub) / n)
        x += Math.cos(th) / (n * sub)
        z += Math.sin(th) / (n * sub)
      }
      table.x[j] = x
      table.z[j] = z
      table.angle[j] = m * curlAngle(hinge, tip, j / n)
    }
  }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/**
 * 把平面上的一點（可帶著前一段變形的 z）彎過去，原地改寫 p。折線這側（s ≤ 0）不動；
 * 超過 reach 的部分沿末端角度直直延伸。time（秒）只影響沿邊緣的波。
 */
export function curlPoint(p: CurlPoint, curl: Curl, time = 0): void {
  if (!curl.active) return
  const dx = p.x - curl.ox
  const dy = p.y - curl.oy
  const s = dx * curl.nx + dy * curl.ny
  if (s <= 0) return
  const t = -dx * curl.ny + dy * curl.nx
  const wave = curl.ripple ? Math.sin(t * curl.rippleK - time * curl.rippleW) : 0
  const fk = ((wave + 1) / 2) * (CURL_LEVELS - 1)
  const k0 = Math.min(CURL_LEVELS - 2, Math.floor(fk))
  const kb = fk - k0
  const u = s / curl.reach
  const fj = Math.min(u, 1) * CURL_SAMPLES
  const j0 = Math.min(CURL_SAMPLES - 1, Math.floor(fj))
  const jb = fj - j0
  const a = curl.tables[k0]!
  const b = curl.tables[k0 + 1]!
  const pick = (key: keyof CurlTable) => lerp(lerp(a[key][j0]!, a[key][j0 + 1]!, jb), lerp(b[key][j0]!, b[key][j0 + 1]!, jb), kb)
  let x = pick('x')
  let z = pick('z')
  const th = pick('angle')
  if (u > 1) {
    x += (u - 1) * Math.cos(th)
    z += (u - 1) * Math.sin(th)
  }
  x *= curl.reach
  z *= curl.reach
  // 前一段留下的 z 沿這一段的局部法線一起轉
  const along = x - p.z * Math.sin(th)
  p.x = curl.ox - curl.ny * t + curl.nx * along
  p.y = curl.oy + curl.nx * t + curl.ny * along
  p.z = z + p.z * Math.cos(th)
}
