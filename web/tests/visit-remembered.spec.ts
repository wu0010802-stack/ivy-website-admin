import { describe, expect, it } from 'vitest'
import { hasRememberedVisitCookie } from '../app/utils/visit-remembered'

// 這台裝置記住的預約（2026-11-16）：伺服器渲染時只看請求有沒有帶這個 cookie（正式站有 __Host- 前綴）。
describe('hasRememberedVisitCookie', () => {
  it('認得兩種名稱', () => {
    expect(hasRememberedVisitCookie('a=1; __Host-ivy_visit_remember=tok')).toBe(true)
    expect(hasRememberedVisitCookie('ivy_visit_remember=tok')).toBe(true)
  })
  it('空值、別的 cookie、名稱相近的都不算', () => {
    for (const header of [undefined, null, '', 'ivy_visit_remember=', 'x_ivy_visit_remember=tok', 'ivy_src=abc']) {
      expect(hasRememberedVisitCookie(header)).toBe(false)
    }
  })
})
