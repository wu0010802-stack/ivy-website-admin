// 案件聯絡紀錄的草稿（2026-09-29）：寫到一半被打斷（閒置逾時被導回登入、換頁）時先存在
// 這個分頁的 sessionStorage，以案件編號為 key，回到同一筆會帶回，送出成功後清掉。
// 主動登出要全部清掉：櫃台共用電腦時，下一位在同一個分頁登入不能看到上一位沒送出的內容。
// 逾時被導回登入（stores/auth 的 clearSession）不清，這正是草稿要救回來的情況。
const PREFIX = 'ivy-visit-note-draft:'

export function readVisitNoteDraft(caseId: string): string {
  try {
    return window.sessionStorage.getItem(PREFIX + caseId) ?? ''
  } catch {
    return ''
  }
}

export function writeVisitNoteDraft(caseId: string, text: string): void {
  try {
    if (text.trim()) window.sessionStorage.setItem(PREFIX + caseId, text)
    else window.sessionStorage.removeItem(PREFIX + caseId)
  } catch {
    /* 瀏覽器不讓存就算了，只是少了復原 */
  }
}

export function clearVisitNoteDrafts(): void {
  try {
    const storage = window.sessionStorage
    for (const key of Object.keys(storage)) if (key.startsWith(PREFIX)) storage.removeItem(key)
  } catch {
    /* 同上 */
  }
}
