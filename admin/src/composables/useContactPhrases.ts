import { nextTick, ref, watch, type Ref } from 'vue'
import type { InputInstance } from 'element-plus'
import { api } from '../api/client'
import type { ContactPhrasesOut } from '../api/types'
import { notifyWarning } from './notify'
import { usePermissions } from './usePermissions'

// 聯絡片語（2026-10-12 規格 4.2）：總管理者在「系統 → 聯絡片語」維護的全站一份清單，
// 案件時間線與招生「記錄聯絡」的輸入框上方以一列按鈕顯示，點一下帶入。
// 讀取失敗、沒有片語、沒有讀取權限時都只是不顯示這一列，不擋輸入。

const ENDPOINT = '/admin/contact-phrases'
// 片語很少改，同一頁的多個輸入框共用一次請求；但後台常常整天開著，別人改了之後
// 不必重新整理才看得到，所以超過這個時間的快取不再沿用。
const CACHE_MS = 5 * 60 * 1000

interface CacheEntry {
  at: number
  promise: Promise<string[]>
}
let cache: CacheEntry | null = null

// 其他測試常把沒有對到的路徑回成 [] 或別的物件：形狀不對一律當沒有片語。
function normalize(data: unknown): string[] {
  const list = (data as { phrases?: unknown } | null | undefined)?.phrases
  return Array.isArray(list) ? list.filter((phrase): phrase is string => typeof phrase === 'string' && phrase.trim() !== '') : []
}

/** 讀片語（共用快取）。失敗回空陣列、不丟錯，也不留在快取裡，下次掛載會再試。 */
export function fetchContactPhrases(): Promise<string[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.promise
  const entry: CacheEntry = { at: Date.now(), promise: Promise.resolve([]) }
  entry.promise = new Promise<ContactPhrasesOut>((resolve) => resolve(api.get<ContactPhrasesOut>(ENDPOINT))).then(normalize, () => {
    if (cache === entry) cache = null
    return []
  })
  cache = entry
  return entry.promise
}

/** 管理頁存檔後呼叫：下一個輸入框掛載時重新讀。 */
export function invalidateContactPhrases(): void {
  cache = null
}

/** 沒有 contact_phrases.read 的帳號（例如內容編輯）不發請求，phrases 一直是空的。 */
export function useContactPhrases() {
  const { can } = usePermissions()
  const phrases = ref<string[]>([])
  watch(
    () => can('contact_phrases.read'),
    (allowed) => {
      if (!allowed) {
        phrases.value = []
        return
      }
      void fetchContactPhrases().then((list) => {
        if (can('contact_phrases.read')) phrases.value = list
      })
    },
    { immediate: true },
  )
  return { phrases, invalidate: invalidateContactPhrases }
}

const END_PUNCTUATION = '，。、！？；：,.!?;:'

/**
 * 把一句片語接在輸入框現有的內容後面：空白就直接帶入；結尾已是標點或換行就直接接；
 * 否則先補「，」。結尾多打的空白（含全形空白）不算。
 */
export function appendPhrase(current: string, phrase: string): string {
  if (!current.trim()) return phrase
  const base = current.replace(/[ \t　]+$/, '')
  if (base.endsWith('\n') || END_PUNCTUATION.includes(base[base.length - 1]!)) return base + phrase
  return `${base}，${phrase}`
}

/**
 * 點片語 chip 的處理：附加到輸入框，接著把游標移到結尾並回到輸入框（連點幾句就一路接下去）。
 * 文字用 getter／setter 傳，案件時間線（reactive 物件的欄位）與記錄聯絡（ref）都能接。
 * maxLength：輸入框有字數上限時給，接上去會超過就不插入並說明，不悄悄截掉。
 */
export function usePhraseInsert(
  getText: () => string,
  setText: (value: string) => void,
  input: Readonly<Ref<InputInstance | null | undefined>>,
  options: { maxLength?: number } = {},
) {
  return async function insertPhrase(phrase: string): Promise<void> {
    const next = appendPhrase(getText(), phrase)
    if (options.maxLength && next.length > options.maxLength) {
      notifyWarning('字數已達上限，放不下這一句。')
      return
    }
    setText(next)
    await nextTick()
    const field = input.value?.textarea ?? input.value?.input
    if (!field) return
    field.focus()
    const end = field.value.length
    field.setSelectionRange(end, end)
    // 多行文字框自動長高到上限後會捲動：讓游標所在的最後一行留在畫面內。
    field.scrollTop = field.scrollHeight
  }
}
