// 30 週年分頁「幫常春藤吹蠟燭」：30 支蠟筆蠟燭的排列與風吹的模擬（純函式，畫面在 cake.ts）。
// 座標用蛋糕的 viewBox（600×560）：蛋糕頂面是中心 (300, 300)、半徑 210×50 的橢圓。

export const CAKE_W = 600
export const CAKE_H = 560
export const CAKE_TOP = { cx: 300, cy: 300, rx: 210, ry: 50 } as const
/** 蠟燭三排（後、中、前），一共 30 支；越後面越小、越高 */
const ROWS = [
  { n: 9, y: 276, half: 138, s: 0.86 },
  { n: 11, y: 300, half: 168, s: 0.93 },
  { n: 10, y: 325, half: 150, s: 1 }
] as const
export const CANDLE_COUNT = ROWS.reduce((s, r) => s + r.n, 0)
export const CANDLE_HEIGHT = 78

export interface CandleSpot { x: number; y: number; s: number; row: number; color: number }

/** 30 支的位置：每排等距、帶一點固定的錯位，顏色依序輪流（6 色） */
export function candleSpots(): CandleSpot[] {
  const out: CandleSpot[] = []
  let k = 0
  ROWS.forEach((r, row) => {
    for (let i = 0; i < r.n; i++) {
      const t = i / (r.n - 1)
      const jitter = Math.sin((k + 1) * 12.9898) * 4
      out.push({ x: CAKE_TOP.cx - r.half + t * r.half * 2 + jitter, y: r.y + Math.cos(k * 3.1) * 2, s: r.s, row, color: (k * 5 + row) % 6 })
      k++
    }
  })
  return out
}

export interface Candle extends CandleSpot {
  lit: boolean
  /** 火還有多「旺」（0–1）；被風吹到 0 就熄 */
  heat: number
  /** 火焰傾斜（弧度）與角速度 */
  lean: number
  leanV: number
  /** 抗風程度（每支不同，吹的時候才會一支一支熄） */
  res: number
  /** 熄掉的時間（ms），點著時是 -1 */
  outAt: number
}

export function makeCandles(seed = 3): Candle[] {
  let s = seed >>> 0
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
  return candleSpots().map((p) => ({ ...p, lit: true, heat: 1, lean: 0, leanV: 0, res: 0.65 + rnd() * 0.75, outAt: -1 }))
}

/** 某一支蠟燭此刻受到的風：x 方向的推力（決定傾斜）與強度（決定熱度流失） */
export interface Wind { x: number; strength: number }

/** 風弱於這個強度只會讓火晃，不會吹熄 */
export const BLOW_MIN = 0.22

/** 均勻的吹氣（按住按鈕、麥克風）：前排最強；每支加上不同相位的陣風，才不會整排同時熄 */
export function blowWind(c: Candle, base: number, t: number): Wind {
  const rowGain = [0.78, 0.9, 1][c.row] ?? 1
  const gust = 0.72 + 0.28 * Math.sin(t * 7.3 + c.x * 0.09) + 0.12 * Math.sin(t * 17.1 + c.x * 0.31)
  const strength = Math.max(0, base * rowGain * gust)
  // 從前面吹過來：火往後倒，左右隨位置散開
  return { x: (c.x - 300) / 300 * 0.6 * strength + Math.sin(t * 9 + c.x) * 0.25 * strength, strength }
}

/**
 * 滑鼠或手指劃過：只有靠近軌跡的那幾支有風。劃得越快越有效，但一次劃過最多只吹掉
 * 1.3 份熱度（抗風強的那幾支要多劃一次），跟停留時間無關：越快經過的時間越短，所以強度乘上速度補回來。
 */
export function swipeWind(c: Candle, px: number, py: number, vx: number, vy: number): Wind {
  const tipY = c.y - CANDLE_HEIGHT * c.s
  const d2 = (c.x - px) ** 2 + ((tipY - py) * 1.3) ** 2
  const R = 64
  const fall = Math.exp(-d2 / (2 * R * R))
  const speed = Math.hypot(vx, vy)
  const perPass = Math.min(1.3, Math.max(0, (speed - 400) / 1600))
  // 經過一支蠟燭的時間 ≈ ∫fall dx / speed = R·√(2π) / speed ≈ 160 / speed；熱度流失速率 = (強度 − BLOW_MIN)·2.3，
  // 所以強度裡放 perPass·speed / (160·2.3) ≈ perPass·speed / 370，一次劃過剛好吹掉 perPass 份熱度
  return { x: vx * fall * 0.0011, strength: fall * (BLOW_MIN + perPass * speed / 370) }
}

/**
 * 往前推 dt 秒：火焰傾斜是有阻尼的彈簧；風夠強時熱度往下掉、到 0 就熄，風弱時慢慢回旺。
 * 熄了的不會自己點燃（要呼叫 relight）。回傳這一步熄掉的蠟燭索引。
 */
export function stepCandles(cs: Candle[], dt: number, windOf: (c: Candle, i: number) => Wind, now: number): number[] {
  const out: number[] = []
  cs.forEach((c, i) => {
    if (!c.lit) return
    const w = windOf(c, i)
    const target = Math.max(-1.1, Math.min(1.1, w.x))
    c.leanV += ((target - c.lean) * 90 - c.leanV * 11) * dt
    c.lean += c.leanV * dt
    if (w.strength > BLOW_MIN) c.heat -= (w.strength - BLOW_MIN) * 2.3 / c.res * dt
    else c.heat = Math.min(1, c.heat + 0.9 * dt)
    if (c.heat <= 0) { c.lit = false; c.heat = 0; c.outAt = now; out.push(i) }
  })
  return out
}

export function relight(c: Candle) {
  c.lit = true; c.heat = 1; c.lean = 0; c.leanV = 0; c.outAt = -1
}

export const litCount = (cs: Candle[]) => cs.reduce((n, c) => n + (c.lit ? 1 : 0), 0)
