// 入學護照（/admission，2026-09-28）的蓋章動態：印章「壓下去」與「拿起來」。
// gsap 由 AdmissionContent.vue 在瀏覽器端動態 import 後傳進來（同常春藤環境頁，只有用到的頁面載入）；
// 這支只 import 型別。印章由 Vue 的 <Transition :css="false"> 掛上／拿掉，onEnter／onLeave 呼叫這裡。
// 減少動態或 gsap 載入失敗時不建立（回傳 null），印章直接出現、直接消失。
import type { gsap as Gsap } from 'gsap'

export interface AdmissionMotion {
  /** 蓋章：從上方壓下（加速，沒有回彈），落定後墨暈開（減速）。delay 秒。 */
  press: (el: Element, done: () => void, delay?: number) => void
  /** 拿起：往上淡出。 */
  lift: (el: Element, done: () => void) => void
  destroy: () => void
}

export function createAdmissionMotion(gsap: typeof Gsap): AdmissionMotion {
  // 還在跑的補間；離開頁面時統一 kill，done 不再呼叫（元件已卸載）
  const running = new Set<{ kill: () => unknown }>()
  return {
    press(el, done, delay = 0) {
      const stamp = el as HTMLElement
      const rot = parseFloat(stamp.style.getPropertyValue('--rot')) || 0
      const bleed = stamp.querySelector('.bleed')
      const timeline = gsap.timeline({ delay, onComplete: () => { running.delete(timeline); done() } })
      timeline.fromTo(stamp, { opacity: 0, scale: 1.32, rotation: rot - 9, y: -10 }, { opacity: 1, scale: 1, rotation: rot, y: 0, duration: 0.24, ease: 'power3.in', clearProps: 'opacity,transform' })
      if (bleed) timeline.fromTo(bleed, { opacity: 0 }, { opacity: 0.14, duration: 0.6, ease: 'expo.out' }, '>-0.02')
      running.add(timeline)
    },
    lift(el, done) {
      const tween = gsap.to(el, { opacity: 0, scale: 1.12, y: -8, duration: 0.18, ease: 'power2.out', onComplete: () => { running.delete(tween); done() } })
      running.add(tween)
    },
    destroy() {
      running.forEach((animation) => animation.kill())
      running.clear()
    }
  }
}

/**
 * 捲進視窗才蓋：同時進來的依序蓋（每個晚 0.2 秒），每一格只蓋一次。
 * onStamp(index, delay) 由頁面把那一格的狀態設成已蓋；回傳停止觀察的函式。
 */
export function observeStamps(hosts: Element[], onStamp: (index: number, delay: number) => void): () => void {
  let queue = 0
  const timers: number[] = []
  const io = new IntersectionObserver((entries) => {
    entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => hosts.indexOf(a.target) - hosts.indexOf(b.target))
      .forEach((entry) => {
        io.unobserve(entry.target)
        onStamp(hosts.indexOf(entry.target), 0.12 + queue++ * 0.2)
        timers.push(window.setTimeout(() => { queue = Math.max(0, queue - 1) }, 400))
      })
  }, { rootMargin: '0px 0px -18% 0px', threshold: 0.6 })
  hosts.forEach((host) => io.observe(host))
  return () => { io.disconnect(); timers.forEach((timer) => clearTimeout(timer)) }
}
