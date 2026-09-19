import { describe, it, expect } from 'vitest'
import { resolveLegacyHash } from '../app/utils/legacy-hash'

describe('resolveLegacyHash 舊 hash 相容轉址', () => {
  it('#/home 轉址到 /', () => {
    expect(resolveLegacyHash('#/home')).toBe('/')
  })

  it('#/home/about 轉址到頁內錨點 /#about', () => {
    expect(resolveLegacyHash('#/home/about')).toBe('/#about')
  })

  it.each(['yihua', 'minghua', 'chongde', 'international', 'renwu'])(
    '#/%s 轉址到 /campuses/%s',
    (key) => {
      expect(resolveLegacyHash(`#/${key}`)).toBe(`/campuses/${key}`)
    }
  )

  it('#/visit 轉址到 /visit', () => {
    expect(resolveLegacyHash('#/visit')).toBe('/visit')
  })

  it('#/visit/renwu 轉址到 /visit/renwu', () => {
    expect(resolveLegacyHash('#/visit/renwu')).toBe('/visit/renwu')
  })

  it('#/visit/not-a-campus 不轉址（非白名單校區）', () => {
    expect(resolveLegacyHash('#/visit/not-a-campus')).toBeNull()
  })

  it('不符合 #/ 開頭的 hash 不轉址', () => {
    expect(resolveLegacyHash('#about')).toBeNull()
  })

  it('未知 hash 不轉址', () => {
    expect(resolveLegacyHash('#/some-unknown-path')).toBeNull()
  })
})
