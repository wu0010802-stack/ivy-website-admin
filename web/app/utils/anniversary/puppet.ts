// 30 週年分頁：校徽上的兩個孩子做成的紙偶（與開場影片同一套）。
// 身體與白色模切邊是預先切好的圖（scripts/build-anniversary-media.py），腿、鞋、蠟筆每一格用 canvas 重畫。
// 座標都用校徽原圖的像素（1254×1254）；畫布範圍 x∈[KX0,KX1]、y∈[KY0,KY1]。
import { ANNI_MEDIA } from './media'

export const KX0 = 270, KX1 = 960, KY0 = 200, KY1 = 734
const K = ANNI_MEDIA.kid
/** 蠟筆尖在畫布裡的位置（0–1）：時間軸把這一點對到蠟筆線的線頭 */
export const PUPPET_TIP: readonly [number, number] = [(K.crayonTip[0] - KX0) / (KX1 - KX0), (K.crayonTip[1] - KY0) / (KY1 - KY0)]
export const PUPPET_ASPECT = (KX1 - KX0) / (KY1 - KY0)

export interface PuppetPose {
  /** 走路相位（弧度） */
  phase: number
  /** 步幅 0–1 */
  stride: number
}

export interface Puppet {
  draw(canvas: HTMLCanvasElement, pose: PuppetPose): void
}

/** 身體輪廓的深藍：取身體圖裡最暗那一群像素的平均，不在程式裡寫死色碼 */
function outlineColor(img: HTMLImageElement): string {
  const c = document.createElement('canvas')
  c.width = 120; c.height = 90
  const g = c.getContext('2d', { willReadFrequently: true })!
  g.drawImage(img, 0, 0, c.width, c.height)
  const d = g.getImageData(0, 0, c.width, c.height).data
  let r = 0, gg = 0, b = 0, n = 0
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3]! < 250) continue
    const lum = 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!
    if (lum < 70) { r += d[i]!; gg += d[i + 1]!; b += d[i + 2]!; n++ }
  }
  return n ? `rgb(${Math.round(r / n)} ${Math.round(gg / n)} ${Math.round(b / n)})` : 'currentColor'
}

export function createPuppet(body: HTMLImageElement, border: HTMLImageElement, crayon: string, paper: string): Puppet {
  const navy = outlineColor(body)
  const legs = K.legs
  return {
    draw(canvas, pose) {
      const W = canvas.width, H = canvas.height
      const g = canvas.getContext('2d')!
      const s = W / (KX1 - KX0)
      g.setTransform(1, 0, 0, 1, 0, 0)
      g.clearRect(0, 0, W, H)
      g.setTransform(s, 0, 0, s, -KX0 * s, -KY0 * s)
      const { phase, stride } = pose
      const bob = Math.abs(Math.sin(phase)) * 7 * stride
      const bodyY = (y: number) => y - bob
      const legsNow = legs.hips.map(([hx, hy], i) => {
        const side = i % 2 ? 1 : -1
        const ph = phase + (i % 2 ? Math.PI : 0) + (i < 2 ? 0 : 0.35)
        const sw = Math.sin(ph) * stride * 0.5
        const lift = Math.max(0, Math.cos(ph)) * stride * 16
        return { hx, hipY: bodyY(hy), footX: hx + Math.sin(sw) * 50 + side * 2, footY: legs.ground - 14 - lift, shoe: legs.shoe[i]!, i }
      })
      const hand = [404, bodyY(522)] as const
      const tip = K.crayonTip
      const ang = Math.atan2(tip[1] - hand[1], tip[0] - hand[0])
      const len = Math.hypot(tip[0] - hand[0], tip[1] - hand[1]) + 34
      const crayonShape = (border: boolean) => {
        g.save()
        g.translate(tip[0], tip[1]); g.rotate(ang + Math.PI)
        const r = 15, B = K.border
        if (border) {
          g.fillStyle = paper
          g.beginPath(); g.moveTo(-B * 0.9, 0); g.lineTo(26, -r - B); g.lineTo(len + B, -r - B); g.lineTo(len + B, r + B); g.lineTo(26, r + B); g.closePath(); g.fill()
        } else {
          g.lineJoin = 'round'; g.lineWidth = 7; g.strokeStyle = navy
          g.fillStyle = crayon
          g.beginPath(); g.moveTo(2, 0); g.lineTo(28, -r); g.lineTo(28, r); g.closePath(); g.fill(); g.stroke()
          g.fillRect(28, -r, len - 28, 2 * r)
          g.globalAlpha = 0.22; g.fillStyle = paper; g.fillRect(28, -r, len - 28, r * 0.55); g.globalAlpha = 1
          g.strokeRect(28, -r, len - 28, 2 * r)
        }
        g.restore()
      }
      const drawBody = (img: HTMLImageElement) => g.drawImage(img, K.x0, K.y0 - bob)
      g.lineCap = 'round'; g.lineJoin = 'round'
      // 白邊：身體、蠟筆、腿、鞋
      drawBody(border)
      crayonShape(true)
      g.strokeStyle = paper; g.fillStyle = paper; g.lineWidth = legs.legW + K.border * 2
      for (const L of legsNow) {
        g.beginPath(); g.moveTo(L.hx, L.hipY - 6); g.lineTo(L.footX, L.footY); g.stroke()
        const sx = L.footX + (L.i % 2 ? 14 : -14)
        g.beginPath(); g.ellipse(sx, L.footY + 4, L.shoe[2] as number + K.border + 4, L.shoe[3] as number + K.border + 4, 0, 0, Math.PI * 2); g.fill()
      }
      // 腿與鞋
      g.strokeStyle = navy; g.lineWidth = legs.legW
      for (const L of legsNow) { g.beginPath(); g.moveTo(L.hx, L.hipY - 6); g.lineTo(L.footX, L.footY); g.stroke() }
      for (const L of legsNow) {
        const sx = L.footX + (L.i % 2 ? 14 : -14)
        g.fillStyle = L.shoe[4] as string; g.lineWidth = 8; g.strokeStyle = navy
        g.beginPath(); g.ellipse(sx, L.footY + 4, (L.shoe[2] as number) + 3, (L.shoe[3] as number) + 2, 0, 0, Math.PI * 2); g.fill(); g.stroke()
      }
      crayonShape(false)
      drawBody(body)
    }
  }
}
