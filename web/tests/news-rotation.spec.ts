import { describe, expect, it } from 'vitest'
import { newsPageCount, newsPageItems } from '../app/utils/newsRotation'

describe('首頁最新消息輪播分組', () => {
  const ids = (count: number) => Array.from({ length: count }, (_, i) => `n${i + 1}`)

  it('三則以內不輪播，照原順序全部顯示', () => {
    expect(newsPageCount(0)).toBe(1)
    expect(newsPageCount(3)).toBe(1)
    expect(newsPageItems(ids(2), 0)).toEqual(['n1', 'n2'])
    expect(newsPageItems(ids(3), 5)).toEqual(['n1', 'n2', 'n3'])
  })

  it('六則分兩組三則交替，組數以外從頭循環', () => {
    expect(newsPageCount(6)).toBe(2)
    expect(newsPageItems(ids(6), 0)).toEqual(['n1', 'n2', 'n3'])
    expect(newsPageItems(ids(6), 1)).toEqual(['n4', 'n5', 'n6'])
    expect(newsPageItems(ids(6), 2)).toEqual(['n1', 'n2', 'n3'])
  })

  it('最後一組不足三則時從頭補滿，三格永遠有內容', () => {
    expect(newsPageCount(4)).toBe(2)
    expect(newsPageItems(ids(4), 1)).toEqual(['n4', 'n1', 'n2'])
    expect(newsPageCount(7)).toBe(3)
    expect(newsPageItems(ids(7), 2)).toEqual(['n7', 'n1', 'n2'])
  })
})
