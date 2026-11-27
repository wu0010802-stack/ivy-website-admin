import { reactive, watch, type WatchSource } from 'vue'

/** 目標人數類的輸入框：空白是未設定（null），其餘取不小於 0 的整數。 */
export function parseCount(raw: string): number | null {
  const text = raw.trim()
  return text === '' ? null : Math.max(0, Math.trunc(Number(text)))
}

/**
 * 缺額統計表、編班表上「改完失焦就送出」的數字輸入框（2026-11-26）：使用者打的字先記在這裡，畫面優先顯示它。
 * 不直接綁伺服器的值，是因為每次重讀後元件重繪，Vue 會把輸入框強制設回綁定的值——下一格正在打的字會被清空；
 * 三段目標整列送出時若拿伺服器的舊值當底，也會把上一格剛打、還沒存好的值蓋回去。
 * 重讀回來的值和打的字一樣（已經存好）才丟掉；動作被後端擋下時呼叫端遞增 discard，全部丟掉、回到伺服器的值，
 * 被擋下的值不會留在輸入框裡看起來像存了。
 */
export function useNumberDrafts(saved: (field: string) => number | null | undefined, source: WatchSource, discard: WatchSource) {
  const typed = reactive(new Map<string, string>())
  watch(source, () => {
    for (const [field, text] of typed) if (parseCount(text) === (saved(field) ?? null)) typed.delete(field)
  })
  watch(discard, () => typed.clear())
  return {
    /** 輸入框顯示的字：打過就是打的字，不然是伺服器的值。 */
    text: (field: string) => typed.get(field) ?? String(saved(field) ?? ''),
    /** 這一格目前的數字，含還沒存好的。 */
    value: (field: string) => (typed.has(field) ? parseCount(typed.get(field)!) : saved(field) ?? null),
    /** input／change 事件：記下輸入框現在的字，回傳它的數字。 */
    take: (field: string, event: Event) => {
      const text = (event.target as HTMLInputElement).value
      typed.set(field, text)
      return parseCount(text)
    },
  }
}
