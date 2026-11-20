// 成效統計畫面上的數字與名稱格式（2026-11-20 可讀性）。只管畫面；匯出 CSV 一律寫原始數字與完整名稱。

/** 次數加千分位（1617 → 1,617）：四位數以上一眼分得出幾千幾百。null／undefined 寫「—」。 */
export function formatCount(value: number | null | undefined): string {
  return value == null ? '—' : value.toLocaleString('en-US')
}

/**
 * 名稱後面括號裡的補充拆成兩層：「直接進站（輸入網址、書籤、看不出來源）」→ 名稱「直接進站」＋小字說明。
 * 窄欄裡整串會斷成三行、把數字欄擠歪；拆開後名稱一行、說明在下面淡一階。沒有括號的照原樣。
 */
export function splitLabel(label: string): { name: string; note: string } {
  const match = /^(.+?)（(.+)）$/.exec(label)
  return match ? { name: match[1]!, note: match[2]! } : { name: label, note: '' }
}

/**
 * 「類別：內容」的名稱（「孩子的一天：翻開「一起用餐」」「入學資訊：爸媽常問的事」）拆成前後兩段。
 * 畫面上兩段各自不拆開：放不下一行時在冒號後面換行，而不是斷在詞的中間；前段淡一階，一整排同類別的項目比較好掃。
 * 沒有冒號的整串放在 name。
 */
export function splitPrefix(label: string): { prefix: string; name: string } {
  const index = label.indexOf('：')
  return index > 0 && index < label.length - 1 ? { prefix: label.slice(0, index + 1), name: label.slice(index + 1) } : { prefix: '', name: label }
}
