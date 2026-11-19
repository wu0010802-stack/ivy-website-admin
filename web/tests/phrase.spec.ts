import { describe, expect, it } from 'vitest'
import { phraseChunks } from '../app/utils/phrase'

// 短說明不從詞中間斷行（2026-11-13 環境頁精修）。斷詞本身交給 Intl.Segmenter（各執行環境詞典略有不同），
// 這裡用固定的假斷詞測併段規則，再用真的斷詞測「接起來一字不差」與幾個原本會斷壞的句子。
const fake = (...parts: string[]) => () => parts

describe('phraseChunks：把句子切成不該從中間斷行的小段', () => {
  it('標點跟著前一段，行首不會出現標點', () => {
    expect(phraseChunks('x', fake('每日', '兩', '蔬果', '，', '增進', '免疫', '、', '提升', '孩子', '的', '健康', '。')))
      .toEqual(['每日兩', '蔬果，', '增進', '免疫、', '提升', '孩子的', '健康。'])
  })

  it('前引號、前括號跟著後一段；後引號、後括號跟著前一段', () => {
    expect(phraseChunks('x', fake('老師', '說', '「', '慢慢', '來', '」', '（', '不急', '）', '就好')))
      .toEqual(['老師說', '「慢慢來」', '（不急）', '就好'])
  })

  it('單字詞併到前一段；前面是標點或句首時併到後一段', () => {
    expect(phraseChunks('x', fake('協調', '力', '，', '讓', '寶貝', '開心'))).toEqual(['協調力，', '讓寶貝', '開心'])
    expect(phraseChunks('x', fake('讓', '孩子', '吃到'))).toEqual(['讓孩子', '吃到'])
  })

  it('修飾後面的單字詞（最、好、大…）併到後一段', () => {
    expect(phraseChunks('x', fake('食物', '最', '原始', '的', '味道'))).toEqual(['食物', '最原始的', '味道'])
    expect(phraseChunks('x', fake('明亮', '的', '大', '廣場'))).toEqual(['明亮的', '大廣場'])
  })

  it('連著兩個疊字詞併成一段', () => {
    expect(phraseChunks('x', fake('寶貝', '唱唱', '跳跳', '好', '開心'))).toEqual(['寶貝', '唱唱跳跳', '好開心'])
  })

  it('一長串單字詞不會併成一整塊：一段最多 6 個字', () => {
    const chunks = phraseChunks('x', fake(...Array.from('一二三四五六七八九十')))
    expect(Math.max(...chunks.map((chunk) => chunk.length))).toBeLessThanOrEqual(6)
    expect(chunks.join('')).toBe('一二三四五六七八九十')
  })

  it('空白跟著前一段（空白本身就能換行）', () => {
    expect(phraseChunks('x', fake('看', ' ', '11', ' ', '月', '菜單'))).toEqual(['看 ', '11 ', '月菜單'])
  })

  it('切不出兩段以上就整句回傳；空字串回空清單', () => {
    expect(phraseChunks('常春藤', fake('常春藤'))).toEqual(['常春藤'])
    expect(phraseChunks('')).toEqual([])
  })

  it('用執行環境的斷詞：接起來和原文一字不差，原本斷壞的詞留在同一段', () => {
    const samples = [
      '每日兩蔬果，增進免疫、提升孩子的健康。',
      '隨時注意孩子身體狀況，每日定時測量體溫。',
      '連接教室的套房式衛廁，老師隨時留意寶貝的安全與如廁狀況；還在包尿布的寶貝，老師陪著慢慢練習。',
      '空間配置各校不同。'
    ]
    for (const text of samples) expect(phraseChunks(text).join('')).toBe(text)
    // Node 的 ICU 有中文詞典（官方版本都有）；沒有的環境 phraseChunks 會整句回傳，下面三項就不成立
    const chunks = samples.flatMap((text) => phraseChunks(text))
    for (const word of ['孩子的', '定時', '狀況']) expect(chunks.some((chunk) => chunk.includes(word))).toBe(true)
  })
})
