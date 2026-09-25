// 隱私／個資使用說明（預約文案 booking_content 的 privacy_title／privacy_sections）。
// 正式條款由園方提供；後台只提供一份標了示意標記的骨架方便排版，含標記的
// 版本後端不給發布（content/registry.py 的 _booking_publish_blocker）。
import type { PrivacySectionPayload } from '../api/types'

// 與後端 content/schemas.py 的 PRIVACY_SAMPLE_MARKER、PRIVACY_SECTIONS_MAX 相同。
export const PRIVACY_SAMPLE_MARKER = '【示意】'
export const PRIVACY_SECTIONS_MAX = 12

export function privacySampleSections(): PrivacySectionPayload[] {
  const m = PRIVACY_SAMPLE_MARKER
  return [
    { heading: `${m}蒐集目的`, body: `${m}園方使用你在參觀預約表單填寫的資料，聯絡你、安排參觀並回覆你的問題。正式內容請依園方的個資告知事項填寫。` },
    { heading: `${m}蒐集的資料`, body: `${m}家長稱呼、聯絡電話、Email（選填）、孩子姓名與出生年月日、參觀人數，以及你想先了解的事。` },
    { heading: `${m}利用期間與對象`, body: `${m}請園方寫明資料保存多久、由哪些人員使用，以及是否會提供給其他單位。` },
    { heading: `${m}你的權利`, body: `${m}你可以向園方查詢、更正或要求刪除你的資料；請寫明聯絡窗口與方式。` },
  ]
}

export function privacyHasSample(payload: { privacy_title: string; privacy_sections: PrivacySectionPayload[] }): boolean {
  const texts = [payload.privacy_title, ...payload.privacy_sections.flatMap((s) => [s.heading, s.body])]
  return texts.some((text) => (text ?? '').includes(PRIVACY_SAMPLE_MARKER))
}
