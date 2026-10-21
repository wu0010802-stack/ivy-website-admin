// 資料匯入（2026-10-21 規格 §7）：目前資料、在籍清冊與歷年註冊的選檔 → 預覽 → 確認、清除、換校區與各種錯誤，
// 以及招生統計的子分頁 sub=imports。只用合成資料（假姓名「測試小明」、假地址），不開任何真的清冊或統計表。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { ElDatePicker, ElMessage, ElMessageBox } from 'element-plus'
import * as XLSX from 'xlsx'
import ImportsTab from '../components/admissions/imports/ImportsTab.vue'
import EnrolledImportCard from '../components/admissions/imports/EnrolledImportCard.vue'
import HistoryImportCard from '../components/admissions/imports/HistoryImportCard.vue'
import StatsTab from '../components/admissions/StatsTab.vue'
import AdmissionsStatsView from '../views/AdmissionsStatsView.vue'
import { ApiError } from '../api/client'
import { HistoryFileError, readHistoryWorkbook, type HistorySheetGrid } from '../admissions/imports/historyWorkbook'
import { STATS_SUBS } from '../admissions/useAdmissionsFilters'
import {
  bodyOf, button, cleanup, deferred, enrolledPreview, hasButton, historyPreview, importStatus, mockDelete, mockGet, mockPost, mountWith,
  options, pathsTo, queryOf,
} from './admissionsTestKit'

// 統計表的擷取（SheetJS）由測試直接給結果；HistoryFileError 用真的。
vi.mock('../admissions/imports/historyWorkbook', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../admissions/imports/historyWorkbook')>()),
  readHistoryWorkbook: vi.fn(),
}))

afterEach(() => {
  vi.mocked(readHistoryWorkbook).mockReset()
  cleanup()
})

const STATUS = '/admin/admissions/imports/status'
const ENROLLED = '/admin/admissions/imports/enrolled'
const ENROLLED_PREVIEW = '/admin/admissions/imports/enrolled/preview'
const ENROLLED_APPLY = '/admin/admissions/imports/enrolled/apply'
const HISTORY_PREVIEW = '/admin/admissions/imports/history/preview'
const HISTORY_APPLY = '/admin/admissions/imports/history/apply'
const INSTITUTION = '高雄市私立常春藤測試幼兒園'

// 仿教保資訊網「園所幼生清冊」匯出檔：抬頭一張表、名冊一張表，姓名與生日都是假的。
// 10/15 列印＝115 學年：2022/05/10 生是中班、2023/03/01 生是小班。
function rosterHtml({ printed = '2026/10/15' }: { printed?: string | null } = {}): string {
  const printedRow = printed === null ? '' : `<tr><td>列印日期：${printed}</td></tr>`
  const rows = [
    ['1', '測試小明', '2022/05/10', '本揚里1鄰義華路68號'],
    ['2', '測試小華', '2023/03/01', '高雄市三民區義華路999號'],
  ]
  const body = rows.map((cells) => `<tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')
  return (
    `<table><tr><td>${INSTITUTION}</td></tr>${printedRow}</table>` +
    `<table><tr><td>編號</td><td>幼生姓名</td><td>出生日期</td><td>通訊地址</td></tr>${body}</table>`
  )
}

// jsdom 的 File 沒有 text()／arrayBuffer()（瀏覽器有），這裡補上。
function fileOf(content: string, name: string): File {
  const bytes = new TextEncoder().encode(content)
  return Object.assign(new File([content], name), { text: async () => content, arrayBuffer: async () => bytes.buffer })
}

async function pick(wrapper: VueWrapper, test: 'enrolled-file' | 'history-file', file: File) {
  const input = wrapper.get(`[data-test="${test}"]`).element as HTMLInputElement
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  input.dispatchEvent(new Event('change'))
  await flushPromises()
}

async function mountImports(status = importStatus(), props: Record<string, unknown> = {}) {
  const get = mockGet({ [STATUS]: status })
  const mounted = await mountWith(ImportsTab, { props: { campusKey: 'yihua', active: true, ...props } })
  return { ...mounted, get }
}

const enrolledCard = (wrapper: VueWrapper) => wrapper.get('[data-test="enrolled-card"]')
const historyCard = (wrapper: VueWrapper) => wrapper.get('[data-test="history-card"]')
const confirmButton = (wrapper: VueWrapper, card: 'enrolled' | 'history') =>
  button(wrapper.get(`[data-test="${card}-card"]`), '確認匯入')

// ElMessageBox.confirm 的訊息是 VNode：把裡面的字串接起來。
const textOf = (node: unknown): string => {
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(textOf).join('\n')
  if (node && typeof node === 'object' && 'children' in node) return textOf((node as { children: unknown }).children)
  return ''
}
const confirmed = () => vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
// 全域提示（notifyError 走 ElMessage.error）收到的訊息。
const errorToasts = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map(([options]) => String((options as { message: unknown }).message))

// 選好檔、按確認匯入，對話框開著時頁首換到明華，再按下對話框的確認；回傳全域錯誤提示的 spy。
async function confirmAfterCampusSwitch(card: 'enrolled' | 'history', pickFile: (wrapper: VueWrapper) => Promise<void>) {
  const answer = deferred<unknown>()
  vi.spyOn(ElMessageBox, 'confirm').mockReturnValue(answer.promise as never)
  const toast = vi.spyOn(ElMessage, 'error')
  const { wrapper } = await mountImports()
  await pickFile(wrapper)
  await confirmButton(wrapper, card)!.trigger('click')
  await wrapper.setProps({ campusKey: 'minghua' })
  await flushPromises()
  expect(wrapper.text()).not.toContain('匯入到：義華')
  answer.resolve('confirm')
  await flushPromises()
  return toast
}

const SHEETS: HistorySheetGrid[] = [
  { name: '115上', width: 3, rows: { '2': ['目標人數', null, '1150915'], '3': [null, null, '註冊人數'], '4': ['大班', 70, 58] } },
]

describe('資料匯入：目前資料', () => {
  it('依頁首校區讀匯入狀態', async () => {
    const { wrapper, get } = await mountImports()
    const [path] = pathsTo(get, STATUS)
    expect(Object.fromEntries(queryOf(path!))).toEqual({ campus_key: 'yihua' })

    const enrolled = enrolledCard(wrapper).get('[data-test="enrolled-current"]').text()
    expect(enrolled).toContain('2026/09/15')
    expect(enrolled).toContain('115 學年')
    expect(enrolled).toContain('190 位（有點 178 位）')
    expect(enrolled).toContain('115 年 10 月版')
    expect(enrolled).not.toContain('門牌已換版')
    const history = historyCard(wrapper).get('[data-test="history-current"]').text()
    expect(history).toContain('99上～114下')
    expect(history).toContain('128 列')
    expect(enrolledCard(wrapper).text()).toContain('只會送出地址和班別，地址比對完不保存。')
    expect(historyCard(wrapper).text()).toContain('只會送出表頭和各年級的數字。')
  })

  it('沒有資料時寫「還沒有匯入」', async () => {
    const { wrapper } = await mountImports(importStatus({ enrolled: null, history: null }))
    expect(enrolledCard(wrapper).get('[data-test="enrolled-current"]').text()).toBe('還沒有匯入')
    expect(historyCard(wrapper).get('[data-test="history-current"]').text()).toBe('還沒有匯入')
    // 沒有資料就沒有東西可以清
    expect(hasButton(wrapper, '清除這校在籍資料')).toBe(false)
  })

  it('門牌換版時提醒可以重新上傳', async () => {
    const { wrapper } = await mountImports(importStatus({ active_doorplate_version: '115-11' }))
    expect(enrolledCard(wrapper).text()).toContain('門牌已換版，可以重新上傳清冊。')
  })

  it('讀取失敗：錯誤與重新載入；不在這個子分頁時不讀，回來才讀', async () => {
    let fail = true
    const get = mockGet({ [STATUS]: () => { if (fail) throw new Error('network'); return importStatus() } })
    const { wrapper } = await mountWith(ImportsTab, { props: { campusKey: 'yihua', active: false } })
    expect(pathsTo(get, STATUS)).toEqual([])
    await wrapper.setProps({ active: true })
    await flushPromises()
    expect(wrapper.get('.inline-error').text()).toContain('無法讀取目前的匯入資料')
    fail = false
    await button(wrapper, '重新載入')!.trigger('click')
    await flushPromises()
    expect(pathsTo(get, STATUS)).toHaveLength(2)
    expect(wrapper.find('[data-test="enrolled-card"]').exists()).toBe(true)
  })
})

describe('資料匯入：在籍清冊', () => {
  it('選清冊後只送班別與地址並顯示預覽', async () => {
    const { wrapper } = await mountImports()
    const post = mockPost({ [ENROLLED_PREVIEW]: enrolledPreview() })
    await pick(wrapper, 'enrolled-file', fileOf(rosterHtml(), '清冊.xls'))

    const [path] = pathsTo(post, ENROLLED_PREVIEW)
    expect(Object.fromEntries(queryOf(path!))).toEqual({ campus_key: 'yihua' })
    const body = bodyOf(post, ENROLLED_PREVIEW)
    expect(body).toEqual({
      roster_date: '2026-10-15',
      students: [{ grade: '小班', address: '高雄市三民區義華路999號' }, { grade: '中班', address: '本揚里1鄰義華路68號' }],
    })
    const sent = JSON.stringify(body)
    for (const secret of ['測試小明', '測試小華', '2022/05/10', '2022-05-10', '2023/03/01', '2023-03-01', INSTITUTION]) expect(sent).not.toContain(secret)

    const preview = enrolledCard(wrapper).get('[data-test="enrolled-preview"]')
    expect(preview.get('.import-target').text()).toBe('匯入到：義華')
    expect(preview.text()).toContain(`檔案上的園所：${INSTITUTION}`)
    expect(preview.text()).toContain('目前：2026/09/15・190 位 → 新的：2026/10/15・20 位')
    expect(preview.text()).toContain('共 20 位，有點 18 位（90.0%）')
    expect(preview.text()).toContain('幼幼班 4、小班 5、中班 5、大班 6')
    expect(preview.text()).toContain('精確門牌 15、鄰近門牌 3、只對到里 1、對不到 1')
    expect(preview.text()).toContain('推定 2 位')
    const unplaced = preview.findAll('[data-test="enrolled-unplaced"] tbody tr').map((row) => row.findAll('td').map((cell) => cell.text()))
    expect(unplaced).toEqual([['只對到里', '—', '義華路…'], ['對不到', '非高雄市地址', '—']])
    expect(confirmButton(wrapper, 'enrolled')!.attributes('disabled')).toBeUndefined()
  })

  it('清冊上沒有園所名稱時不寫「檔案上的園所」', async () => {
    const { wrapper } = await mountImports()
    mockPost({ [ENROLLED_PREVIEW]: enrolledPreview() })
    await pick(wrapper, 'enrolled-file', fileOf(rosterHtml().replace(INSTITUTION, '測試抬頭'), '清冊.xls'))
    expect(enrolledCard(wrapper).get('[data-test="enrolled-preview"]').text()).not.toContain('檔案上的園所')
  })

  it('清冊沒有列印日期時要先選日期才送預覽', async () => {
    const { wrapper } = await mountImports()
    const post = mockPost({ [ENROLLED_PREVIEW]: enrolledPreview({ roster_date: '2026-09-15' }) })
    await pick(wrapper, 'enrolled-file', fileOf(rosterHtml({ printed: null }), '清冊.xls'))
    expect(pathsTo(post, ENROLLED_PREVIEW)).toEqual([])
    expect(enrolledCard(wrapper).text()).toContain('清冊上沒有列印日期')

    wrapper.findComponent(ElDatePicker).vm.$emit('update:modelValue', '2026-09-15')
    await flushPromises()
    expect(pathsTo(post, ENROLLED_PREVIEW)).toHaveLength(1)
    expect((bodyOf(post, ENROLLED_PREVIEW) as { roster_date: string }).roster_date).toBe('2026-09-15')
    expect(wrapper.find('[data-test="enrolled-preview"]').exists()).toBe(true)
  })

  it('比例不足時確認匯入停用', async () => {
    const { wrapper } = await mountImports()
    mockPost({ [ENROLLED_PREVIEW]: enrolledPreview({ placed: 17, placed_ratio: 0.85, importable: false }) })
    await pick(wrapper, 'enrolled-file', fileOf(rosterHtml(), '清冊.xls'))
    expect(enrolledCard(wrapper).text()).toContain('有點的比例不到 90%，不能匯入。')
    expect(confirmButton(wrapper, 'enrolled')!.attributes('disabled')).toBeDefined()
  })

  it('比例差一點點到 90% 時不四捨五入成 90.0%', async () => {
    const { wrapper } = await mountImports()
    mockPost({ [ENROLLED_PREVIEW]: enrolledPreview({ total: 2000, placed: 1799, placed_ratio: 0.8995, importable: false }) })
    await pick(wrapper, 'enrolled-file', fileOf(rosterHtml(), '清冊.xls'))
    expect(enrolledCard(wrapper).text()).toContain('有點 1,799 位（89.9%）')
  })

  it('確認送出預覽回來的資料並重讀狀態', async () => {
    const confirm = confirmed()
    const { wrapper, get } = await mountImports()
    const preview = enrolledPreview()
    const post = mockPost({ [ENROLLED_PREVIEW]: preview, [ENROLLED_APPLY]: { students: 20, placed: 18 } })
    await pick(wrapper, 'enrolled-file', fileOf(rosterHtml(), '清冊.xls'))
    await confirmButton(wrapper, 'enrolled')!.trigger('click')
    await flushPromises()

    expect(confirm).toHaveBeenCalledTimes(1)
    const message = textOf(confirm.mock.calls[0]![0])
    expect(message).toContain('匯入到：義華')
    expect(message).toContain(`檔案上的園所：${INSTITUTION}`)
    const [path] = pathsTo(post, ENROLLED_APPLY)
    expect(queryOf(path!).get('campus_key')).toBe('yihua')
    expect(bodyOf(post, ENROLLED_APPLY)).toEqual(preview.payload)
    expect(pathsTo(get, STATUS)).toHaveLength(2)
    expect(wrapper.find('[data-test="enrolled-preview"]').exists()).toBe(false)
  })

  it('確認對話框按取消就不送', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
    const { wrapper } = await mountImports()
    const post = mockPost({ [ENROLLED_PREVIEW]: enrolledPreview() })
    await pick(wrapper, 'enrolled-file', fileOf(rosterHtml(), '清冊.xls'))
    await confirmButton(wrapper, 'enrolled')!.trigger('click')
    await flushPromises()
    expect(pathsTo(post, ENROLLED_APPLY)).toEqual([])
    expect(wrapper.find('[data-test="enrolled-preview"]').exists()).toBe(true)
  })

  it('連點確認只送一次', async () => {
    confirmed()
    const { wrapper } = await mountImports()
    const apply = deferred<unknown>()
    const post = mockPost({ [ENROLLED_PREVIEW]: enrolledPreview(), [ENROLLED_APPLY]: () => apply.promise })
    await pick(wrapper, 'enrolled-file', fileOf(rosterHtml(), '清冊.xls'))
    const target = confirmButton(wrapper, 'enrolled')!
    void target.trigger('click')
    void target.trigger('click')
    await flushPromises()
    expect(target.classes()).toContain('is-loading')
    ;(target.element as HTMLButtonElement).click()
    await flushPromises()
    expect(pathsTo(post, ENROLLED_APPLY)).toHaveLength(1)
    apply.resolve({ students: 20, placed: 18 })
    await flushPromises()
    expect(pathsTo(post, ENROLLED_APPLY)).toHaveLength(1)
  })

  it('換校區清掉預覽', async () => {
    const { wrapper } = await mountImports()
    mockPost({ [ENROLLED_PREVIEW]: enrolledPreview() })
    await pick(wrapper, 'enrolled-file', fileOf(rosterHtml(), '清冊.xls'))
    expect(confirmButton(wrapper, 'enrolled')).toBeDefined()

    await wrapper.setProps({ campusKey: 'minghua' })
    await flushPromises()
    expect(hasButton(wrapper, '確認匯入')).toBe(false)
    expect(wrapper.text()).not.toContain('匯入到：義華')
    expect(wrapper.text()).not.toContain('檔案上的園所')
  })

  it('卡片自己也看校區：校區一換就清掉預覽與選的日期（不靠外層重掛）', async () => {
    mockPost({ [ENROLLED_PREVIEW]: enrolledPreview(), [HISTORY_PREVIEW]: historyPreview() })
    vi.mocked(readHistoryWorkbook).mockResolvedValue(SHEETS)
    const enrolled = await mountWith(EnrolledImportCard, { props: { campusKey: 'yihua', status: importStatus() } })
    await pick(enrolled.wrapper, 'enrolled-file', fileOf(rosterHtml(), '清冊.xls'))
    expect(enrolled.wrapper.find('[data-test="enrolled-preview"]').exists()).toBe(true)
    await enrolled.wrapper.setProps({ campusKey: 'minghua' })
    expect(enrolled.wrapper.find('[data-test="enrolled-preview"]').exists()).toBe(false)

    const history = await mountWith(HistoryImportCard, { props: { campusKey: 'yihua', status: importStatus() } })
    await pick(history.wrapper, 'history-file', fileOf('xls', '統計表.xls'))
    expect(history.wrapper.find('[data-test="history-preview"]').exists()).toBe(true)
    await history.wrapper.setProps({ campusKey: 'minghua' })
    expect(history.wrapper.find('[data-test="history-preview"]').exists()).toBe(false)
  })

  it('預覽還沒回來就換校區：晚到的預覽不顯示', async () => {
    const { wrapper } = await mountImports()
    const pending = deferred<unknown>()
    mockPost({ [ENROLLED_PREVIEW]: () => pending.promise })
    await pick(wrapper, 'enrolled-file', fileOf(rosterHtml(), '清冊.xls'))
    await wrapper.setProps({ campusKey: 'minghua' })
    await flushPromises()
    pending.resolve(enrolledPreview())
    await flushPromises()
    expect(wrapper.find('[data-test="enrolled-preview"]').exists()).toBe(false)
  })

  it('門牌換版的 409 清掉預覽並提示重新預覽', async () => {
    confirmed()
    const { wrapper, get } = await mountImports()
    mockPost({
      [ENROLLED_PREVIEW]: enrolledPreview(),
      [ENROLLED_APPLY]: () => { throw new ApiError(409, { code: 'DOORPLATE_CHANGED', message: '門牌已換版，請重新預覽' }) },
    })
    await pick(wrapper, 'enrolled-file', fileOf(rosterHtml(), '清冊.xls'))
    await confirmButton(wrapper, 'enrolled')!.trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="enrolled-preview"]').exists()).toBe(false)
    expect(enrolledCard(wrapper).text()).toContain('門牌已換版，請重新預覽')
    expect(pathsTo(get, STATUS)).toHaveLength(1)
  })

  it('其他確認錯誤保留預覽並寫出原因', async () => {
    confirmed()
    const { wrapper } = await mountImports()
    mockPost({
      [ENROLLED_PREVIEW]: enrolledPreview(),
      [ENROLLED_APPLY]: () => { throw new ApiError(422, { code: 'SCHOOL_YEAR_MISMATCH', message: '清冊日期和學年對不上，請重新預覽' }) },
    })
    await pick(wrapper, 'enrolled-file', fileOf(rosterHtml(), '清冊.xls'))
    await confirmButton(wrapper, 'enrolled')!.trigger('click')
    await flushPromises()
    expect(enrolledCard(wrapper).text()).toContain('清冊日期和學年對不上，請重新預覽')
    expect(wrapper.find('[data-test="enrolled-preview"]').exists()).toBe(true)
  })

  it('預覽被伺服器拒絕：寫出原因', async () => {
    const { wrapper } = await mountImports()
    mockPost({ [ENROLLED_PREVIEW]: () => { throw new ApiError(422, { code: 'ENROLLED_MATCH_FAILED', message: '門牌資料尚未匯入，先跑 geo-sync --doorplates-file' }) } })
    await pick(wrapper, 'enrolled-file', fileOf(rosterHtml(), '清冊.xls'))
    expect(enrolledCard(wrapper).text()).toContain('門牌資料尚未匯入')
    expect(wrapper.find('[data-test="enrolled-preview"]').exists()).toBe(false)
  })

  it('清除要再確認一次', async () => {
    const answer = deferred<unknown>()
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockReturnValue(answer.promise as never)
    const { wrapper, get } = await mountImports()
    const del = mockDelete({ [ENROLLED]: { removed: true } })
    await button(enrolledCard(wrapper), '清除這校在籍資料')!.trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(String(confirm.mock.calls[0]![1])).toContain('義華')
    expect(del).not.toHaveBeenCalled()

    answer.resolve('confirm')
    await flushPromises()
    const [path] = pathsTo(del, ENROLLED)
    expect(Object.fromEntries(queryOf(path!))).toEqual({ campus_key: 'yihua' })
    expect(pathsTo(get, STATUS)).toHaveLength(2)
  })

  it('清除的對話框開著時換了校區：清的還是對話框寫的那一校', async () => {
    const answer = deferred<unknown>()
    vi.spyOn(ElMessageBox, 'confirm').mockReturnValue(answer.promise as never)
    const del = mockDelete({ [ENROLLED]: { removed: true } })
    const { wrapper } = await mountWith(EnrolledImportCard, { props: { campusKey: 'yihua', status: importStatus() } })
    await button(wrapper, '清除這校在籍資料')!.trigger('click')
    await wrapper.setProps({ campusKey: 'minghua' })
    answer.resolve('confirm')
    await flushPromises()
    expect(pathsTo(del, ENROLLED).map((path) => queryOf(path).get('campus_key'))).toEqual(['yihua'])
  })

  it('確認對話框開著時換了校區：照對話框寫的校區送出，失敗時用全域提示寫出哪一校、什麼原因', async () => {
    const post = mockPost({
      [ENROLLED_PREVIEW]: enrolledPreview(),
      [ENROLLED_APPLY]: () => { throw new ApiError(409, { code: 'DOORPLATE_CHANGED', message: '門牌已換版，請重新預覽' }) },
    })
    const toast = await confirmAfterCampusSwitch('enrolled', (wrapper) => pick(wrapper, 'enrolled-file', fileOf(rosterHtml(), '清冊.xls')))

    expect(pathsTo(post, ENROLLED_APPLY).map((path) => queryOf(path).get('campus_key'))).toEqual(['yihua'])
    expect(errorToasts(toast)).toEqual([expect.stringContaining('匯入到義華失敗：門牌已換版，請重新預覽')])
  })

  it('確認對話框開著時換了校區：成功時一樣寫出匯入到哪一校', async () => {
    const success = vi.spyOn(ElMessage, 'success')
    const post = mockPost({ [ENROLLED_PREVIEW]: enrolledPreview(), [ENROLLED_APPLY]: { students: 20, placed: 18 } })
    const toast = await confirmAfterCampusSwitch('enrolled', (wrapper) => pick(wrapper, 'enrolled-file', fileOf(rosterHtml(), '清冊.xls')))

    expect(pathsTo(post, ENROLLED_APPLY).map((path) => queryOf(path).get('campus_key'))).toEqual(['yihua'])
    expect(success).toHaveBeenCalledWith('已匯入到義華：20 位，有點 18 位')
    expect(toast).not.toHaveBeenCalled()
  })

  it('清除的確認按取消就不刪', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
    const { wrapper } = await mountImports()
    const del = mockDelete({ [ENROLLED]: { removed: true } })
    await button(enrolledCard(wrapper), '清除這校在籍資料')!.trigger('click')
    await flushPromises()
    expect(del).not.toHaveBeenCalled()
  })
})

describe('資料匯入：讀不了的檔', () => {
  it('選到讀不了的檔不送任何請求', async () => {
    const { wrapper } = await mountImports()
    const post = mockPost()
    await pick(wrapper, 'enrolled-file', fileOf('%PDF-1.4 測試', '清冊.pdf'))
    expect(enrolledCard(wrapper).text()).toContain('找不到有「出生日期」「通訊地址」兩欄的名冊表格')

    vi.mocked(readHistoryWorkbook).mockRejectedValue(new HistoryFileError('無法讀取這個檔案，請確認是園方的目標執行統計表（.xls）'))
    await pick(wrapper, 'history-file', fileOf('不是 Excel', '統計表.xls'))
    expect(historyCard(wrapper).text()).toContain('無法讀取這個檔案，請確認是園方的目標執行統計表（.xls）')
    expect(post).not.toHaveBeenCalled()
  })

  it('歷年註冊選到別的 Excel 檔（像學生名單）：用真的擷取，不送任何請求，頁面寫出工作表名', async () => {
    const actual = await vi.importActual<typeof import('../admissions/imports/historyWorkbook')>('../admissions/imports/historyWorkbook')
    vi.mocked(readHistoryWorkbook).mockImplementation(actual.readHistoryWorkbook)
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['編號', '幼生姓名', '出生日期'], ['1', '測試小明', '2022/05/10'], ['2', '測試小華', '2023/03/01']]), '工作表1')
    const data = XLSX.write(book, { bookType: 'biff8', type: 'array' }) as ArrayBuffer
    const { wrapper } = await mountImports()
    const post = mockPost()

    await pick(wrapper, 'history-file', Object.assign(new File([data], '名單.xls'), { arrayBuffer: async () => data }))

    await vi.waitFor(() => expect(historyCard(wrapper).text()).toContain('這個檔案有不是學期的工作表（工作表1），請確認是園方的目標執行統計表'))
    expect(historyCard(wrapper).text()).not.toContain('測試小明')
    expect(post).not.toHaveBeenCalled()
  })
})

describe('資料匯入：歷年註冊', () => {
  it('統計表預覽顯示各學期人數、警告與會被刪掉的學期', async () => {
    const confirm = confirmed()
    const { wrapper, get } = await mountImports()
    vi.mocked(readHistoryWorkbook).mockResolvedValue(SHEETS)
    const preview = historyPreview({ removed_terms: [{ school_year: 99, semester: 1 }, { school_year: 99, semester: 2 }] })
    const post = mockPost({ [HISTORY_PREVIEW]: preview, [HISTORY_APPLY]: { rows: 8 } })
    await pick(wrapper, 'history-file', fileOf('xls', '統計表.xls'))

    const [path] = pathsTo(post, HISTORY_PREVIEW)
    expect(Object.fromEntries(queryOf(path!))).toEqual({ campus_key: 'yihua' })
    expect(bodyOf(post, HISTORY_PREVIEW)).toEqual({ sheets: SHEETS })
    const card = historyCard(wrapper).get('[data-test="history-preview"]')
    expect(card.get('.import-target').text()).toBe('匯入到：義華')
    expect(card.text()).toContain('目前：99上～114下・128 列 → 新的：114下～115上・8 列')
    expect(card.text()).toContain('114下 大班：50 → 52 位')
    expect(card.findAll('[data-test="history-table"] thead th').map((th) => th.text())).toEqual(['學期', '幼幼班', '小班', '中班', '大班', '合計'])
    expect(card.findAll('[data-test="history-table"] tbody tr').map((row) => row.findAll('th, td').map((cell) => cell.text()))).toEqual([
      ['114下', '30', '45', '48', '52', '175'],
      ['115上', '33', '48', '50', '58', '189'],
    ])
    expect(card.text()).toContain('115上 大班：註冊人數比目標多')
    expect(card.text()).toContain('99上、99下')

    const target = confirmButton(wrapper, 'history')!
    expect(target.attributes('disabled')).toBeDefined()
    await card.get('[data-test="history-removed-ack"] input').setValue(true)
    expect(target.attributes('disabled')).toBeUndefined()
    await target.trigger('click')
    await flushPromises()
    expect(textOf(confirm.mock.calls[0]![0])).toContain('匯入到：義華')
    expect(bodyOf(post, HISTORY_APPLY)).toEqual(preview.payload)
    expect(pathsTo(get, STATUS)).toHaveLength(2)
    expect(wrapper.find('[data-test="history-preview"]').exists()).toBe(false)
  })

  it('沒有會被刪掉的學期就不用勾；兩邊註冊人數都一樣時寫明', async () => {
    const { wrapper } = await mountImports()
    vi.mocked(readHistoryWorkbook).mockResolvedValue(SHEETS)
    mockPost({ [HISTORY_PREVIEW]: historyPreview({ changed: [], warnings: [] }) })
    await pick(wrapper, 'history-file', fileOf('xls', '統計表.xls'))
    const card = historyCard(wrapper).get('[data-test="history-preview"]')
    expect(card.find('[data-test="history-removed-ack"]').exists()).toBe(false)
    expect(card.text()).toContain('兩邊都有的學期，註冊人數都一樣。')
    expect(confirmButton(wrapper, 'history')!.attributes('disabled')).toBeUndefined()
  })

  it('校區不符的 422 清掉預覽並提示重新預覽', async () => {
    confirmed()
    const { wrapper } = await mountImports()
    vi.mocked(readHistoryWorkbook).mockResolvedValue(SHEETS)
    mockPost({
      [HISTORY_PREVIEW]: historyPreview(),
      [HISTORY_APPLY]: () => { throw new ApiError(422, { code: 'CAMPUS_MISMATCH', message: '資料的校區和選的校區不同，請重新預覽' }) },
    })
    await pick(wrapper, 'history-file', fileOf('xls', '統計表.xls'))
    await confirmButton(wrapper, 'history')!.trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="history-preview"]').exists()).toBe(false)
    expect(historyCard(wrapper).text()).toContain('資料的校區和選的校區不同，請重新預覽')
  })

  it('確認對話框開著時換了校區：照對話框寫的校區送出，失敗時用全域提示寫出哪一校、什麼原因', async () => {
    vi.mocked(readHistoryWorkbook).mockResolvedValue(SHEETS)
    const post = mockPost({
      [HISTORY_PREVIEW]: historyPreview(),
      [HISTORY_APPLY]: () => { throw new ApiError(422, { code: 'CAMPUS_MISMATCH', message: '資料的校區和選的校區不同，請重新預覽' }) },
    })
    const toast = await confirmAfterCampusSwitch('history', (wrapper) => pick(wrapper, 'history-file', fileOf('xls', '統計表.xls')))

    expect(pathsTo(post, HISTORY_APPLY).map((path) => queryOf(path).get('campus_key'))).toEqual(['yihua'])
    expect(errorToasts(toast)).toEqual([expect.stringContaining('匯入到義華失敗：資料的校區和選的校區不同，請重新預覽')])
  })

  it('統計表看不懂時列出遮罩表頭', async () => {
    const { wrapper } = await mountImports()
    vi.mocked(readHistoryWorkbook).mockResolvedValue(SHEETS)
    mockPost({
      [HISTORY_PREVIEW]: () => {
        throw new ApiError(422, {
          code: 'HISTORY_WORKBOOK_INVALID',
          message: '115上：找不到「註冊人數」欄',
          headers: [{ name: '115上', row2: ['目標人數', '', '1150915'], row3: ['', '', '註冊人數'], labels: ['…', '…', '', '', '大班'] }],
        })
      },
    })
    await pick(wrapper, 'history-file', fileOf('xls', '統計表.xls'))
    expect(historyCard(wrapper).text()).toContain('115上：找不到「註冊人數」欄')
    const headers = historyCard(wrapper).get('[data-test="history-headers"]').text()
    expect(headers).toContain('表名：115上')
    expect(headers).toContain('第 2 列：目標人數 |  | 1150915')
    expect(headers).toContain('第 3 列： |  | 註冊人數')
    expect(headers).toContain('第 0 欄：… | … |  |  | 大班')
    expect(hasButton(wrapper, '確認匯入')).toBe(false)
  })
})

describe('招生統計的子分頁', () => {
  it('子分頁寫進網址', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-01T09:00:00+08:00'))
    expect(STATS_SUBS.at(-1)).toBe('imports')
    const get = mockGet({
      '/admin/admissions/options': options(),
      '/admin/admissions/stats': () => { throw new Error('統計不在這支測試的範圍') },
      [STATUS]: importStatus(),
    })
    const { wrapper, router } = await mountWith(AdmissionsStatsView, { path: '/admissions-stats?campus=yihua&sy=114&sem=2&sub=imports' })
    const stats = wrapper.findComponent(StatsTab)
    expect(stats.props('sub')).toBe('imports')
    expect(wrapper.findAll('.stats-subtabs .el-tabs__item').map((item) => item.text()).at(-1)).toBe('資料匯入')
    expect(wrapper.find('section[aria-label="資料匯入"]').exists()).toBe(true)
    expect(wrapper.find('.stats-toolbar').exists()).toBe(false)
    const selects = ['入學學年', '入學學期'].map((label) => wrapper.findAllComponents({ name: 'ElSelect' }).find((item) => item.props('ariaLabel') === label)!)
    expect(selects.map((item) => item.props('disabled'))).toEqual([true, true])
    expect(queryOf(pathsTo(get, STATUS)[0]!).get('campus_key')).toBe('yihua')
    expect(router.currentRoute.value.query).toEqual({ campus: 'yihua', sy: '114', sem: '2', sub: 'imports' })

    stats.vm.$emit('update:sub', 'source')
    await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ sub: 'source' })
    stats.vm.$emit('update:sub', 'imports')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ campus: 'yihua', sy: '114', sem: '2', sub: 'imports' })
    expect(pathsTo(get, STATUS)).toHaveLength(1)
  })
})
