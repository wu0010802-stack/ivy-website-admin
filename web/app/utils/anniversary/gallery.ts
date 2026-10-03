// 30 週年分頁「孩子的作品拼成的 30」：沿用特色教學頁（components/CurriculumContent.vue 的 GALLERY）
// 已上線的 8 件作品與替代文字；沒放的（字母珠球、有手寫字的膠帶畫）這裡也不放。
export interface AnniversaryArtwork {
  image: string
  label: string
  alt: string
}

export const ANNI_ARTWORKS: readonly AnniversaryArtwork[] = [
  { image: 'cur-gallery-canvas-yellow', label: '畫布上的人', alt: '黃色畫布上，用橘、白、紅色畫的人物和愛心' },
  { image: 'cur-gallery-clay-ball', label: '黏土球', alt: '塗成藍紫色、黏滿黏土小裝飾的球' },
  { image: 'cur-gallery-tote', label: '帆布袋', alt: '用紅、藍、綠色點畫的帆布袋' },
  { image: 'cur-gallery-plane-pink', label: '木頭飛機', alt: '塗成粉紅色的木頭雙翼飛機' },
  { image: 'cur-gallery-tee', label: '染色 T 恤', alt: '染上粉紅與黃色的 T 恤' },
  { image: 'cur-gallery-canvas-blue', label: '畫布上的人', alt: '藍綠色畫布上，用藍色線條和紅色圈圈畫的人' },
  { image: 'cur-gallery-tape', label: '膠帶留白畫', alt: '撕掉膠帶後留下白色線條的粉紅色畫' },
  { image: 'cur-gallery-plane-dots', label: '木頭飛機', alt: '點滿藍色與彩色小點的木頭雙翼飛機' },
]

export interface MosaicCell {
  /** 格子左上角（0–1，相對整張拼圖） */
  x: number
  y: number
  /** 用第幾件作品 */
  art: number
  /** 這一格取作品的哪一塊（0–1，裁切中心） */
  cx: number
  cy: number
  /** 拼起來的先後（0–1） */
  order: number
}

/**
 * 把「30」的字形切成方格：mask(x, y) 回傳該點是否在字裡（0–1 座標）。
 * 格子中心落在字裡才保留；作品依序輪流放，相鄰格不重複同一件。
 */
export function mosaicCells(mask: (x: number, y: number) => number, cols: number, rows: number, seed = 7): MosaicCell[] {
  let s = seed >>> 0
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
  const cells: MosaicCell[] = []
  const grid: number[] = new Array(cols * rows).fill(-1)
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = (i + 0.5) / cols, y = (j + 0.5) / rows
      if (mask(x, y) < 0.5) continue
      const near = new Set<number>()
      for (const [di, dj] of [[-1, 0], [0, -1], [-1, -1], [1, -1]] as const) {
        const ii = i + di, jj = j + dj
        if (ii >= 0 && jj >= 0 && ii < cols) near.add(grid[jj * cols + ii]!)
      }
      let art = Math.floor(rnd() * ANNI_ARTWORKS.length)
      for (let k = 0; k < ANNI_ARTWORKS.length && near.has(art); k++) art = (art + 1) % ANNI_ARTWORKS.length
      grid[j * cols + i] = art
      cells.push({ x: i / cols, y: j / rows, art, cx: 0.25 + rnd() * 0.5, cy: 0.25 + rnd() * 0.5, order: 0 })
    }
  }
  // 由左上往右下拼，帶一點亂數
  cells.forEach((c) => { c.order = Math.min(1, (c.x * 0.6 + c.y * 0.4) * 0.85 + rnd() * 0.15) })
  return cells
}
