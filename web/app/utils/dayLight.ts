// 孩子的一天：背景影片上的光線跟著讀者停留的那張拍立得時間走。
// 只看時間戳（"08:00"），不看卡片的 tint（那是相紙顏色，不是時段）。
export type DayLight = 'none' | 'morning' | 'noon' | 'afternoon' | 'dusk'

export function dayLightFor(time: string | undefined): DayLight {
  const match = /^(\d{1,2}):(\d{2})/.exec(time ?? '')
  if (!match) return 'none'
  const minutes = Number(match[1]) * 60 + Number(match[2])
  if (minutes < 10 * 60) return 'morning'
  if (minutes < 13 * 60) return 'noon'
  if (minutes < 16 * 60) return 'afternoon'
  return 'dusk'
}
