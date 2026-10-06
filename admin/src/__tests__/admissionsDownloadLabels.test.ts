// 招生訪視明細的後台 CSV 由後端產生（backend/app/admissions/download.py），文字對照在 Python 另放一份，
// 畫面（這裡的 constants.ts、sourceCategories.ts）改了、CSV 沒跟上，園方會在畫面與下載檔看到兩種說法。
// 這裡直接讀後端原始碼比對，不靠人記得同步（做法同 labelCoverage.test.ts）。
import { describe, expect, it } from 'vitest'
import { WITHDRAWN_FROM_LABELS, stageMeta } from '../admissions/constants'
import { SOURCE_CATEGORY_CHOICES, sourceCategoryLabel } from '../admissions/sourceCategories'

const sources = import.meta.glob('../../../backend/app/admissions/download.py', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>
const downloadPy = Object.values(sources)[0]

// download.py 裡 `NAME = {"key": "value", ...}` 的所有鍵值（依出現順序）。
function pyDict(name: string): [string, string][] {
  if (!downloadPy) throw new Error('找不到 backend/app/admissions/download.py')
  const start = downloadPy.indexOf(`${name} = {`)
  if (start === -1) throw new Error(`download.py 找不到 ${name}`)
  const block = downloadPy.slice(start, downloadPy.indexOf('}', start))
  return [...block.matchAll(/"([^"]+)":\s*"([^"]+)"/g)].map((m) => [m[1]!, m[2]!])
}

describe('CSV 的來源分類短文字和後台表單一致', () => {
  it('六個代碼與短文字、順序都同 SOURCE_CATEGORY_CHOICES', () => {
    const python = pyDict('SOURCE_CATEGORY_SHORT_LABELS')
    expect(python.length).toBe(SOURCE_CATEGORY_CHOICES.length)
    expect(python).toEqual(SOURCE_CATEGORY_CHOICES.map(([code, label]) => [code, label]))
  })

  it('畫面顯示用的 sourceCategoryLabel 對這六項給的文字就是 CSV 的文字', () => {
    for (const [code, label] of pyDict('SOURCE_CATEGORY_SHORT_LABELS')) expect(sourceCategoryLabel(code), code).toBe(label)
  })
})

describe('CSV 的階段文字和後台 stageMeta 一致', () => {
  it('退出依 withdrawn_from 寫「已退預繳」或「已退註冊」，代碼與文字同 WITHDRAWN_FROM_LABELS', () => {
    expect(Object.fromEntries(pyDict('WITHDRAWN_FROM_LABELS'))).toEqual(WITHDRAWN_FROM_LABELS)
    for (const [from, label] of pyDict('WITHDRAWN_FROM_LABELS')) {
      expect(stageMeta({ stage: 'withdrawn', withdrawn_at: '2026-09-09T00:00:00Z', withdrawn_from: from }).label).toBe(`已${label}`)
    }
  })

  it('沒有 withdrawn_from 的退出當成從預繳退', () => {
    const python = Object.fromEntries(pyDict('WITHDRAWN_FROM_LABELS'))
    expect(stageMeta({ stage: 'withdrawn', withdrawn_at: '2026-09-09T00:00:00Z', withdrawn_from: null }).label).toBe(`已${python.deposited}`)
  })
})
