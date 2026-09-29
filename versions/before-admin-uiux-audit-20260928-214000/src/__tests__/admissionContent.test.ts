import { describe, expect, it } from 'vitest'
import { NAV_GROUPS } from '../router/nav'
import { CONTENT_KIND_LABELS, contentFieldLabel, contentPublicPath } from '../api/labels'
import { diffPayload } from '../composables/useContentItem'

describe('入學資訊（admission_content）', () => {
  it('側欄在「全站與素材」、只給 super_admin，發布後開 /admission', () => {
    const group = NAV_GROUPS.find(g => g.key === 'site')!
    const item = group.items.find(i => i.name === 'admission-content')!
    expect(group.section).toBe('官網內容')
    expect(item.path).toBe('/content/admission')
    expect(item.roles).toEqual(['super_admin'])
    expect(CONTENT_KIND_LABELS.admission_content).toBe('入學資訊')
    expect(contentPublicPath('admission_content')).toBe('/admission')
  })

  it('發布確認框的欄位都有中文名', () => {
    for (const key of ['notice', 'intro', 'steps', 'phases', 'uniform_week', 'uniform_note', 'pickup_notes', 'registration_notes',
      'fee_intro', 'subsidies', 'allowance_title', 'allowance', 'allowance_note', 'refunds']) {
      expect(contentFieldLabel(key)).not.toBe(key)
    }
    const changes = diffPayload({ notice: '舊', refunds: [] }, { notice: '', refunds: [{ title: '請假' }] })
    expect(changes.map(c => c.label)).toEqual(['頁面提醒', '退費規定'])
  })
})
