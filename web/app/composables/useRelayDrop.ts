/**
 * 接力的「關於」（2026-09-24 比稿 ?drop=sink 定案）：停拍時「關於」從浮水印那行往下掉，穿過擦除線
 * （上半淡綠、下半白字，跟「常春藤」接力同一招），落進「常春藤的一天」句首湊成「關於常春藤的一天」；
 * 停拍後擦除線繼續往上，「關於」沉進字行（字行底緣以下裁掉，不淡出），大標再回到置中。
 *
 * 兩份「關於」：belief 浮水印的 .wm-a（擦除線以上看得到）與日常 intro 裡的 .day-lead（以下看得到），
 * 每一幀寫成同一個視窗座標。停拍期間 .day-intro 釘在視窗 (0,0)、backdrop 釘在自己的 sticky top，
 * 所以量一次相對位置就能換算。
 */
export function createRelayDrop(panelRef: Ref<HTMLElement | null>) {
  const clamp = (n: number) => Math.max(0, Math.min(1, n))
  const smooth = (x: number) => {
    const t = clamp(x)
    return t * t * (3 - 2 * t)
  }
  let ready = false
  let wm: HTMLElement | null = null
  let lead: HTMLElement | null = null
  let title: HTMLElement | null = null
  // 視窗座標：a 浮水印「關於」原位左上、v 落點左上、wmBase／leadBase 兩個元素不加 inline transform 時的左上。
  const a = { x: 0, y: 0 }
  const v = { x: 0, y: 0 }
  const wmBase = { x: 0, y: 0 }
  const leadBase = { x: 0, y: 0 }
  let em = 1
  let scale = 1

  function reset() {
    for (const el of [wm, lead, title]) {
      if (!el) continue
      el.style.transform = ''
      el.style.clipPath = ''
    }
  }

  function measure() {
    reset()
    const panel = panelRef.value
    wm = panel?.querySelector<HTMLElement>('.wm-a') ?? null
    lead = document.querySelector<HTMLElement>('.day-lead')
    title = document.querySelector<HTMLElement>('.day-title')
    const backdrop = panel?.querySelector<HTMLElement>('.belief-backdrop')
    const intro = lead?.closest<HTMLElement>('.day-intro')
    const leadRect = lead?.getBoundingClientRect()
    // .day-lead 只在簾幕動態開啟時顯示；沒顯示就不接管，停拍退回只接「的一天」。
    ready = Boolean(wm && title && backdrop && intro && leadRect?.width)
    if (!ready || !wm || !title || !backdrop || !intro || !leadRect) return
    const stickyTop = Number.parseFloat(getComputedStyle(backdrop).top) || 0
    const wmRect = wm.getBoundingClientRect()
    const backdropRect = backdrop.getBoundingClientRect()
    const introRect = intro.getBoundingClientRect()
    const titleRect = title.getBoundingClientRect()
    a.x = wmRect.left
    a.y = wmRect.top - backdropRect.top + stickyTop
    // CSS 給浮水印的 translateY(-50%) 會被 inline transform 蓋掉，基準點要補回半個字高。
    wmBase.x = a.x
    wmBase.y = a.y + wmRect.height / 2
    leadBase.x = leadRect.left - introRect.left
    leadBase.y = leadRect.top - introRect.top
    em = Number.parseFloat(getComputedStyle(title).fontSize) || titleRect.height
    // 八個字要塞得下：桌機多半剛好 1，手機約 .75。
    scale = Math.min(1, (introRect.width - 48) / (8 * em))
    const cx = titleRect.left - introRect.left + titleRect.width / 2
    const cy = titleRect.top - introRect.top + titleRect.height / 2
    v.x = cx - 4 * em * scale
    v.y = cy - (em * scale) / 2
  }

  /** fall：停拍前段 0→1（掉下來、大標讓位）；gone：停拍後擦除線繼續往上 0→1（沉下去、大標回正）。 */
  function apply(fall: number, gone: number) {
    if (!ready || !wm || !lead || !title) return
    // 水平平滑移動；垂直像重力加速，落地後輕彈一下。
    const land = 0.82
    const drop = fall < land ? (fall / land) ** 2 : 1
    const bounce = fall > land && fall < 1 ? Math.sin((Math.PI * (fall - land)) / (1 - land)) * 0.06 * em * scale : 0
    const x = a.x + (v.x - a.x) * smooth(fall)
    const y = a.y + (v.y - a.y) * drop - bounce
    const k = 1 + (scale - 1) * smooth(fall)
    // 沉下去：往下移多少，底部就裁掉多少，字行底緣以下一直看不到。
    const sink = gone * em * k
    const room = smooth(fall / 0.6) * (1 - smooth((gone - 0.55) / 0.45))
    title.style.transform = room ? `translateX(${(em * scale * room).toFixed(1)}px) scale(${(1 + (scale - 1) * room).toFixed(4)})` : ''
    lead.style.transform = `translate(${(x - leadBase.x).toFixed(1)}px, ${(y + sink - leadBase.y).toFixed(1)}px) scale(${k.toFixed(4)})`
    lead.style.clipPath = gone ? `inset(0 0 ${(gone * 100).toFixed(2)}% 0)` : ''
    // 浮水印那份只負責擦除線以上的部分；落地後整個在擦除線下方、被簾幕裁掉，不用跟著沉。
    wm.style.transform = `translate(${(x - wmBase.x).toFixed(1)}px, ${(y - wmBase.y).toFixed(1)}px) scale(${k.toFixed(4)})`
  }

  return {
    get active() {
      return ready
    },
    measure,
    apply,
    reset
  }
}
