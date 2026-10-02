import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ElMessage } from 'element-plus'
import { notifyError, notifyWarning } from '../composables/notify'

const SRC = join(__dirname, '..')

function sourceFiles(dir = SRC): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(path)
    return /\.(ts|vue)$/.test(entry.name) ? [path] : []
  })
}

afterEach(() => vi.restoreAllMocks())

describe('錯誤與警告提示留 8 秒、可以自己關', () => {
  it('notifyError：8 秒、關閉鈕、同一句不重複堆疊；要自己處理的錯誤可以設成不自動消失', () => {
    const error = vi.spyOn(ElMessage, 'error').mockReturnValue(undefined as never)
    notifyError('儲存失敗（錯誤編號 a1b2c3d4）')
    expect(error).toHaveBeenCalledWith({ message: '儲存失敗（錯誤編號 a1b2c3d4）', duration: 8000, showClose: true, grouping: true })
    notifyError('頁面沒有載入成功', { duration: 0 })
    expect(error.mock.calls[1]![0]).toMatchObject({ message: '頁面沒有載入成功', duration: 0, showClose: true })
  })

  it('notifyWarning 走 warning，設定和錯誤一樣', () => {
    const warning = vi.spyOn(ElMessage, 'warning').mockReturnValue(undefined as never)
    const error = vi.spyOn(ElMessage, 'error')
    notifyWarning('這筆案件剛被其他人修改，已載入最新的內容')
    expect(warning).toHaveBeenCalledWith(expect.objectContaining({ duration: 8000, showClose: true, grouping: true }))
    expect(error).not.toHaveBeenCalled()
  })

  // 招生入學的檔案另一組正在改，先列為例外；他們改完再從清單拿掉。
  const ADMISSIONS_EXCEPTIONS = [/^components\/admissions\//, /^views\/Admission(s|Content)View\.vue$/]

  it('除了 notify.ts，沒有直接呼叫 ElMessage.error／warning（預設 3 秒、沒有關閉鈕）', () => {
    const offenders = sourceFiles().flatMap((file) => {
      const rel = relative(SRC, file).split('\\').join('/')
      if (rel === 'composables/notify.ts' || ADMISSIONS_EXCEPTIONS.some(re => re.test(rel))) return []
      const text = readFileSync(file, 'utf8')
      const hits = text.match(/ElMessage\.(error|warning)\s*\(|ElMessage\(\s*\{\s*type:\s*'(error|warning)'/g) ?? []
      return hits.map(hit => `${rel}: ${hit}`)
    })
    expect(offenders).toEqual([])
  })
})

describe('不能回復的確認框：確認鈕用危險色，焦點不放在確認鈕', () => {
  // [檔案, 確認鈕文字]：撤銷連結、放棄修改、整站還原這類動作，和停用分校、刪除素材同一套樣式。
  const CASES: [string, string][] = [
    ['components/ParentAccessLinkPanel.vue', '撤銷連結'],
    ['components/ManualVisitDialog.vue', '放棄填寫'],
    ['components/ContentEditor.vue', '放棄修改'],
    ['components/ContentEditor.vue', '清掉我的修改'],
    ['composables/useUnsavedChanges.ts', "放棄修改', cancelButtonText: '留在這頁"],
    ['views/MediaLibraryView.vue', '放棄修改'],
    ['views/MediaLibraryView.vue', '刪除'],
    ['views/PublishHistoryView.vue', '整站還原'],
    ['views/PoliciesView.vue', '執行清理'],
  ]

  it.each(CASES)('%s「%s」', (file, label) => {
    const text = readFileSync(join(SRC, file), 'utf8')
    const at = text.indexOf(`confirmButtonText: '${label}'`)
    expect(at, `找不到確認鈕「${label}」`).toBeGreaterThan(-1)
    const options = text.slice(at, text.indexOf('}', text.indexOf('autofocus', at) + 1) + 1)
    expect(options).toContain("confirmButtonClass: 'el-button--danger'")
    expect(options).toContain('autofocus: false')
    // 視窗不能跨到下一個確認框
    expect(options.match(/confirmButtonText/g)).toHaveLength(1)
  })

  it('確認框的確認鈕寫出動作，不寫「確認切換」或預設的「確定」', () => {
    const settings = readFileSync(join(SRC, 'views/BookingSettingsView.vue'), 'utf8')
    expect(settings).toContain("confirmButtonText: '切換預約方式'")
    expect(settings).not.toContain('確認切換')
    const history = readFileSync(join(SRC, 'views/PublishHistoryView.vue'), 'utf8')
    expect(history).toMatch(/'沒有還原', \{\s*confirmButtonText: '知道了'/)
  })
})
