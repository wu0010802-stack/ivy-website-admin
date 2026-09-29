// 入學護照（/admission，2026-09-28）的印章版面：方章、圓章、橢圓章的框線與字的位置、字級。
// 純計算，給 components/PassportStamp.vue 畫 SVG；印章本身是 aria-hidden 的裝飾，文字都跟旁邊的內文重複。
// 比稿來源：design/admission-theme-directions-20260928/b-passport/main.js。

export interface StampText { x: number; y: number; size: number; spacing: number; text: string }
export interface StampShape { kind: 'rect' | 'circle' | 'ellipse'; x: number; y: number; w: number; h: number; r: number; stroke: number; dashed?: boolean }
export interface StampRing { d: string; size: number; length: number; dots: [number, number, number][] }
export interface StampLayout { width: number; height: number; shapes: StampShape[]; texts: StampText[]; ring?: StampRing }

const chars = (text: string) => [...text]
const round1 = (n: number) => Math.round(n * 10) / 10

/** 兩個字以下一行；三個字以上從中間拆兩行（前半多一個字），由左到右讀。 */
export function splitStampText(text: string): string[] {
  const list = chars(text)
  if (list.length <= 2) return [text]
  const half = Math.ceil(list.length / 2)
  return [list.slice(0, half).join(''), list.slice(half).join('')]
}

/** 方章：外粗框＋內細框，字拆成一到兩行。 */
export function squareLayout(text: string, size: number): StampLayout {
  const rows = splitStampText(text)
  const fontSize = size * 0.3
  const gap = fontSize * 1.08
  const top = size / 2 - ((rows.length - 1) * gap) / 2
  return {
    width: size,
    height: size,
    shapes: [
      { kind: 'rect', x: 4, y: 4, w: size - 8, h: size - 8, r: size * 0.06, stroke: size * 0.045 },
      { kind: 'rect', x: size * 0.11, y: size * 0.11, w: size * 0.78, h: size * 0.78, r: size * 0.03, stroke: size * 0.012 }
    ],
    texts: rows.map((row, i) => ({ x: size / 2, y: round1(top + i * gap), size: round1(fontSize), spacing: round1(fontSize * 0.08), text: row }))
  }
}

/**
 * 圓章：外框、（有環狀字時）內圈＋上半圈的環狀字，中間一到兩行。
 * mode：pair 兩行等大（預約／參觀）；label 上小下大（115 學年度／中班）。
 */
export function roundLayout({ ring = '', lines, mode = 'label', size }: { ring?: string; lines: string[]; mode?: 'pair' | 'label'; size: number }): StampLayout {
  const r = size / 2
  const shapes: StampShape[] = [{ kind: 'circle', x: r, y: r, w: 0, h: 0, r: r - size * 0.03, stroke: size * 0.035 }]
  let ringInfo: StampRing | undefined
  if (ring) {
    shapes.push({ kind: 'circle', x: r, y: r, w: 0, h: 0, r: r - size * 0.2, stroke: size * 0.012 })
    const pr = r - size * 0.14
    const ringSize = size * 0.085
    const arc = Math.PI * pr * 0.86
    ringInfo = {
      d: `M ${round1(r - pr)} ${r} A ${round1(pr)} ${round1(pr)} 0 1 1 ${round1(r + pr)} ${r} A ${round1(pr)} ${round1(pr)} 0 1 1 ${round1(r - pr)} ${r}`,
      size: round1(ringSize),
      length: round1(Math.min(arc, chars(ring).length * ringSize * 1.35)),
      dots: [[round1(r - pr), round1(r + size * 0.02), round1(size * 0.016)], [round1(r + pr), round1(r + size * 0.02), round1(size * 0.016)]]
    }
  }
  const inner = ring ? size * 0.25 : size * 0.4
  const fit = (text: string, cap: number) => Math.min(cap, (inner * 1.7) / Math.max(1, chars(text).length))
  const line = (text: string, y: number, fontSize: number): StampText => ({ x: r, y: round1(y), size: round1(fontSize), spacing: round1(fontSize * 0.06), text })
  let texts: StampText[]
  if (lines.length === 1) texts = [line(lines[0]!, r, fit(lines[0]!, size * 0.24))]
  else if (mode === 'pair') {
    const fontSize = Math.min(...lines.map((text) => fit(text, size * 0.2)))
    texts = [line(lines[0]!, r - fontSize * 0.56, fontSize), line(lines[1]!, r + fontSize * 0.56, fontSize)]
  } else {
    const big = fit(lines[1]!, size * 0.24)
    texts = [line(lines[0]!, r - big * 0.62, size * 0.085), line(lines[1]!, r + big * 0.32, big)]
  }
  return { width: size, height: size, shapes, texts, ring: ringInfo }
}

/** 橢圓章：一行字（穿衣日、寶貝的屆別）；outline 是虛線框（便服）。 */
export function ovalLayout(text: string, width: number, height: number, outline = false): StampLayout {
  const fontSize = Math.min(height * 0.42, (width * 0.72) / Math.max(1, chars(text).length))
  return {
    width,
    height,
    shapes: [{ kind: 'ellipse', x: width / 2, y: height / 2, w: width / 2 - 3, h: height / 2 - 3, r: 0, stroke: outline ? 1.4 : 2.6, dashed: outline }],
    texts: [{ x: width / 2, y: height / 2, size: round1(fontSize), spacing: round1(fontSize * 0.06), text }]
  }
}
