import { ref } from 'vue'
import { WEBSITE_ASSET_BASE } from '../config'

// 官網標題字 LINE Seed TW 只有子集（規格 3.1.1）：標題欄位用到子集沒有的字，
// 官網那幾個字會退回系統字，整行看起來不一致。字表就是官網公開的
// /assets/fonts/chars-bd.txt（重切子集時跟著更新），後台讀它提示缺字。
const charset = ref<Set<string> | null>(null)
let loading: Promise<void> | null = null

export function missingGlyphs(text: string, available: Set<string>): string[] {
  const missing: string[] = []
  for (const char of text) {
    if (/\s/.test(char) || available.has(char) || missing.includes(char)) continue
    missing.push(char)
  }
  return missing
}

export function useTitleFontCoverage() {
  if (!loading) {
    loading = fetch(`${WEBSITE_ASSET_BASE}/assets/fonts/chars-bd.txt`)
      .then((response) => (response.ok ? response.text() : Promise.reject(new Error(String(response.status)))))
      .then((text) => { charset.value = new Set(text) })
      // 讀不到字表就不提示，不擋編輯。下次進頁面再試。
      .catch(() => { loading = null })
  }
  /** 標題裡官網標題字沒有的字；字表還沒讀到時回空陣列。 */
  return (text: string): string[] => (charset.value ? missingGlyphs(text, charset.value) : [])
}
