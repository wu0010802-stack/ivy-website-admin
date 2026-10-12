// 拍立得 WebGL 貼圖上的中文折行（paperPrints.ts 用），抽出來方便測試。DOM 版由瀏覽器處理。

// 中文禁則：這些標點不放行首、開括號不留在行尾。跟瀏覽器一樣把前一個字一起帶到下一行，
// 否則「。」「？」會自己掉到新的一行。
export const NO_LINE_START = /[，。、；：！？」』）…,.;:!?)]/
export const NO_LINE_END = /[「『（(]/

/** 量字寬（CanvasRenderingContext2D 的 measureText 只用到這個） */
export interface TextMeasurer { measureText(text: string): { width: number } }

/**
 * 依寬度貪婪折行、遵守禁則；段落最後一行只剩一個字（不算標點）時，從上一行帶一個字下來，
 * 不留「適／應？」「下／午。」這種孤字（2026-10-12，同 DOM 版的 text-wrap:pretty）。
 */
export function wrapLines(ctx: TextMeasurer, text: string, max: number): string[] {
  const out: string[] = []
  for (const raw of text.split('\n')) {
    const start = out.length
    let line = ''
    for (const ch of raw) {
      if (line && ctx.measureText(line + ch).width > max) {
        const chars = Array.from(line)
        let carry = ch
        while (chars.length > 1 && (NO_LINE_START.test(carry[0]!) || NO_LINE_END.test(chars[chars.length - 1]!))) {
          carry = chars.pop()! + carry
        }
        out.push(chars.join(''))
        line = carry
      } else {
        line += ch
      }
    }
    out.push(line)
    avoidOrphan(ctx, out, start, max)
  }
  return out
}

function avoidOrphan(ctx: TextMeasurer, lines: string[], start: number, max: number) {
  if (lines.length - start < 2) return
  const last = Array.from(lines[lines.length - 1]!)
  if (last.filter(ch => !NO_LINE_START.test(ch)).length > 1) return
  const prev = Array.from(lines[lines.length - 2]!)
  let moved = prev.pop()!
  while (prev.length > 2 && (NO_LINE_START.test(moved[0]!) || NO_LINE_END.test(prev[prev.length - 1]!))) moved = prev.pop()! + moved
  // 上一行至少留兩個字；帶下來的字加上原本的孤字要放得下。
  if (prev.length < 2 || ctx.measureText(moved + last.join('')).width > max) return
  lines[lines.length - 2] = prev.join('')
  lines[lines.length - 1] = moved + last.join('')
}
