/** 首頁手機版「活動影片」環形輪播的純計算（2026-09-23 D：B 中央聚焦＋白色圓點）。 */

export const mod = (value: number, size: number) => ((value % size) + size) % size

/** 第 k 張相對目前位置的偏移，收在 [-n/2, n/2)：±1 是左右露出的那兩張，更遠的在畫面外，跨界時不會掃過畫面。 */
export function ringOffset(k: number, position: number, size: number) {
  return mod(k - position + size / 2, size) - size / 2
}

/** 從目前位置轉到第 index 張的最近目標（可能往左也可能往右繞）。 */
export function nearestTurn(position: number, index: number, size: number) {
  const current = Math.round(position)
  let delta = mod(index - mod(current, size), size)
  if (delta > size / 2) delta -= size
  return current + delta
}

/** 放手後停在哪：速度夠快就往那個方向翻一張，否則過半才翻；一次最多離起點一張。 */
export function settleTarget(position: number, start: number, velocity: number) {
  let target = Math.round(position)
  if (Math.abs(velocity) > 0.3) target = velocity < 0 ? Math.floor(position) + 1 : Math.ceil(position) - 1
  const base = Math.round(start)
  return Math.max(base - 1, Math.min(base + 1, target))
}

/** 支援 youtu.be、watch?v=、shorts、embed、live 網址與 11 碼 ID；看不懂回傳空字串。 */
export function youtubeId(input: string) {
  const text = input.trim()
  const match = text.match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/))([\w-]{11})/)
  if (match) return match[1]!
  return /^[\w-]{11}$/.test(text) ? text : ''
}

export const youtubeThumb = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
export const youtubeEmbed = (id: string) => `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&playsinline=1&rel=0`
