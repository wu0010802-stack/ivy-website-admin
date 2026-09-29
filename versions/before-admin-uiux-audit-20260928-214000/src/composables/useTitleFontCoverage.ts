import { reactive } from 'vue'
import { WEBSITE_ASSET_BASE } from '../config'

// 官網標題字型不是每個字都有（規格 3.1.1）：標題欄位用到字型沒有的字，官網那幾個字會
// 退回系統字，整行看起來不一致。每種字型的字表都是官網公開的
// /assets/fonts/chars-*.txt（重切字型時跟著更新），後台讀它提示缺字。
//
// - bd：LINE Seed TW Bold，一般 h2／h3 標題（關於標題、消息與活動標題、拍立得標題、熱點名稱…）。
//   2026-09-25 起是官方完整字型（scripts/subset-critical-fonts.py 切片），只缺罕見字與 emoji。
// - eb：LINE Seed TW ExtraBold，首頁 h1；完整字型，字表與 bd 相同
// - serif：Noto Serif TC 明體子集，校名與首頁五校區塊標題（三個明體子集的聯集）
export type TitleFontSubset = 'bd' | 'eb' | 'serif'

export const TITLE_FONT_FILES: Record<TitleFontSubset, string> = {
  bd: 'chars-bd.txt',
  eb: 'chars-eb.txt',
  serif: 'chars-serif.txt',
}

export const TITLE_FONT_NAMES: Record<TitleFontSubset, string> = {
  bd: '官網標題字型',
  eb: '首頁大標字型',
  serif: '校名明體字型',
}

const charsets = reactive<Partial<Record<TitleFontSubset, Set<string>>>>({})
const loading: Partial<Record<TitleFontSubset, Promise<void>>> = {}

export function missingGlyphs(text: string, available: Set<string>): string[] {
  const missing: string[] = []
  for (const char of text) {
    if (/\s/.test(char) || available.has(char) || missing.includes(char)) continue
    missing.push(char)
  }
  return missing
}

function ensureLoaded(subset: TitleFontSubset): void {
  if (loading[subset]) return
  loading[subset] = fetch(`${WEBSITE_ASSET_BASE}/assets/fonts/${TITLE_FONT_FILES[subset]}`)
    .then((response) => (response.ok ? response.text() : Promise.reject(new Error(String(response.status)))))
    .then((text) => { charsets[subset] = new Set(text) })
    // 讀不到字表就不提示，不擋編輯。下次進頁面再試。
    .catch(() => { delete loading[subset] })
}

/** 測試用：清掉已讀的字表。 */
export function resetTitleFontCoverage(): void {
  for (const key of Object.keys(TITLE_FONT_FILES) as TitleFontSubset[]) {
    delete charsets[key]
    delete loading[key]
  }
}

/** 回傳檢查函式：文字裡這個子集沒有的字；字表還沒讀到時回空陣列。 */
export function useTitleFontCoverage(subset: TitleFontSubset = 'bd') {
  ensureLoaded(subset)
  return (text: string): string[] => {
    const available = charsets[subset]
    return available ? missingGlyphs(text, available) : []
  }
}
