import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { NAV_GROUPS } from '../router/nav'
import { CONTENT_KIND_LABELS, contentEditorPath, contentFieldLabel, contentPreviewPath, contentPublicPath } from '../api/labels'
import { contentFieldLabelFor } from '../api/contentFieldLabels'
import {
  PRIVACY_POLICY_PENDING_MARKER,
  PRIVACY_POLICY_SECTIONS_MAX,
  privacyPolicyDraft,
  privacyPolicyPendingCount,
} from '../composables/privacyPolicyDraft'

describe('隱私權政策（privacy_policy）', () => {
  it('側欄在「全站與素材」、只給 super_admin，標籤與網址對得上', () => {
    const group = NAV_GROUPS.find((g) => g.key === 'site')!
    const item = group.items.find((i) => i.name === 'privacy-policy')!
    expect(item.path).toBe('/content/privacy-policy')
    expect(item.roles).toEqual(['super_admin'])
    expect(item.shared).toBe(true)
    expect(CONTENT_KIND_LABELS.privacy_policy).toBe('隱私權政策')
    expect(contentPublicPath('privacy_policy')).toBe('/privacy')
    expect(contentPreviewPath('privacy_policy')).toBe('/preview?page=privacy')
    expect(contentEditorPath('privacy_policy')).toBe('/content/privacy-policy')
  })

  it('發布確認框的欄位有中文名', () => {
    expect(contentFieldLabelFor('privacy_policy', 'title')).toBe('標題')
    expect(contentFieldLabelFor('privacy_policy', 'updated_on')).toBe('最後更新日期')
    expect(contentFieldLabelFor('privacy_policy', 'sections')).toBe('政策段落')
    expect(contentFieldLabel('updated_on')).not.toBe('updated_on')
  })

  it('初稿：12 段、標題與後端預設一致、更新日期留空、有 9 處待確認', () => {
    const draft = privacyPolicyDraft()
    expect(draft.title).toBe('隱私權政策')
    expect(draft.updated_on).toBeNull()
    expect(draft.sections).toHaveLength(12)
    expect(draft.sections.length).toBeLessThanOrEqual(PRIVACY_POLICY_SECTIONS_MAX)
    expect(privacyPolicyPendingCount(draft)).toBe(9)
    for (const section of draft.sections) {
      expect(section.heading.trim()).not.toBe('')
      expect(section.body.trim()).not.toBe('')
      expect(section.heading.length).toBeLessThanOrEqual(60)
      expect(section.body.length).toBeLessThanOrEqual(2000)
    }
  })

  it('待確認計數：標題與各段都算，補完後歸零', () => {
    const draft = privacyPolicyDraft()
    draft.title = `隱私權政策${PRIVACY_POLICY_PENDING_MARKER}：x】`
    expect(privacyPolicyPendingCount(draft)).toBe(10)
    const cleaned = {
      title: '隱私權政策',
      updated_on: '2026-10-03',
      sections: draft.sections.map((s) => ({ heading: s.heading, body: s.body.replaceAll(PRIVACY_POLICY_PENDING_MARKER, '已補') })),
    }
    expect(privacyPolicyPendingCount(cleaned)).toBe(0)
  })

  it('編輯畫面：標題與段落小標都顯示字數計數', () => {
    const source = readFileSync(resolve(__dirname, '../views/PrivacyPolicyView.vue'), 'utf8')
    for (const limit of ['40', '60']) {
      expect(source).toMatch(new RegExp(`maxlength="${limit}"[^>]*show-word-limit|show-word-limit[^>]*maxlength="${limit}"`))
    }
  })
})
