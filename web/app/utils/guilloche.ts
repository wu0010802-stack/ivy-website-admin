// 入學資訊頁（入學護照版，2026-09-28）的防偽細紋：hypotrochoid（萬花尺）玫瑰紋與章節上緣的波浪帶。
// 純裝飾（aria-hidden），只在瀏覽器端依容器寬度算出 SVG path；對底紙約 1.1:1，只當紙張質感。
// hero 那組玫瑰紋有上萬個座標點，放進 SSR 的 HTML 太大，所以不在伺服器端算。
// 比稿來源：design/admission-theme-directions-20260928/b-passport/main.js。

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)

/**
 * 一條 hypotrochoid：半徑 R 的大圓裡滾半徑 r 的小圓，筆尖離小圓圓心 d。
 * R、r 要是整數才算得出閉合週期（r / gcd(R, r) 圈）；座標乘 scale 後平移到 (cx, cy)、旋轉 rot 弧度。
 */
export function trochoid(R: number, r: number, d: number, scale: number, cx: number, cy: number, rot = 0, perTurn = 180): string {
  const turns = r / gcd(R, r)
  const steps = Math.round(turns * perTurn)
  const k = (R - r) / r
  const cos = Math.cos(rot)
  const sin = Math.sin(rot)
  let path = ''
  for (let i = 0; i <= steps; i++) {
    const t = (2 * Math.PI * turns * i) / steps
    const x = (R - r) * Math.cos(t) + d * Math.cos(k * t)
    const y = (R - r) * Math.sin(t) - d * Math.sin(k * t)
    path += `${i ? 'L' : 'M'}${(cx + (x * cos - y * sin) * scale).toFixed(1)} ${(cy + (x * sin + y * cos) * scale).toFixed(1)}`
  }
  return path
}

/** 三組玫瑰紋：hero 右頁、資料頁蓋章處、補助券。每一條是 [R, r, d]。 */
export const ROSETTES = {
  hero: [[100, 35, 58], [100, 35, 36], [96, 28, 64], [96, 28, 40], [84, 36, 44]],
  data: [[120, 45, 70], [110, 30, 44]],
  coupon: [[60, 25, 30], [60, 25, 18], [56, 21, 26]]
} as const satisfies Record<string, readonly (readonly [number, number, number])[]>
export type RosetteKind = keyof typeof ROSETTES

/** 玫瑰紋：邊長 size 的正方形裡，每一條外緣距邊 2px。 */
export function rosettePaths(kind: RosetteKind, size: number): string[] {
  const sets = ROSETTES[kind]
  const reach = Math.max(...sets.map(([R, r, d]) => R - r + d))
  const scale = (size / 2 - 2) / reach
  return sets.map(([R, r, d], i) => trochoid(R, r, d, scale, size / 2, size / 2, i * 0.11))
}

/** 章節上緣的波浪帶：幾條相位錯開的正弦線，振幅再被一條長週期餘弦調變。 */
export function bandPaths(width: number, height = 24, lines = 7, period = 40): string[] {
  const out: string[] = []
  for (let k = 0; k < lines; k++) {
    const phase = (k * Math.PI) / lines
    let path = ''
    for (let x = 0; x <= width + 3; x += 3) {
      const envelope = 0.55 + 0.45 * Math.cos((2 * Math.PI * x) / (period * 6.5) + phase * 2)
      const y = height / 2 + (height / 2 - 1.5) * Math.sin((2 * Math.PI * x) / period + phase) * envelope
      path += `${x ? 'L' : 'M'}${x} ${y.toFixed(1)}`
    }
    out.push(path)
  }
  return out
}
