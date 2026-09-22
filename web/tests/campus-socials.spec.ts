import { describe, expect, it } from 'vitest'
import { getCampusSocials } from '../app/utils/campus-socials'

describe('選單分校社群歸屬', () => {
  it('只啟用該校已提供的帳號，未知 IG 和 YouTube 保持待提供', () => {
    const socials = getCampusSocials({
      facebook: 'https://www.facebook.com/ivy.kids.fb/',
      line: 'https://lin.ee/gwl8fnA'
    })
    expect(socials.filter(item => item.url).map(item => item.platform)).toEqual(['facebook', 'line'])
    expect(socials.filter(item => !item.url).map(item => item.platform)).toEqual(['instagram', 'youtube'])
  })

  it('舊資料借用的機構粉專不當成分校社群，尾斜線不影響判斷', () => {
    const socials = getCampusSocials(
      { facebook: 'https://www.facebook.com/ivykid/', line: null },
      [{ url: 'https://www.facebook.com/ivykid' }]
    )
    expect(socials.every(item => item.url === null)).toBe(true)
  })

  it('電話沒有對應已發布校區時，不猜測或套用其他校區社群', () => {
    expect(getCampusSocials(undefined)).toEqual([])
  })
})
