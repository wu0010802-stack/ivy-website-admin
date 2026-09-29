import { describe, expect, it, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { useAuthStore } from '../stores/auth'
import { useCampusScope } from '../composables/useCampusScope'
import { testUser } from './fixtures'

describe('useCampusScope', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('總管理者看得到五校並預選第一校', () => {
    const auth = useAuthStore()
    auth.user = testUser('super_admin', { id: '1', email: 'a@b', campus_keys: [] })
    const scope = useCampusScope()
    expect(scope.visibleCampusKeys.value).toHaveLength(5)
    expect(scope.selected.value).toBe('yihua')
    expect(scope.isSuperAdmin.value).toBe(true)
  })

  it('校區管理者只看到自己的校區，換帳號時選取值跟著修正', async () => {
    const auth = useAuthStore()
    auth.user = testUser('campus_admin', { id: '2', email: 'c@d', campus_keys: ['renwu'] })
    const scope = useCampusScope()
    expect(scope.visibleCampusKeys.value).toEqual(['renwu'])
    expect(scope.selected.value).toBe('renwu')

    auth.user = testUser('campus_admin', { id: '3', email: 'e@f', campus_keys: ['minghua', 'chongde'] })
    await nextTick()
    expect(scope.selected.value).toBe('minghua')
  })

  it('autoSelect 關閉時維持空字串（列表頁的「全部校區」）', () => {
    const auth = useAuthStore()
    auth.user = testUser('super_admin', { id: '1', email: 'a@b', campus_keys: [] })
    const scope = useCampusScope({ autoSelect: false })
    expect(scope.selected.value).toBe('')
  })
})
