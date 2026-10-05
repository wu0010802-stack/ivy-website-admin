// 開場影片、畫板導引、結尾共用的「30」幾何（字形單位，y 往上）。
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
