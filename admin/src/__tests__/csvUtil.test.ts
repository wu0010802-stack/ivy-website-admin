// 後台前端組的 CSV（2026-10-03 匯出擴充）：規則和後端 app/common/csv_export.py 相同。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from '../api/client'
import { CSV_BOM, buildCsv, csvFilename, downloadCsv, downloadServerCsv, rocMonthCsv, safeCell, withBom } from '../utils/csv'

const originalCreate = URL.createObjectURL
const originalRevoke = URL.revokeObjectURL
afterEach(() => {
  URL.createObjectURL = originalCreate
  URL.revokeObjectURL = originalRevoke
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('rocMonthCsv：民國月份寫成「115年09月」，Excel 不會把 115.10 轉成數字 115.1', () => {
  it.each([
    ['115.09', '115年09月'],
    ['115.10', '115年10月'],
    ['114.12', '114年12月'],
    ['99.01', '99年01月'],
    ['115.9', '115年09月'],
  ])('%j → %j', (input, expected) => {
    expect(rocMonthCsv(input)).toBe(expected)
  })

  it('不是「年.月」格式的原樣不動（未填寫、空白、null）', () => {
    expect(rocMonthCsv('未填寫')).toBe('未填寫')
    expect(rocMonthCsv('')).toBe('')
    expect(rocMonthCsv(null)).toBe('')
    expect(rocMonthCsv(undefined)).toBe('')
  })

  // 後端 backend/tests/test_csv_export.py 的邊界測資，兩邊同一組：位數超過、多一段、結尾換行、全形數字都不是「年.月」。
  it.each([
    ['1150.09'],
    ['115.009'],
    ['115.09.08'],
    ['115.09\n'],
    ['１１５.０９'],
  ])('邊界：%j 不符合「年.月」，原樣不動', (input) => {
    expect(rocMonthCsv(input)).toBe(input)
  })

  it('組進 CSV 後原樣輸出，不被補單引號', () => {
    expect(buildCsv(['月份'], [[rocMonthCsv('115.10')]])).toBe(`${CSV_BOM}月份\r\n115年10月\r\n`)
  })
})

describe('safeCell：和後端 safe_cell 同一條規則', () => {
  it.each([
    ['=1+1', "'=1+1"],
    ['+886912345678', "'+886912345678"],
    ['-3', "'-3"],
    ['@SUM(A1)', "'@SUM(A1)"],
    ['\t=HYPERLINK("x")', '\'\t=HYPERLINK("x")'],
    [' +1+1', "' +1+1"],
    ['\r@SUM(A1)', "'\r@SUM(A1)"],
    ['王小明', '王小明'],
    ['0912-345-601', '0912-345-601'],
    ['', ''],
  ])('%j → %j', (input, expected) => {
    expect(safeCell(input)).toBe(expected)
  })

  it('數字照寫（負數不補單引號）、布林寫是／否、空值寫空白', () => {
    expect(safeCell(-3)).toBe('-3')
    expect(safeCell(12)).toBe('12')
    expect(safeCell(Number.NaN)).toBe('')
    expect(safeCell(true)).toBe('是')
    expect(safeCell(false)).toBe('否')
    expect(safeCell(null)).toBe('')
    expect(safeCell(undefined)).toBe('')
  })
})

describe('buildCsv', () => {
  it('開頭 BOM、CRLF 換行；含逗號、雙引號、換行的格子加引號', () => {
    const csv = buildCsv(['姓名', '備註'], [['王小明', '第一行\n第二行，有逗號'], ['李"小"華', 'a,b'], ['=1+1', null]])
    expect(csv).toBe(`${CSV_BOM}姓名,備註\r\n王小明,"第一行\n第二行，有逗號"\r\n"李""小""華","a,b"\r\n'=1+1,\r\n`)
  })

  it('只有表頭也是合法的檔案', () => {
    expect(buildCsv(['校區'], [])).toBe(`${CSV_BOM}校區\r\n`)
  })
})

it('withBom 不重複加', () => {
  expect(withBom('a')).toBe(`${CSV_BOM}a`)
  expect(withBom(`${CSV_BOM}a`)).toBe(`${CSV_BOM}a`)
})

it('csvFilename 以「-」串接、略過空值、清掉檔名不能用的字元', () => {
  expect(csvFilename('招生統計', '月度明細表', '義華', '115 上學期', '2026-10-03')).toBe('招生統計-月度明細表-義華-115 上學期-2026-10-03.csv')
  expect(csvFilename('成效統計', null, '', '2026/09/04–2026/10/03')).toBe('成效統計-2026_09_04–2026_10_03.csv')
  expect(csvFilename('a:b*c?"d<e>f|g\\h')).toBe('a_b_c_d_e_f_g_h.csv')
  expect(csvFilename()).toBe('export.csv')
})

function stubDownload() {
  const blobs: Blob[] = []
  const clicks: { href: string; download: string }[] = []
  URL.createObjectURL = vi.fn((blob: Blob) => { blobs.push(blob); return 'blob:test' }) as typeof URL.createObjectURL
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicks.push({ href: this.getAttribute('href') ?? '', download: this.download })
  })
  return { blobs, clicks }
}

it('downloadCsv 用 Blob 連結下載，檔名照給，之後釋放網址', () => {
  vi.useFakeTimers()
  const { blobs, clicks } = stubDownload()
  downloadCsv('招生統計.csv', buildCsv(['a'], [[1]]))
  expect(blobs[0]!.type).toBe('text/csv;charset=utf-8')
  expect(clicks).toEqual([{ href: 'blob:test', download: '招生統計.csv' }])
  expect(document.querySelector('a[download]')).toBeNull()
  vi.runAllTimers()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test')
})

it('downloadServerCsv 以 API 讀文字後存檔；API 錯誤原樣丟出，不產生檔案', async () => {
  const { clicks } = stubDownload()
  const get = vi.spyOn(api, 'get').mockResolvedValueOnce('校區,月份\r\n' as never)
  await downloadServerCsv('/admin/admissions/records/export?campus_key=yihua', '招生訪視明細.csv')
  expect(get).toHaveBeenCalledWith('/admin/admissions/records/export?campus_key=yihua')
  expect(clicks.map((c) => c.download)).toEqual(['招生訪視明細.csv'])

  get.mockRejectedValueOnce(new ApiError(403, { code: 'FORBIDDEN', message: '沒有權限' }))
  await expect(downloadServerCsv('/x', 'x.csv')).rejects.toBeInstanceOf(ApiError)
  expect(clicks).toHaveLength(1)
})
