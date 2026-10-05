import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ANNI_MILESTONES, anniversaryYearMeta } from '../app/utils/anniversary/timeline'
import { MAP_FILL_YEARS, mapStateAt } from '../app/utils/anniversary/mapState'
import { ANNI_MAP } from '../app/utils/anniversary/map-data'
import { FINALE_DRAW_END, FINALE_JUMP_END, ZERO, buildFinalePath, finaleLayout, finalePhase, pointAt } from '../app/utils/anniversary/finale'
import { BLOW_MIN, CAKE_TOP, CANDLE_COUNT, blowWind, candleSpots, litCount, makeCandles, relight, stepCandles, swipeWind } from '../app/utils/anniversary/candles'
import { NO_SIGNAL_DB, blowReading, nextFloor } from '../app/utils/anniversary/blow'
import { SONG_SECONDS, noteHz } from '../app/utils/anniversary/sound'
import siteFixture from '../server/data/site-fixture.json'
import type { SiteContent } from '../app/types/site-content'

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8')

describe('30 週年分頁 v2：計數器', () => {
  it('2026 是第 30 年；2027 寫「滿 30 年」，不寫「第 31 年」', () => {
    expect(anniversaryYearMeta(1997)).toEqual({ prefix: '第', n: 1 })
    expect(anniversaryYearMeta(2026.9)).toEqual({ prefix: '第', n: 30 })
    expect(anniversaryYearMeta(2027)).toEqual({ prefix: '滿', n: 30 })
    expect(read('app/components/AnniversaryContent.vue')).toContain('{{ yearMeta.prefix }} <b>{{ yearMeta.n }}</b> 年')
  })
})

describe('30 週年分頁 v2：孩子畫的高雄地圖', () => {
  const site = siteFixture as unknown as SiteContent

  it('五校都在地圖框內，路線照成立順序一段一段接起來', () => {
    for (const m of ANNI_MILESTONES) {
      const p = ANNI_MAP.campuses[m.key]!
      expect(p[0]).toBeGreaterThan(20); expect(p[0]).toBeLessThan(ANNI_MAP.width - 20)
      expect(p[1]).toBeGreaterThan(20); expect(p[1]).toBeLessThan(ANNI_MAP.height - 20)
    }
    expect(ANNI_MAP.route.map((r) => [r.from, r.to])).toEqual(ANNI_MILESTONES.slice(1).map((m, i) => [ANNI_MILESTONES[i]!.key, m.key]))
    for (const r of ANNI_MAP.route) {
      const [, sx, sy] = r.d.match(/^M(-?\d+) (-?\d+)/)!.map(Number)
      const from = ANNI_MAP.campuses[r.from]!
      expect(Math.hypot(sx! - from[0], sy! - from[1])).toBeLessThan(3)
    }
  })

  it('塗色的區就是該校所在的區（和後台校區資料一致），湖泊與地標都有名字', () => {
    const colored = ANNI_MAP.districts.filter((d) => d.campus)
    expect(colored.map((d) => d.name).sort()).toEqual(['三民區', '仁武區', '左營區', '鳥松區'].sort())
    for (const d of colored) {
      expect(d.fill).toBeTruthy()
      expect(site.campuses.find((c) => c.key === d.campus)?.district).toBe(d.name)
    }
    expect(ANNI_MAP.water.map((w) => w.name)).toEqual(['蓮池潭', '澄清湖', '金獅湖'])
    expect(ANNI_MAP.landmarks.map((l) => l.name)).toEqual(['高鐵左營站', '高雄巨蛋'])
  })

  it('五校相對位置合理：明華、崇德在西邊（左營），義華在南邊，仁武在最北', () => {
    const c = ANNI_MAP.campuses
    expect(c.minghua![0]).toBeLessThan(c.yihua![0]!)
    expect(c.chongde![0]).toBeLessThan(c.international![0]!)
    expect(c.yihua![1]).toBeGreaterThan(c.international![1]!)
    expect(Math.min(...ANNI_MILESTONES.map((m) => c[m.key]![1]))).toBe(c.renwu![1])
  })

  it('地圖資料小於 25KB，頁面上標註資料來源', () => {
    expect(read('app/utils/anniversary/map-data.ts').length).toBeLessThan(25 * 1024)
    const map = read('app/components/AnniversaryMap.vue')
    expect(map).toContain('內政部國土測繪中心')
    expect(map).toContain('OpenStreetMap')
  })

  it('年份 → 地圖：成立那一年冒出來、路線在兩校之間按年份比例前進、所在區從校園往外塗開', () => {
    const s97 = mapStateAt(1997)
    expect(s97.shown).toEqual([true, false, false, false, false])
    expect(s97.route.every((p) => p === 0)).toBe(true)
    expect(s97.head).toBeNull()
    const s03 = mapStateAt(2003)
    expect(s03.route[0]).toBe(1)
    expect(s03.route[1]).toBeCloseTo(0.5)
    expect(s03.head).toEqual({ seg: 1, t: 0.5 })
    // 2006–2019 沒有新校園，路線從崇德慢慢走向國際校
    expect(mapStateAt(2012.5).route[2]).toBeCloseTo(0.5)
    expect(mapStateAt(2012.5).shown.filter(Boolean)).toHaveLength(3)
    expect(mapStateAt(2001 + MAP_FILL_YEARS / 2).fill.minghua).toBeCloseTo(0.5)
    const s21 = mapStateAt(2021)
    expect(s21.shown.every(Boolean)).toBe(true)
    expect(s21.route.every((p) => p === 1)).toBe(true)
    expect(s21.head).toBeNull()
  })
})

describe('30 週年分頁 v2：結尾畫成 30', () => {
  it('從軌道末端接進來、一筆連續，0 的收尾回到 0 的附近', () => {
    const entry: [number, number] = [-60, 50]
    const fp = buildFinalePath(entry)
    expect(fp.pts[0]).toEqual(entry)
    for (let i = 1; i < fp.pts.length; i++) {
      const a = fp.pts[i - 1]!, b = fp.pts[i]!
      expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeLessThan(6)
    }
    expect(0).toBeLessThan(fp.marks.threeEnd)
    expect(fp.marks.threeEnd).toBeLessThan(fp.marks.zeroStart)
    expect(fp.marks.zeroEnd).toBe(1)
    const end = pointAt(fp, 1)
    expect(Math.hypot((end.x - ZERO.cx) / ZERO.rx, (end.y - ZERO.cy) / ZERO.ry)).toBeGreaterThan(0.9)
    expect(Math.hypot((end.x - ZERO.cx) / ZERO.rx, (end.y - ZERO.cy) / ZERO.ry)).toBeLessThan(1.05)
  })

  it('3 畫完跳到 0 的那一段：起點是 3 的尾巴、終點是 0 的最底下', () => {
    const fp = buildFinalePath([-60, 50])
    const a = pointAt(fp, fp.marks.threeEnd), b = pointAt(fp, fp.marks.zeroStart)
    expect(a.x).toBeLessThan(-30)
    expect(b.x).toBeCloseTo(ZERO.cx, 0)
    expect(b.y).toBeCloseTo(ZERO.cy - ZERO.ry, 0)
  })

  it('字形放得進舞台（桌機與手機），下面留位置給文字', () => {
    for (const [w, h] of [[1280, 900], [1184, 720], [350, 844], [335, 667]] as const) {
      const { k, ox, oy } = finaleLayout(w, h)
      expect(ox - 49.7 * k).toBeGreaterThanOrEqual(0)
      expect(ox + 56 * k).toBeLessThanOrEqual(w)
      expect(oy - 33.5 * k).toBeGreaterThan(0)
      expect(oy + 41.5 * k).toBeLessThan(h * 0.8)
    }
  })

  it('捲動進度分三段：畫線、跳進 0、印校徽', () => {
    expect(finalePhase(0)).toEqual({ s: 0, jump: 0, print: false })
    expect(finalePhase(FINALE_DRAW_END / 2).s).toBeCloseTo(0.5)
    expect(finalePhase(FINALE_DRAW_END).jump).toBe(0)
    expect(finalePhase((FINALE_DRAW_END + FINALE_JUMP_END) / 2).jump).toBeCloseTo(0.5)
    expect(finalePhase(1)).toEqual({ s: 1, jump: 1, print: true })
    expect(finalePhase(2)).toEqual({ s: 1, jump: 1, print: true })
  })
})

describe('30 週年分頁 v2：30 支蠟筆蠟燭', () => {
  it('30 支、都插在蛋糕頂面上、彼此不重疊', () => {
    const spots = candleSpots()
    expect(spots).toHaveLength(30)
    expect(CANDLE_COUNT).toBe(30)
    for (const p of spots) expect(((p.x - CAKE_TOP.cx) / CAKE_TOP.rx) ** 2 + ((p.y - CAKE_TOP.cy) / CAKE_TOP.ry) ** 2).toBeLessThan(1)
    for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) {
      if (spots[i]!.row === spots[j]!.row) expect(Math.abs(spots[i]!.x - spots[j]!.x)).toBeGreaterThan(14)
    }
  })

  it('微風只會讓火晃，不會吹熄；停下來會慢慢回旺', () => {
    const cs = makeCandles()
    for (let k = 0; k < 300; k++) stepCandles(cs, 1 / 60, () => ({ x: 0.3, strength: BLOW_MIN * 0.9 }), k)
    expect(litCount(cs)).toBe(30)
    expect(cs.some((c) => Math.abs(c.lean) > 0.1)).toBe(true)
  })

  it('一直吹（按住按鈕）：前排先熄，幾秒內全部熄掉；熄了不會自己點燃', () => {
    const cs = makeCandles()
    const outOrder: number[] = []
    let t = 0
    while (litCount(cs) && t < 6) {
      outOrder.push(...stepCandles(cs, 1 / 60, (c) => blowWind(c, 1, t), t * 1000))
      t += 1 / 60
    }
    expect(litCount(cs)).toBe(0)
    expect(t).toBeGreaterThan(0.3)
    expect(t).toBeLessThan(4)
    const firstRows = outOrder.slice(0, 8).map((i) => cs[i]!.row)
    expect(firstRows.filter((r) => r === 2).length).toBeGreaterThanOrEqual(firstRows.filter((r) => r === 0).length)
    for (let k = 0; k < 120; k++) stepCandles(cs, 1 / 60, () => ({ x: 0, strength: 0 }), 9999)
    expect(litCount(cs)).toBe(0)
    relight(cs[0]!)
    expect(litCount(cs)).toBe(1)
  })

  it('劃過火焰：慢慢移動吹不熄；很快劃過一次最多吹掉 1.3 份熱度（抗風的要再劃一次）', () => {
    const slow = makeCandles(), fast = makeCandles()
    const pass = (cs: ReturnType<typeof makeCandles>, speed: number) => {
      const y = 300 - 78
      for (let x = 60; x <= 540; x += speed / 120) stepCandles(cs, 1 / 120, (c) => swipeWind(c, x, y, speed, 0), 0)
    }
    pass(slow, 300)
    expect(litCount(slow)).toBe(30)
    pass(fast, 4000)
    const out = 30 - litCount(fast)
    expect(out).toBeGreaterThan(0)
    expect(out).toBeLessThan(30)
  })
})

describe('30 週年分頁 v2：麥克風判斷吹氣', () => {
  const binHz = 44100 / 1024
  const spectrum = (fn: (hz: number) => number) => Array.from({ length: 512 }, (_, i) => fn(i * binHz))

  it('很響的寬頻氣流聲算吹氣；同樣響的純音（唱歌、嗶聲）不算；安靜不算', () => {
    const quiet = spectrum(() => -95)
    const blow = spectrum((hz) => -30 - hz / 800 + Math.sin(hz) * 2)
    const tone = spectrum((hz) => (Math.abs(hz - 440) < 30 || Math.abs(hz - 880) < 30 ? -20 : -120))
    expect(blowReading(quiet, binHz, -95).level).toBe(0)
    expect(blowReading(blow, binHz, -95).level).toBeGreaterThan(0.9)
    expect(blowReading(tone, binHz, -95).level).toBeLessThan(0.05)
  })

  it('剛接上麥克風還沒有訊號（-140dB）時不算、也不拿來當噪音底', () => {
    const none = spectrum(() => -140)
    expect(blowReading(none, binHz, Number.NaN).level).toBe(0)
    expect(nextFloor(Number.NaN, -140, 0.016)).toBeNaN()
    expect(nextFloor(-90, NO_SIGNAL_DB - 5, 0.016)).toBe(-90)
  })

  it('噪音底：安靜時往下貼，持續吹氣時每秒最多爬 3dB', () => {
    let f = nextFloor(Number.NaN, -90, 0.016)
    expect(f).toBe(-90)
    for (let k = 0; k < 60; k++) f = nextFloor(f, -30, 1 / 60)
    expect(f).toBeCloseTo(-87, 0)
    for (let k = 0; k < 120; k++) f = nextFloor(f, -95, 1 / 60)
    expect(f).toBeLessThan(-94)
  })
})

describe('30 週年分頁 v2：聲音與文案', () => {
  it('音樂盒生日快樂歌：音高正確、整首約 10 秒', () => {
    expect(noteHz('A4')).toBeCloseTo(440)
    expect(noteHz('C5')).toBeCloseTo(523.25, 1)
    expect(SONG_SECONDS).toBeCloseTo(10, 0)
  })

  it('聲音預設關閉，麥克風只在使用者按了按鈕後才請求，不錄音、不上傳', () => {
    const sound = read('app/utils/anniversary/sound.ts')
    expect(sound).toMatch(/const enabled = ref\(false\)/)
    expect(sound).not.toMatch(/localStorage|sessionStorage/)
    const ctl = read('app/utils/anniversary/cake.ts')
    expect(ctl).not.toMatch(/MediaRecorder|fetch\(|sendBeacon/)
    expect(ctl).toContain('stream.getTracks().forEach((tr) => tr.stop())')
  })

  it('頁面不放說明操作或製作過程的字（2026-10-04 使用者要求拿掉開發輔助用字），地圖只留授權要求的署名', () => {
    // 只看會出現在畫面上的字：拿掉程式與樣板的註解
    const strip = (src: string) => src.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    const page = ['app/components/AnniversaryContent.vue', 'app/components/AnniversaryCake.vue', 'app/components/AnniversaryMap.vue'].map((f) => strip(read(f))).join('\n')
    for (const phrase of ['開場影片的最後一格', '往下捲，孩子會', '點一件看完整的樣子', '選一支蠟筆，在紙上畫畫看', '畫紙準備中', '蛋糕上插了', '不會錄音', '支都點著了', '點蠟燭中', '位置依門牌估算']) {
      expect(page).not.toContain(phrase)
    }
    expect(read('app/components/AnniversaryMap.vue')).toContain('© OpenStreetMap 貢獻者・內政部國土測繪中心')
  })

  it('新的元件與程式不出現幼兒園不能用的字眼，樣式只引用 tokens', () => {
    const files = ['app/components/AnniversaryMap.vue', 'app/components/AnniversaryCake.vue', 'app/components/AnniversarySoundToggle.vue', 'app/components/AnniversaryContent.vue',
      'app/utils/anniversary/cake.ts', 'app/utils/anniversary/candles.ts', 'app/utils/anniversary/finale.ts', 'app/utils/anniversary/mapState.ts']
    for (const f of files) {
      const src = read(f)
      for (const word of ['美語部', '補習班', '三十多', '雙語']) expect(src).not.toContain(word)
      const style = src.split('<style')[1] ?? ''
      expect(style).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
      expect(style).not.toMatch(/oklch\(\s*\d/)
    }
  })
})
