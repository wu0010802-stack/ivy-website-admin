/// <reference types="node" />
// 後端每一台狀態機（backend/app/state_machines.py）的每個狀態，後台都要有中文標籤，
// 否則畫面會直接顯示英文代碼。對照的是後端匯出的 contracts/state-machines.json：
// 後端加了新狀態、後台忘了補標籤，這個測試就會失敗。
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { STAGE_LABELS } from '../admissions/constants'
import { ROSTER_STATUS_LABELS } from '../api/auditLabels'
import { MEDIA_STATUS, PUBLISH_JOB_STATUS, REVIEW_STATUS_LABELS, VISIT_STATUS } from '../api/labels'
import facebookViewSource from '../views/FacebookPostsView.vue?raw'

interface Machine { title: string; states: Record<string, string> }
const { machines } = JSON.parse(
  readFileSync(resolve(__dirname, '../../../contracts/state-machines.json'), 'utf8'),
) as { machines: Record<string, Machine> }

const labelOf = (entry: string | { label: string }) => (typeof entry === 'string' ? entry : entry.label)

// 後台有畫面的狀態機 → 它的標籤表。outbox、轉檔工作、廣告回傳的狀態不直接顯示在後台。
const TABLES: Record<string, Record<string, string | { label: string }>> = {
  visit_request: VISIT_STATUS,
  content_revision: REVIEW_STATUS_LABELS,
  publish_job: PUBLISH_JOB_STATUS,
  media_asset: MEDIA_STATUS,
  recruitment_stage: STAGE_LABELS,
  roster_student: ROSTER_STATUS_LABELS,
}

describe('狀態機的中文標籤', () => {
  it.each(Object.keys(TABLES))('%s：每個狀態都有標籤，用字和後端登記的一樣', (key) => {
    const machine = machines[key]
    expect(machine, `contracts/state-machines.json 沒有 ${key}`).toBeTruthy()
    for (const [state, label] of Object.entries(machine!.states)) {
      const entry = TABLES[key]![state]
      expect(entry, `${machine!.title}的狀態 ${state} 沒有標籤`).toBeTruthy()
      expect(labelOf(entry!), `${machine!.title}的 ${state}`).toBe(label)
    }
  })

  it('粉專貼文的頁籤涵蓋每個狀態', () => {
    // 頁籤標籤是頁面內的常數（型別綁 FacebookPagePostState，少一個會編譯失敗）；這裡再對用字。
    for (const [state, label] of Object.entries(machines.facebook_page_post!.states)) {
      expect(facebookViewSource).toContain(`${state}: '${label}'`)
    }
  })
})
