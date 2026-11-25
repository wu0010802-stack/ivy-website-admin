// LINE 再加七項（2026-11-25，docs/specs/2026-11-25-line-more-features-design.md）的後台部分：
// 案件明細「家長回覆」一列（§7）。標籤涵蓋、時間線與操作紀錄的文字在 labelCoverage／visitTimeline／auditUx。
import { afterEach, describe, expect, it } from 'vitest'
import type { VueWrapper } from '@vue/test-utils'
import { formatDateTime } from '../api/labels'
import VisitDetailView from '../views/VisitDetailView.vue'
import { cleanup, mockGet } from './admissionsTestKit'
import { caseRoutes, mountRoutes, visitCase, VISIT_ID } from './visitCaseKit'

afterEach(cleanup)

const factLabels = (wrapper: VueWrapper) => wrapper.findAll('.case-facts dt').map((dt) => dt.text())
const factText = (wrapper: VueWrapper, label: string) =>
  wrapper.findAll('.case-facts dt').find((dt) => dt.text() === label)!.element.nextElementSibling!.textContent!.trim()

async function mountDetail(data: Record<string, unknown>) {
  const at = '2026-10-15T08:00:00Z'
  mockGet(caseRoutes(visitCase({ created_at: at, confirmed_at: at, expected_start: null, ...data })))
  return (await mountRoutes(`/visit-requests/${VISIT_ID}`, { detail: VisitDetailView })).wrapper
}

describe('案件明細：家長在 LINE 回覆會準時到', () => {
  it('已確認且有回覆：多一列「家長回覆」，寫時間與 LINE', async () => {
    const at = '2026-10-17T12:13:00Z'
    const wrapper = await mountDetail({ status: 'confirmed', parent_attendance_confirmed_at: at })
    expect(factLabels(wrapper)).toContain('家長回覆')
    expect(factText(wrapper, '家長回覆')).toBe(`會準時到（${formatDateTime(at)}，LINE）`)
  })

  it('沒有回覆、或案件已不是已確認：不列', async () => {
    expect(factLabels(await mountDetail({ status: 'confirmed', parent_attendance_confirmed_at: null }))).not.toContain('家長回覆')
    expect(
      factLabels(await mountDetail({ status: 'cancelled', cancelled_at: '2026-10-16T00:00:00Z', parent_attendance_confirmed_at: '2026-10-15T09:00:00Z' })),
    ).not.toContain('家長回覆')
  })
})
