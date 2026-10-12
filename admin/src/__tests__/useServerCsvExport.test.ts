// 後端產生的 CSV 下載鈕共用邏輯（訪視明細、未預繳名單）：路徑與檔名在按下去才組、下載途中不能重按、
// 失敗用中文提示（422 筆數太多、403 沒授權）且鈕可以再按。畫面層的接線由 admissionsDownload.test.ts 涵蓋。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import { useServerCsvExport } from '../composables/useServerCsvExport'

vi.mock('../utils/csv', async (importOriginal) => ({ ...(await importOriginal<typeof import('../utils/csv')>()), downloadServerCsv: vi.fn() }))
vi.mock('../composables/notify', () => ({ notifyError: vi.fn(), notifyWarning: vi.fn() }))
import { downloadServerCsv } from '../utils/csv'
import { notifyError } from '../composables/notify'

afterEach(() => {
  vi.mocked(downloadServerCsv).mockReset()
  vi.mocked(notifyError).mockReset()
})

describe('useServerCsvExport', () => {
  it('按下去才組路徑與檔名（拿到當下的篩選），下載完成後 exporting 回 false', async () => {
    let campus = 'yihua'
    const { exporting, exportCsv } = useServerCsvExport(() => ({ path: `/x/export?campus_key=${campus}`, filename: `名單-${campus}.csv` }))
    campus = 'minghua'
    await exportCsv()
    expect(downloadServerCsv).toHaveBeenCalledWith('/x/export?campus_key=minghua', '名單-minghua.csv')
    expect(exporting.value).toBe(false)
    expect(notifyError).not.toHaveBeenCalled()
  })

  it('下載途中再按不會重複送出', async () => {
    let finish: () => void = () => {}
    vi.mocked(downloadServerCsv).mockImplementation(() => new Promise<void>((resolve) => { finish = resolve }))
    const { exporting, exportCsv } = useServerCsvExport(() => ({ path: '/x', filename: 'a.csv' }))
    const first = exportCsv()
    expect(exporting.value).toBe(true)
    await exportCsv()
    expect(downloadServerCsv).toHaveBeenCalledTimes(1)
    finish()
    await first
    expect(exporting.value).toBe(false)
  })

  it('失敗時提示後端的中文訊息，沒有訊息就用預設句；鈕可以再按', async () => {
    vi.mocked(downloadServerCsv)
      .mockRejectedValueOnce(new ApiError(422, { code: 'EXPORT_TOO_LARGE', message: '符合條件的資料超過 10,000 筆，請縮小篩選範圍再匯出。' }))
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(undefined)
    const { exporting, exportCsv } = useServerCsvExport(() => ({ path: '/x', filename: 'a.csv' }))
    await exportCsv()
    expect(vi.mocked(notifyError).mock.calls.at(-1)![0]).toBe('符合條件的資料超過 10,000 筆，請縮小篩選範圍再匯出。')
    expect(exporting.value).toBe(false)
    await exportCsv()
    expect(vi.mocked(notifyError).mock.calls.at(-1)![0]).toBe('匯出失敗，請再試一次。')
    await exportCsv()
    expect(downloadServerCsv).toHaveBeenCalledTimes(3)
    expect(notifyError).toHaveBeenCalledTimes(2)
  })

  it('組路徑時丟錯也走同一個提示，不留下 exporting', async () => {
    const { exporting, exportCsv } = useServerCsvExport(() => { throw new Error('bad filter') })
    await exportCsv()
    expect(downloadServerCsv).not.toHaveBeenCalled()
    expect(notifyError).toHaveBeenCalledTimes(1)
    expect(exporting.value).toBe(false)
  })
})
