// 由 backend/scripts/export_state_machines.py 產生，來源是 backend/app/state_machines.py。不要手改；改登記表後跑 npm run contract:generate。

/** 預約參觀案件 */
export type VisitRequestState = 'confirmed' | 'cancelled' | 'no_show' | 'completed'

/** 通知 outbox */
export type OutboxMessageState = 'pending' | 'leased' | 'sent' | 'failed' | 'skipped'

/** 內容版本的審核狀態 */
export type ContentRevisionState = 'draft' | 'pending_review' | 'approved' | 'rejected' | 'superseded'

/** 排程發布 */
export type PublishJobState = 'scheduled' | 'done' | 'failed' | 'skipped' | 'cancelled'

/** 素材 */
export type MediaAssetState = 'processing' | 'ready' | 'failed'

/** 影片轉檔工作 */
export type MediaJobState = 'pending' | 'running' | 'done' | 'failed'

/** 招生訪視的階段 */
export type RecruitmentStageState = 'visited' | 'deposited' | 'enrolled' | 'withdrawn'

/** 編班的幼生 */
export type RosterStudentState = 'pending' | 'enrolled' | 'left' | 'refunded'

/** 廣告轉換回傳 */
export type AdConversionJobState = 'pending' | 'sent' | 'failed' | 'skipped'

/** 粉專貼文收件匣 */
export type FacebookPagePostState = 'new' | 'imported' | 'dismissed'

/** 家長管理連結與 session（由欄位推導，不是存的值） */
export type ParentAccessState = 'active' | 'expired' | 'revoked'

/** 參觀場次（由欄位推導，不是存的值） */
export type VisitSlotState = 'open' | 'closed_manual' | 'closed_exception' | 'closed_rule'

/** 後台登入 session（由欄位推導，不是存的值） */
export type AdminSessionState = 'usable' | 'expired' | 'revoked'

/** 重設密碼連結（由欄位推導，不是存的值） */
export type PasswordResetTokenState = 'usable' | 'used' | 'revoked' | 'expired'

/** 後台帳號（由欄位推導，不是存的值） */
export type UserAccountState = 'active' | 'inactive'

/** 素材的刪除（由欄位推導，不是存的值） */
export type MediaDeletionState = 'kept' | 'pending_purge'

/** 沒發布的排程是否已處理（由欄位推導，不是存的值） */
export type PublishJobResolutionState = 'unresolved' | 'resolved'

/** 錯誤回報分組（由欄位推導，不是存的值） */
export type ErrorGroupState = 'open' | 'resolved'
