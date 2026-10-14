// 案件聯絡紀錄的草稿（2026-09-29）：寫到一半被打斷（閒置逾時被導回登入、換頁）時先存在
// 這個分頁的 sessionStorage，以案件編號為 key，回到同一筆會帶回，送出成功後清掉。
// 主動登出要全部清掉：櫃台共用電腦時，下一位在同一個分頁登入不能看到上一位沒送出的內容。
// 逾時被導回登入（stores/auth 的 clearSession）不清，這正是草稿要救回來的情況。
//
// 草稿的主人（2026-10-13 審查）：stores/auth 的 previousUserId 只在記憶體，逾時後重新整理就沒了，
// 另一位登入時分辨不出草稿是上一位的。所以主人也記在 sessionStorage：登入或恢復成功時
// claimVisitNoteDrafts(目前使用者)，主人不同就清掉前一位的草稿。
const PREFIX = 'ivy-visit-note-draft:'
const OWNER_KEY = 'ivy-visit-note-draft-owner'

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

function removeDrafts(storage: Storage): void {
  for (const key of Object.keys(storage)) if (key.startsWith(PREFIX)) storage.removeItem(key)
}

/** 主動登出：草稿與主人一起清掉。 */
export function clearVisitNoteDrafts(): void {
  try {
    const storage = window.sessionStorage
    removeDrafts(storage)
    storage.removeItem(OWNER_KEY)
  } catch {
    /* 同上 */
  }
}

/**
 * 登入或恢復成功時呼叫：這個分頁的草稿從現在起屬於 userId。上一位留下的（主人不同）清掉；
 * 主人相同（同一個人逾時後登回來）保留；還沒有主人（上線前寫下的草稿）歸給第一位登入的人。
 */
export function claimVisitNoteDrafts(userId: string): void {
  try {
    const storage = window.sessionStorage
    const owner = storage.getItem(OWNER_KEY)
    if (owner !== null && owner !== userId) removeDrafts(storage)
    storage.setItem(OWNER_KEY, userId)
  } catch {
    /* 同上 */
  }
}
