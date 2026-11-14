import { expect, test, type Locator, type Page } from '@playwright/test'
import { currentTerm, gradeForBirthday } from '../../admin/src/admissions/academic'
import { adminApi, taipeiDate } from './api'
import { expectNoHorizontalOverflow, gotoAdmin, openAs } from './pages'
import { SLOTS_CAMPUS } from './stack-env'

// 招生入學「編班與缺額」（2026-11-15）：新增班級 → 格內貼上名單 → 看板轉預繳後出現在「還沒編班」→ 拖進班級 →
// 已入園 → 缺額數字 → 統計日期往回調 → 存結算紀錄 → 手機版沒有橫向溢出、選單有「移到其他班級」。
// 姓名全是虛構的。每一步都在畫面上操作；API 只用來建看板紀錄與核對。
// stack 每次重建資料庫，本 spec 是唯一建編班資料的；班序用「幼9」避開別的 spec。

const CLASS_NAME = '編班流程班'
const CLASS_CODE = '幼9'
const KIDS = ['編班流程幼生甲', '編班流程幼生乙', '編班流程幼生丙']
const DEPOSITOR = '編班流程預繳生'
const TERM = currentTerm(taipeiDate(0))
// 幼幼班：入學學年 9/1 剛滿 2 歲。
const BIRTHDAY = `${TERM.schoolYear + 1911 - 2}-03-15`

const UI = { moveMenu: /移到/ }

/** 表尾某一列（合計／目標／缺額…）的文字。 */
const footRow = (page: Page, label: string) => page.locator('table.roster-table tfoot tr', { has: page.locator('th', { hasText: label }) }).first()
/** 缺額統計表某一列的合計（最後一欄）。 */
const gapTotal = (page: Page, label: string) => page.locator('.roster-gap tbody tr', { has: page.locator('th', { hasText: label }) }).first().locator('td').last()

async function classId(page: Page): Promise<string> {
  const id = await page.locator('table.roster-table th[data-class-id]', { hasText: `${CLASS_NAME}(${CLASS_CODE})` }).getAttribute('data-class-id')
  expect(id).toBeTruthy()
  return id!
}
const nameCell = (page: Page, id: string, index: number): Locator => page.locator(`td.roster-name[data-class-id="${id}"][data-index="${index}"]`)

test('新增班級 → 貼上名單 → 看板轉預繳 → 拖進班級 → 已入園 → 回算 → 結算紀錄 → 手機版', async ({ browser }) => {
  test.setTimeout(180_000)
  expect(gradeForBirthday(BIRTHDAY, TERM.schoolYear)).toBe('幼幼班')
  const api = await adminApi('campus_admin')
  const { context, page } = await openAs(browser, 'campus_admin')
  const rosterUrl = `/admissions?campus=${SLOTS_CAMPUS}&tab=roster`

  await test.step('新增班級「編班流程班(幼9)」，目標 16', async () => {
    await gotoAdmin(page, rosterUrl, '招生入學')
    await expect(page.getByRole('tab', { name: '編班與缺額', selected: true })).toBeVisible()
    await page.getByRole('button', { name: '新增班級', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '新增班級' })
    await dialog.getByLabel('年級').selectOption('幼幼班')
    await dialog.getByLabel('班序').fill(CLASS_CODE)
    await dialog.getByLabel('班級名稱').fill(CLASS_NAME)
    await dialog.getByLabel('目標人數').fill('16')
    await dialog.getByRole('button', { name: '新增班級', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(page.locator('table.roster-table th[data-class-id]', { hasText: `${CLASS_NAME}(${CLASS_CODE})` })).toBeVisible()
  })

  const id = await classId(page)

  await test.step('在班級最後一格逐位輸入三個姓名：合計 3、缺額 −13', async () => {
    await nameCell(page, id, 0).click()
    for (const name of KIDS) {
      const input = page.getByLabel('新增幼生姓名')
      await input.fill(name)
      await input.press('Enter')
    }
    await page.getByLabel('新增幼生姓名').press('Escape')
    for (const [index, name] of KIDS.entries()) await expect(nameCell(page, id, index)).toContainText(name)
    await expect(footRow(page, '合計')).toContainText('3')
    await expect(footRow(page, '缺額')).toContainText('−13')
  })

  await test.step('看板：把一張幼幼班卡片移到「已預繳」', async () => {
    await api.send('POST', `/admin/admissions/records?campus_key=${SLOTS_CAMPUS}`, {
      visit_date: taipeiDate(0), child_name: DEPOSITOR, birthday: BIRTHDAY, grade: '幼幼班', target_school_year: TERM.schoolYear, target_semester: TERM.semester,
    })
    await gotoAdmin(page, `/admissions?campus=${SLOTS_CAMPUS}&tab=funnel`, '招生入學')
    const card = page.locator('[draggable="true"]', { hasText: DEPOSITOR })
    await card.hover()
    await card.getByRole('button', { name: UI.moveMenu }).click()
    await page.getByRole('menuitem', { name: '已預繳', exact: true }).click()
    const confirm = page.getByRole('dialog', { name: '已訪視 → 已預繳' })
    await expect(confirm).toContainText(DEPOSITOR)
    await confirm.getByRole('button', { name: '移到已預繳', exact: true }).click()
    await expect(confirm).toBeHidden()
  })

  await test.step('回編班與缺額：預繳生在「還沒編班」；拖進班級後合計 4', async () => {
    await gotoAdmin(page, rosterUrl, '招生入學')
    const chip = page.locator('[data-roster-tray] .roster-chip', { hasText: DEPOSITOR })
    await expect(chip).toBeVisible()
    await expect(chip).toContainText('幼幼班')
    await chip.dragTo(nameCell(page, id, 3))
    await expect(nameCell(page, id, 3)).toContainText(DEPOSITOR)
    await expect(page.locator('[data-roster-tray] .roster-chip', { hasText: DEPOSITOR })).toHaveCount(0)
    await expect(footRow(page, '合計')).toContainText('4')
  })

  let enrolledBefore = 0
  let estimateBefore = 0
  await test.step('點姓名「已入園」：目前在籍多 1，預估不變', async () => {
    enrolledBefore = Number(await gapTotal(page, '目前在籍').innerText())
    estimateBefore = Number(await gapTotal(page, '預估人數').first().innerText())
    await page.locator('button.roster-kid', { hasText: DEPOSITOR }).click()
    await page.getByRole('menuitem', { name: '已入園', exact: true }).click()
    await expect(gapTotal(page, '目前在籍')).toHaveText(String(enrolledBefore + 1))
    await expect(gapTotal(page, '預估人數').first()).toHaveText(String(estimateBefore))
    await expect(nameCell(page, id, 3).locator('xpath=..')).not.toHaveClass(/is-pending/)
  })

  await test.step('統計日期改成昨天：在籍比今天少 1；存成結算紀錄', async () => {
    await page.getByLabel('統計日期').fill(taipeiDate(-1))
    await expect(page.locator('.roster-gap-note')).toContainText('這是回算到')
    await expect(gapTotal(page, '在籍（截至')).toHaveText(String(enrolledBefore))
    await expect(page.locator('.roster-snaps tbody tr')).toHaveCount(0)
    await page.getByRole('button', { name: '存成結算紀錄', exact: true }).click()
    await expect(page.locator('.roster-snaps tbody tr')).toHaveCount(1)
    await page.getByRole('button', { name: '今天', exact: true }).click()
    await expect(page.locator('.roster-gap-note')).not.toContainText('這是回算到')
  })

  await test.step('手機寬 390：頁面不橫向溢出，選單有「移到其他班級」', async () => {
    const phone = await openAs(browser, 'campus_admin', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    try {
      await gotoAdmin(phone.page, rosterUrl, '招生入學')
      await expect(phone.page.locator('table.roster-table')).toBeVisible()
      await expectNoHorizontalOverflow(phone.page)
      // 還有別的班才有可移的目的班：先多開一個班。
      await api.send('POST', `/admin/admissions/roster/classes?campus_key=${SLOTS_CAMPUS}`, {
        school_year: TERM.schoolYear, grade: '幼幼班', name: '編班流程第二班', class_code: '幼8',
      })
      await phone.page.reload()
      await expect(phone.page.locator('table.roster-table')).toBeVisible()
      await phone.page.locator('button.roster-kid', { hasText: KIDS[0]! }).tap()
      await expect(phone.page.getByRole('menu').getByLabel('移到其他班級')).toBeVisible()
    } finally {
      await phone.context.close()
    }
  })

  await Promise.all([context.close(), api.dispose()])
})
