// 進入特色教學頁的水彩暈開（2026-09-28 使用者選 A「中央暈開」；mock：design/curriculum-enter-transition-20260928）。
// 只有「從其他頁點連結進入 /curriculum」會播；其他換頁照 2026-09-26 的裁定，不開全站換頁動畫。
// 掛載在 plugins/curriculum-enter.client.ts，樣式在 styles.css「進入特色教學」，名字只在 html.curriculum-enter 期間存在。
import { CURRICULUM_PATH } from './seo'

export const CURRICULUM_ENTER_CLASS = 'curriculum-enter'
/** 新頁超過這個時間還沒畫好就不等了，讓瀏覽器照常收尾（同選校→預約的照片接續）。 */
export const CURRICULUM_ENTER_TIMEOUT = 2500
/**
 * 遮罩圖（utils/watercolor.ts 的 revealMaskCanvas）實心核心的最小半徑，占圖寬的比例。
 * 核心畫在 0.29、再變形，最窄處約 0.25；取 0.24 保守值，確保動畫結束時四個角都蓋滿，不留舊頁的邊。
 */
export const REVEAL_CORE = 0.24

export interface BloomConditions {
  /** 首次進站（hydration 那一次導覽）：已經有開場布幕，不疊第二段 */
  initial: boolean
  /** 上一頁／下一頁：iPhone 左滑返回時 Safari 自己有動畫，再疊一段會播兩次 */
  popstate: boolean
  supported: boolean
  reducedMotion: boolean
  forcedColors: boolean
  /** 遮罩圖在閒置時間預先產生；還沒好就直接換頁，不為了動畫讓家長等 */
  masksReady: boolean
}

export function shouldBloomIntoCurriculum(toPath: string, fromPath: string, c: BloomConditions): boolean {
  return toPath === CURRICULUM_PATH && fromPath !== CURRICULUM_PATH
    && !c.initial && !c.popstate && c.supported && !c.reducedMotion && !c.forcedColors && c.masksReady
}

/** 從畫面中央開始；最後的遮罩大小讓實心核心蓋到最遠的角。 */
export function bloomGeometry(width: number, height: number) {
  const x = width / 2, y = height / 2
  return { x, y, size: Math.ceil(Math.hypot(x, y) / REVEAL_CORE) }
}
