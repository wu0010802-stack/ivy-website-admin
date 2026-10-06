// 來源分類收斂（2026-10-06）：資料照存園務九類代碼，表單只列六項短標籤，不列的三類舊資料照樣顯示。
import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import RecordDialog from '../components/admissions/RecordDialog.vue'
import FamilyAdmissionsData from '../components/visit/FamilyAdmissionsData.vue'
import { SOURCE_CATEGORY_CHOICES, sourceCategoryLabel, sourceCategoryOptions } from '../admissions/sourceCategories'
import { cleanup, mockGet, mockPatch, mountWith, options, visit } from './admissionsTestKit'

afterEach(cleanup)

// 園務九類的代碼與原文以後端 constants.py 為準（vitest.config.ts 已放行 ../backend/app 的 ?raw 讀取）。
const backend = import.meta.glob('../../../backend/app/admissions/constants.py', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const source = Object.values(backend)[0] ?? ''
const block = source.slice(source.indexOf('SOURCE_CATEGORIES:'), source.indexOf('}', source.indexOf('SOURCE_CATEGORIES:')))
const IVY_LABELS = Object.fromEntries([...block.matchAll(/"(\w+)":\s*"([^"]+)"/g)].map((m) => [m[1]!, m[2]!]))

const SIX = ['在校生弟妹', '畢業生弟妹', '家長介紹／社區招生', '自報生（廣告、鄰居、網路、活動）', '邀約來園', '舊生復學']

describe('六項選單', () => {
  it('讀得到後端九類；六項代碼都在裡面，不列的剛好是三類獎金分配', () => {
    expect(Object.keys(IVY_LABELS)).toHaveLength(9)
    const codes = SOURCE_CATEGORY_CHOICES.map(([code]) => code)
    expect(codes.filter((code) => !(code in IVY_LABELS))).toEqual([])
    expect(Object.keys(IVY_LABELS).filter((code) => !codes.includes(code as never))).toEqual(['sibling_split', 'invite_origin', 'home_deposit'])
    expect(SOURCE_CATEGORY_CHOICES.map(([, label]) => label)).toEqual(SIX)
  })

  it('文字：六項用短標籤，不列的三類用園務原文，都查不到就顯示代碼', () => {
    expect(sourceCategoryLabel('referral', IVY_LABELS)).toBe('家長介紹／社區招生')
    expect(sourceCategoryLabel('home_deposit', IVY_LABELS)).toBe('到家中收預繳')
    expect(sourceCategoryLabel('home_deposit', null)).toBe('home_deposit')
  })

  it('下拉：不列的代碼只有這筆正在用時才附在最後，同一個只附一次', () => {
    expect(sourceCategoryOptions([null, 'referral'], IVY_LABELS).map(([, label]) => label)).toEqual(SIX)
    expect(sourceCategoryOptions(['invite_origin', 'invite_origin'], IVY_LABELS).slice(6)).toEqual([['invite_origin', '邀約來園——原本招生人']])
  })
})

const byPlaceholder = (wrapper: VueWrapper, placeholder: string) =>
  wrapper.findAllComponents({ name: 'ElSelect' }).find((component) => component.props('placeholder') === placeholder)!
const optionLabels = (wrapper: VueWrapper) =>
  byPlaceholder(wrapper, '請選擇來源分類').findAllComponents({ name: 'ElOption' }).map((option) => option.props('label'))
const bodyButton = (text: string) =>
  [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((element) => element.textContent?.trim() === text)

async function openDialog(props: Record<string, unknown>) {
  const all = { ...options(), source_categories: IVY_LABELS }
  const mounted = await mountWith(RecordDialog, { props: { modelValue: false, campusKey: 'yihua', options: all, ...props } })
  await mounted.wrapper.setProps({ modelValue: true })
  await flushPromises()
  return mounted
}

describe('訪視表單的來源分類', () => {
  it('新增時下拉只列六項短標籤', async () => {
    const { wrapper } = await openDialog({ mode: 'add', record: null })
    expect(optionLabels(wrapper)).toEqual(SIX)
  })

  it('舊資料選過不列的類別：附在最後顯示園務原文，沒改就不送', async () => {
    const patch = mockPatch({ '/admin/admissions/records/v-1': visit({ version: 3 }) })
    const { wrapper } = await openDialog({ mode: 'edit', record: visit({ version: 2, source_category: 'home_deposit' }) })
    expect(optionLabels(wrapper)).toEqual([...SIX, '到家中收預繳'])
    expect(byPlaceholder(wrapper, '請選擇來源分類').props('modelValue')).toBe('home_deposit')

    byPlaceholder(wrapper, '請選擇來源分類').vm.$emit('update:modelValue', 'referral')
    await flushPromises()
    expect(optionLabels(wrapper).at(-1)).toBe('到家中收預繳')
    byPlaceholder(wrapper, '請選擇來源分類').vm.$emit('update:modelValue', 'home_deposit')
    await flushPromises()
    bodyButton('儲存')!.click()
    await flushPromises()
    expect(patch).not.toHaveBeenCalled()
  })
})

describe('家庭版面的來源分類', () => {
  it('六項顯示短標籤，不列的類別顯示園務原文', async () => {
    mockGet({})
    const panel = { months: [], sources: [], referrers: [], grades: [], no_deposit_reasons: [], contact_channels: {}, source_categories: IVY_LABELS }
    const valueOf = (wrapper: VueWrapper) => {
      const index = wrapper.findAll('.el-descriptions__label').findIndex((cell) => cell.text() === '來源分類')
      return wrapper.findAll('.el-descriptions__content')[index]?.text()
    }
    const short = await mountWith(FamilyAdmissionsData, { props: { visit: visit({ source_category: 'self_report' }), options: panel, editable: false } })
    expect(valueOf(short.wrapper)).toBe('自報生（廣告、鄰居、網路、活動）')
    cleanup()
    const hidden = await mountWith(FamilyAdmissionsData, { props: { visit: visit({ source_category: 'sibling_split' }), options: panel, editable: false } })
    expect(valueOf(hidden.wrapper)).toBe('在校兄姊二人均分')
  })
})
