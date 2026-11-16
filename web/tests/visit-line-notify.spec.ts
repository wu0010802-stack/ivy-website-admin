// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, createApp, nextTick, onBeforeUnmount, onMounted, ref, type App } from 'vue'
import VisitLineNotify from '../app/components/VisitLineNotify.vue'

// 用 LINE 接收參觀通知（2026-11-16）：預約完成頁用修改連結的 token 換 session 再取代碼；修改頁一進來先查狀態。
// Nuxt 的自動匯入與 $fetch 在單元測試裡沒有，這裡補上。
vi.stubGlobal('computed', computed)
vi.stubGlobal('ref', ref)
vi.stubGlobal('onMounted', onMounted)
vi.stubGlobal('onBeforeUnmount', onBeforeUnmount)

const BASE = '/api/website/v1/public/visit-manage'
const ISSUED = {
  code: 'LN-ABCD2345',
  expires_at: '2026-11-16T10:30:00Z',
  message_url: 'https://line.me/R/oaMessage/%40ivy-yihua/?%E6%88%91',
  text: '我要用 LINE 接收參觀通知 LN-ABCD2345',
  basic_id: '@ivy-yihua',
  account_name: '常春藤義華',
  add_friend_url: 'https://line.me/R/ti/p/%40ivy-yihua',
}

let app: App | null = null
let root: HTMLElement
const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('$fetch', fetchMock)
  root = document.createElement('div')
  document.body.appendChild(root)
})
afterEach(() => {
  app?.unmount()
  app = null
  root.remove()
})

async function flush() {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve()
    await nextTick()
  }
}

async function mountWith(props: Record<string, unknown>, userAgent = 'Mozilla/5.0 (Macintosh)') {
  Object.defineProperty(navigator, 'userAgent', { value: userAgent, configurable: true })
  app = createApp(VisitLineNotify, props)
  app.mount(root)
  await flush()
}

function button(text: string): HTMLButtonElement {
  const found = [...root.querySelectorAll('button')].find(el => el.textContent?.includes(text))
  if (!found) throw new Error(`找不到按鈕：${text}`)
  return found
}

describe('VisitLineNotify', () => {
  it('預約完成頁：按下去先用 token 換 session，再取代碼；桌機列出加好友與要傳的那句話', async () => {
    fetchMock.mockImplementation(async (url: string) => (url.endsWith('/code') ? ISSUED : {}))
    await mountWith({ token: 'tok-1' })
    expect(root.textContent).toContain('用 LINE 接收參觀通知')
    button('用 LINE 接收通知').click()
    await flush()
    expect(fetchMock.mock.calls[0]).toEqual([`${BASE}/exchange`, { method: 'POST', headers: { 'X-Ivy-Parent': '1' }, body: { token: 'tok-1' } }])
    expect(fetchMock.mock.calls[1]![0]).toBe(`${BASE}/line-notify/code`)
    expect(root.textContent).toContain('我要用 LINE 接收參觀通知 LN-ABCD2345')
    const friend = root.querySelector<HTMLAnchorElement>('a[href="https://line.me/R/ti/p/%40ivy-yihua"]')!
    expect(friend.target).toBe('_blank')
    expect(friend.textContent).toContain('↗')
  })

  it('手機：直接開 LINE 預填文字', async () => {
    fetchMock.mockImplementation(async (url: string) => (url.endsWith('/code') ? ISSUED : {}))
    await mountWith({ token: 'tok-1' }, 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')
    button('用 LINE 接收通知').click()
    await flush()
    const open = root.querySelector<HTMLAnchorElement>('a.line-notify-button')!
    expect(open.getAttribute('href')).toBe(ISSUED.message_url)
    expect(open.textContent).toContain('開啟 LINE 傳送')
  })

  it('修改頁：已綁定時可以取消；這校沒開時整塊不顯示', async () => {
    fetchMock.mockResolvedValueOnce({ available: true, linked: true, account_name: '常春藤義華' })
    await mountWith({ check: true })
    expect(fetchMock.mock.calls[0]![0]).toBe(`${BASE}/line-notify`)
    expect(root.textContent).toContain('已用 LINE 接收通知')
    expect(root.textContent).toContain('「常春藤義華」')
    fetchMock.mockResolvedValueOnce(undefined)
    button('不再用 LINE 接收').click()
    await flush()
    expect(fetchMock.mock.calls.at(-1)).toEqual([`${BASE}/line-notify`, { method: 'DELETE', headers: { 'X-Ivy-Parent': '1' } }])
    expect(root.textContent).toContain('用 LINE 接收參觀通知')

    app!.unmount()
    fetchMock.mockReset()
    fetchMock.mockResolvedValueOnce({ available: false, linked: false })
    await mountWith({ check: true })
    expect(root.querySelector('.line-notify')).toBeNull()
  })

  it('帶畫面上的案件 id（別的分頁換了預約就被後端擋下）；代碼過期可以重新取得', async () => {
    fetchMock.mockImplementation(async (url: string) => (url.includes('/code') ? ISSUED : {}))
    await mountWith({ token: 'tok-1', visitId: 'case-1' })
    button('用 LINE 接收通知').click()
    await flush()
    expect(fetchMock.mock.calls[1]![0]).toBe(`${BASE}/line-notify/code?visit_request_id=case-1`)
    button('重新取得').click()
    await flush()
    expect(fetchMock.mock.calls.filter(call => String(call[0]).includes('/code'))).toHaveLength(2)
    // 已經換過 session，不再 exchange。
    expect(fetchMock.mock.calls.filter(call => String(call[0]).endsWith('/exchange'))).toHaveLength(1)
  })

  it('取代碼失敗時說明，不留在半途', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/code')) throw Object.assign(new Error('x'), { statusCode: 429 })
      return {}
    })
    await mountWith({ token: 'tok-1' })
    button('用 LINE 接收通知').click()
    await flush()
    expect(root.querySelector('[role="alert"]')!.textContent).toContain('操作太頻繁')
    expect(root.textContent).toContain('用 LINE 接收通知')
  })
})
