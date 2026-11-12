/**
 * 觸控裝置同時只保留 TOUCH_MOUNT_CAP 張 WebGL 紙（paperPrints）：六張各一個場景
 * （兩張貼圖、shadow map、2D 畫布）在低階手機上吃記憶體，也讓後續每張掛載更慢。
 * 掛新的一張時，把已不在視窗內、離視窗中心最遠的卡卸回 CSS 3D 版（看不見），
 * 捲回來再由 DayMomentCard 的 scroll-idle 排程重掛。還在視窗內的卡不卸，
 * 寧可暫時超過上限也不要在畫面上切換。
 */
export interface MountedPaper {
  near: () => boolean
  distance: () => number
  detach: () => void
}

export const TOUCH_MOUNT_CAP = 2
/**
 * 共用的 WebGL context 遺失、卡片退回 CSS 版之後，隔多久再試著掛回 WebGL 紙（2026-11-11，見 paperPrints.ts 的 handleContextLost）。
 * 留一點時間讓系統把舊 context 收完；手機照舊還要等捲動停下。同一頁遺失第二次 paperPrints 就停用 WebGL，不會一直重試。
 */
export const REMOUNT_AFTER_LOSS_MS = 1200
const mounted = new Set<MountedPaper>()

export function registerMountedPaper(entry: MountedPaper): void {
  mounted.add(entry)
  while (mounted.size > TOUCH_MOUNT_CAP) {
    let victim: MountedPaper | null = null
    for (const card of mounted) {
      if (card === entry || card.near()) continue
      if (!victim || card.distance() > victim.distance()) victim = card
    }
    if (!victim) return
    mounted.delete(victim)
    victim.detach()
  }
}

export function unregisterMountedPaper(entry: MountedPaper): void {
  mounted.delete(entry)
}
