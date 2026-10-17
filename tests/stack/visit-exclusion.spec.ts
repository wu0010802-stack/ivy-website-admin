import { expect, test } from '@playwright/test'
import { adminApi, findVisit, submitPublicRequest } from './api'
import { gotoAdmin, openAs, searchVisitList } from './pages'
import { SLOTS_CAMPUS } from './stack-env'

// 2026-10-15 預約案件排除：校區管理者把一筆案件標為測試 → 參觀預約統計少一筆、列表有標籤、隱藏後不見 → 取消排除後恢復。
// 送單用自己的來源 IP（每來源每校每小時 5 筆，不吃別支 spec 的額度）；統計 API 只給總管理者，所以用 super_admin 讀數字、campus_admin 在畫面上操作。
const PARENT = '排除測試家長'

test('校區管理者標記排除與取消排除', async ({ browser }) => {
  await submitPublicRequest(SLOTS_CAMPUS, PARENT, '0912000633', { forwardedFor: '198.51.100.63' })
  const api = await adminApi('super_admin')
  const visit = await findVisit(api, PARENT)
  // 預約正常、場次在一週後：排除對話框才會提醒「排除不會釋出名額」。
  expect(visit.status).toBe('confirmed')

  // 義華校在參觀預約統計的「案件數」與「已排除」；不限期間，剛送出的這筆算在案件數裡。
  const counts = async (): Promise<{ cases: number; excluded: number }> => {
    const body = await api.get<{ campuses: { campus_key: string; cases: number; excluded_cases: number }[] }>('/admin/analytics/booking-outcomes')
    const row = body.campuses.find((campus) => campus.campus_key === SLOTS_CAMPUS)
    expect(row, `統計裡找不到 ${SLOTS_CAMPUS}`).toBeTruthy()
    return { cases: row!.cases, excluded: row!.excluded_cases }
  }
  const before = await counts()
  expect(before.cases).toBeGreaterThanOrEqual(1)
  const { context, page } = await openAs(browser, 'campus_admin')

  await test.step('明細標記為排除（測試）', async () => {
    await gotoAdmin(page, `/visit-requests/${visit.id}`, '案件明細')
    await expect(page.locator('.exclusion-banner')).toHaveCount(0)
    await page.getByRole('button', { name: /標記為排除/ }).click()
    const dialog = page.locator('.exclusion-dialog')
    await expect(dialog).toContainText('排除不會釋出名額')
    // 原因預設「測試」。
    await expect(dialog.getByRole('radio', { name: '測試' })).toBeChecked()
    await dialog.getByRole('button', { name: '標記為排除' }).click()
    await expect(page.locator('.exclusion-banner')).toContainText('已排除：測試')
    await expect(dialog).toBeHidden()
    // 入口那一列收起後焦點不能掉到頁面最上面（跳到主要內容）：移到橫幅；對話框關閉的焦點歸還也不會再搶走。
    await expect(page.locator('.exclusion-banner')).toBeFocused()
  })
  expect(await counts()).toEqual({ cases: before.cases - 1, excluded: before.excluded + 1 })

  await test.step('列表有標籤；勾「隱藏已排除」後不見', async () => {
    await gotoAdmin(page, '/visit-requests?group=all', '參觀案件')
    await searchVisitList(page, PARENT)
    const row = page.locator('.visit-row', { hasText: PARENT })
    await expect(row.locator('.visit-row__excluded')).toHaveText('已排除・測試')
    // 「隱藏已排除」收在「更多篩選」裡：先展開。等帶 excluded=hide 的查詢回來，才算「隱藏後」。
    await page.getByRole('button', { name: /更多篩選/ }).click()
    const hidden = page.waitForResponse((response) => {
      if (response.request().method() !== 'GET') return false
      const url = new URL(response.url())
      return url.pathname.endsWith('/admin/visit-requests') && url.searchParams.get('excluded') === 'hide'
    })
    // Element Plus 的原生 input 是視覺隱藏的：點外層 label（和別支 spec 勾 el-checkbox 的寫法一致）。
    await page.locator('.el-checkbox', { hasText: '隱藏已排除' }).click()
    await hidden
    await expect(page.getByRole('checkbox', { name: '隱藏已排除' })).toBeChecked()
    await expect(page).toHaveURL(/excluded=hide/)
    await expect(row).toHaveCount(0)
  })

  await test.step('取消排除後恢復', async () => {
    await gotoAdmin(page, `/visit-requests/${visit.id}`, '案件明細')
    await page.locator('.exclusion-banner').getByRole('button', { name: '取消排除' }).click()
    await expect(page.locator('.exclusion-banner')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /標記為排除/ })).toBeVisible()
    // 橫幅收起後焦點移到回來的入口。
    await expect(page.getByRole('button', { name: /標記為排除/ })).toBeFocused()
  })
  expect(await counts()).toEqual(before)
  await Promise.all([context.close(), api.dispose()])
})
