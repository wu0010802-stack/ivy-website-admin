import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed } from 'vue'
import { useCampusBooking } from '../app/composables/useCampusBooking'
import { loadTurnstile, resetTurnstileLoader, serverMessage, TURNSTILE_SCRIPT_SRC, type TurnstileApi } from '../app/utils/turnstile'

afterEach(() => {
  resetTurnstileLoader()
  vi.unstubAllGlobals()
})

/** 只實作 loadTurnstile 用到的部分，不讓測試環境真的去抓 Cloudflare 的腳本。 */
function fakeDocument() {
  const scripts: (EventTarget & { src: string; async: boolean; removed: boolean; remove: () => void })[] = []
  const view: { turnstile?: TurnstileApi } = {}
  const doc = {
    defaultView: view,
    head: { appendChild: (node: (typeof scripts)[number]) => { scripts.push(node); return node } },
    createElement: () => Object.assign(new EventTarget(), { src: '', async: false, removed: false, remove() { this.removed = true } })
  }
  return { doc: doc as unknown as Document, scripts, view }
}

const api: TurnstileApi = { render: () => 'widget-1', reset: () => undefined, remove: () => undefined }

describe('Turnstile 腳本延遲載入（使用者 2026-09-29 裁定）', () => {
  it('只插一次 explicit render 的腳本，同時呼叫共用同一個載入', async () => {
    const { doc, scripts, view } = fakeDocument()
    const first = loadTurnstile(doc)
    const second = loadTurnstile(doc)
    expect(scripts).toHaveLength(1)
    expect(scripts[0]?.src).toBe(TURNSTILE_SCRIPT_SRC)
    expect(TURNSTILE_SCRIPT_SRC).toBe('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit')
    view.turnstile = api
    scripts[0]?.dispatchEvent(new Event('load'))
    expect(await first).toBe(api)
    expect(await second).toBe(api)
    expect(await loadTurnstile(doc)).toBe(api)
    expect(scripts).toHaveLength(1)
  })

  it('載入失敗可以重試，失敗的腳本會移除', async () => {
    const { doc, scripts, view } = fakeDocument()
    const failed = loadTurnstile(doc)
    scripts[0]?.dispatchEvent(new Event('error'))
    await expect(failed).rejects.toThrow()
    expect(scripts[0]?.removed).toBe(true)
    const retry = loadTurnstile(doc)
    expect(scripts).toHaveLength(2)
    view.turnstile = api
    scripts[1]?.dispatchEvent(new Event('load'))
    expect(await retry).toBe(api)
  })
})

describe('伺服器錯誤訊息', () => {
  it('BOT_CHECK_FAILED 顯示伺服器給的訊息，沒有才用預設', () => {
    expect(serverMessage({ code: 'BOT_CHECK_FAILED', message: '請完成機器人驗證後再送出' }, '預設')).toBe('請完成機器人驗證後再送出')
    expect(serverMessage({ code: 'BOT_CHECK_FAILED' }, '預設')).toBe('預設')
    expect(serverMessage('bad', '預設')).toBe('預設')
    expect(serverMessage({ message: '  ' }, '預設')).toBe('預設')
  })
})

describe('公開預約設定帶出 Turnstile site key', () => {
  async function configFrom(response: Record<string, unknown>) {
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ campus_key: 'yihua', mode: 'slots', version: 1, line_url: null, phone: null, external_url: null, message: null, ...response }))
    let fetchConfig!: () => Promise<Record<string, unknown>>
    vi.stubGlobal('useAsyncData', (_key: unknown, handler: () => Promise<Record<string, unknown>>) => {
      fetchConfig = handler
      return {}
    })
    useCampusBooking('yihua')
    return fetchConfig()
  }

  it('寄信開關要透傳到結果頁（Important：原本被丟掉）', async () => {
    expect((await configFrom({ parent_email_enabled: true })).parent_email_enabled).toBe(true)
    expect((await configFrom({})).parent_email_enabled).toBe(false)
  })

  it('有設定時帶出 site key', async () => {
    expect((await configFrom({ turnstile_site_key: '0x4AAAAAAA' })).turnstile_site_key).toBe('0x4AAAAAAA')
  })

  it('沒設定（或舊版 API）時為 null，表單維持原樣', async () => {
    expect((await configFrom({})).turnstile_site_key).toBeNull()
    expect((await configFrom({ turnstile_site_key: null })).turnstile_site_key).toBeNull()
  })
})
