// 30 週年分頁「幫常春藤吹蠟燭」：從麥克風的頻譜判斷有沒有在吹氣（純函式，可測）。
// 對著麥克風吹氣是很響、很寬頻的氣流雜訊，低頻（< 700Hz）特別強；說話、唱歌的頻譜是一根根諧波，
// 「頻譜平坦度」（幾何平均／算術平均）低。兩個條件都要成立才算吹氣，所以在旁邊講話不會把蠟燭吹熄。
// 只在瀏覽器裡即時算，不錄音、不上傳。

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }

export interface BlowReading {
  /** 0–1：吹氣的強度 */
  level: number
  /** 低頻能量（dB），拿來更新環境噪音底 */
  lowDb: number
  /** 200–4000Hz 的頻譜平坦度（0–1） */
  flatness: number
}

/**
 * freqDb：AnalyserNode.getFloatFrequencyData 的結果（每格 dB），binHz：每格的頻寬（sampleRate / fftSize），
 * floorDb：環境噪音的低頻能量（安靜時的 lowDb）。
 */
export function blowReading(freqDb: ArrayLike<number>, binHz: number, floorDb: number): BlowReading {
  const band = (lo: number, hi: number) => {
    const a = Math.max(1, Math.floor(lo / binHz)), b = Math.min(freqDb.length - 1, Math.ceil(hi / binHz))
    const p: number[] = []
    for (let i = a; i <= b; i++) p.push(Math.pow(10, Math.max(-140, freqDb[i]!) / 10))
    return p
  }
  const low = band(80, 700)
  const lowPow = low.reduce((s, v) => s + v, 0) / Math.max(1, low.length)
  const lowDb = 10 * Math.log10(lowPow + 1e-14)
  const mid = band(200, 4000)
  const arith = mid.reduce((s, v) => s + v, 0) / Math.max(1, mid.length)
  const geo = Math.exp(mid.reduce((s, v) => s + Math.log(v + 1e-14), 0) / Math.max(1, mid.length))
  const flatness = arith > 0 ? geo / arith : 0
  // 剛接上麥克風的頭幾格全是 -140dB（還沒有訊號）：不算
  if (!(lowDb > NO_SIGNAL_DB)) return { level: 0, lowDb, flatness }
  // 噪音底最低當 -80dB：很安靜的房間也要真的吹一口氣才算
  const ref = Number.isFinite(floorDb) ? Math.max(floorDb, -80) : lowDb
  const level = smooth(10, 28, lowDb - ref) * smooth(0.1, 0.3, flatness)
  return { level, lowDb, flatness }
}

/** 低於這個能量視為麥克風還沒有訊號 */
export const NO_SIGNAL_DB = -130

/**
 * 環境噪音底：安靜時跟著往下貼、吹氣或說話時只能很慢往上爬（每秒最多 3dB），
 * 這樣持續吹也不會被當成新的安靜。
 */
export function nextFloor(floor: number, lowDb: number, dt: number): number {
  if (!(lowDb > NO_SIGNAL_DB)) return floor
  if (!Number.isFinite(floor)) return lowDb
  return lowDb < floor ? floor + (lowDb - floor) * Math.min(1, dt * 4) : Math.min(lowDb, floor + 3 * dt)
}
