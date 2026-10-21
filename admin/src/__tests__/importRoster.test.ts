import { describe, expect, it } from 'vitest'
import { enrolledPreviewBody, parseRosterHtml, RosterFileError } from '../admissions/imports/roster'

// 只用合成資料：假姓名、假地址（同後端 test_admissions_imports_enrolled.py 的 STUDENTS）。
const HEADER = ['編號', '幼生姓名', '性別', '出生日期', '入學日期', '實際年齡', '通訊地址']
const INSTITUTION = '高雄市私立常春藤測試幼兒園'

// [出生日期, 通訊地址]
type Pair = [string, string]
const PAIRS: Pair[] = [
  ['2023/03/01', '本揚里1鄰義華路68號'],
  ['2023/03/01', '本揚里1鄰義華路68號'],
  ['2022/05/10', '高雄市三民區義華路999號'],
  ['2022/06/20', '臺北市內湖區文德路1號'],
]

interface Options {
  printed?: string | null
  header?: string[]
  institution?: string | null
  cell?: 'td' | 'th'
}

// 仿教保資訊網「園所幼生清冊」匯出檔：抬頭一張表、名冊一張表；表頭加「幼生姓名」欄，姓名填假值。
function rosterHtml(pairs: Pair[], { printed = '2026/10/15', header = HEADER, institution = INSTITUTION, cell = 'td' }: Options = {}): string {
  const titleRow = institution === null ? '' : `<tr><td>${institution}</td></tr>`
  const printedRow = printed === null ? '' : `<tr><td>列印日期：${printed}</td></tr>`
  const head = header.map((name) => `<${cell}>${name}</${cell}>`).join('')
  const body = pairs
    .map(([birthday, address], index) => {
      const values: Record<string, string> = {
        編號: String(index + 1),
        幼生姓名: '測試小明',
        性別: '男',
        出生日期: birthday,
        入學日期: '2025/08/01',
        實際年齡: '3歲7個月',
        通訊地址: address,
      }
      return `<tr>${header.map((name) => `<${cell}>${values[name]}</${cell}>`).join('')}</tr>`
    })
    .join('')
  return (
    '<meta http-equiv=Content-Type content=text/html;charset=utf-8>' +
    `<div id="ContentPlaceHolder1"><table>${titleRow}${printedRow}</table><table><tr>${head}</tr>${body}</table></div>`
  )
}

function errorOf(run: () => unknown): Error {
  try {
    run()
  } catch (error) {
    return error as Error
  }
  throw new Error('應該丟錯誤，但沒有')
}

describe('parseRosterHtml', () => {
  it('只取出生日期與通訊地址，認得列印日期與園所名稱', () => {
    const roster = parseRosterHtml(rosterHtml(PAIRS))
    expect(roster.students).toHaveLength(4)
    expect(roster.students[0]).toEqual({ birthday: '2023-03-01', address: '本揚里1鄰義華路68號' })
    expect(roster.students[3]).toEqual({ birthday: '2022-06-20', address: '臺北市內湖區文德路1號' })
    expect(roster.printedOn).toBe('2026-10-15')
    expect(roster.institution).toBe(INSTITUTION)
  })

  it('回傳值只有生日與地址，姓名與其他欄都不留', () => {
    const roster = parseRosterHtml(rosterHtml(PAIRS))
    expect(Object.keys(roster).sort()).toEqual(['institution', 'printedOn', 'students'])
    expect(Object.keys(roster.students[0]!).sort()).toEqual(['address', 'birthday'])
    const text = JSON.stringify(roster)
    for (const leaked of ['測試小明', '2025/08/01', '3歲7個月']) expect(text).not.toContain(leaked)
  })

  it('依表頭文字找欄，欄位順序不影響；th 與 td 一視同仁', () => {
    const header = ['通訊地址', '實際年齡', '出生日期', '編號']
    const roster = parseRosterHtml(rosterHtml([['2022/02/11', '測試路1號']], { header, cell: 'th' }))
    expect(roster.students).toEqual([{ birthday: '2022-02-11', address: '測試路1號' }])
  })

  it('生日不補零也收，輸出一律補零；閏日收、不存在的日期不收', () => {
    const roster = parseRosterHtml(rosterHtml([['2023/3/1', '測試路1號'], ['2024/02/29', '測試路2號']]))
    expect(roster.students.map((student) => student.birthday)).toEqual(['2023-03-01', '2024-02-29'])
    for (const birthday of ['2023/02/30', '2023/02/29', '2023/13/01', '2023/00/10', '2023/04/31']) {
      expect(errorOf(() => parseRosterHtml(rosterHtml([[birthday, '測試路1號']]))).message).toBe('名冊第 2 列的出生日期不是 YYYY/MM/DD')
    }
  })

  it('HTML 實體字元會解碼，地址只去頭尾空白', () => {
    const roster = parseRosterHtml(rosterHtml([['2022/02/11', ' 測試里1鄰&nbsp;測試路&#49;號 ']]))
    expect(roster.students[0]!.address).toBe('測試里1鄰 測試路1號')
  })

  it('沒有列印日期、日期不存在或沒有園所名稱時是 null', () => {
    expect(parseRosterHtml(rosterHtml(PAIRS, { printed: null })).printedOn).toBeNull()
    expect(parseRosterHtml(rosterHtml(PAIRS, { printed: '2026/02/30' })).printedOn).toBeNull()
    expect(parseRosterHtml(rosterHtml(PAIRS, { printed: '2026/1/5' })).printedOn).toBe('2026-01-05')
    expect(parseRosterHtml(rosterHtml(PAIRS, { institution: null })).institution).toBeNull()
  })

  it('園所名稱：含「常春藤」也行，空白收成一格、最多 60 字，且不取名冊表格裡的格子', () => {
    expect(parseRosterHtml(rosterHtml(PAIRS, { institution: '常春藤\n  測試分校' })).institution).toBe('常春藤 測試分校')
    expect(parseRosterHtml(rosterHtml(PAIRS, { institution: `${INSTITUTION}${'長'.repeat(80)}` })).institution).toHaveLength(60)
    const header = [...HEADER.slice(0, 1), '幼兒園班別', ...HEADER.slice(1)]
    expect(parseRosterHtml(rosterHtml(PAIRS, { header, institution: null })).institution).toBeNull()
  })

  it('名冊表格外包一層版面表格時，園所名稱也不會帶出學生資料', () => {
    const html = `<table><tr><td>${INSTITUTION}${rosterHtml(PAIRS, { institution: null, printed: null })}</td></tr></table>`
    const roster = parseRosterHtml(html)
    expect(roster.students).toHaveLength(4)
    expect(roster.institution).toBeNull()
  })

  it('名冊表格是第一列同時有兩欄的那一張，前面只有一欄的表格略過', () => {
    const decoy = '<table><tr><td>通訊地址</td></tr><tr><td>不是名冊</td></tr></table>'
    const roster = parseRosterHtml(decoy + rosterHtml(PAIRS))
    expect(roster.students).toHaveLength(4)
  })

  it.each([
    ['欄數和表頭不同', '<tr><td>9</td><td>測試小明</td></tr>', '名冊第 3 列的欄數和表頭不同'],
    ['出生日期格式錯誤', null, '名冊第 3 列的出生日期不是 YYYY/MM/DD'],
  ])('格式錯誤時的訊息：%s，只寫第幾列、不含地址', (_name, extraRow, message) => {
    const html =
      extraRow === null
        ? rosterHtml([PAIRS[0]!, ['111/02/11', '秘密路9號']])
        : rosterHtml([PAIRS[0]!]).replace('</table></div>', `${extraRow}</table></div>`)
    const error = errorOf(() => parseRosterHtml(html))
    expect(error).toBeInstanceOf(RosterFileError)
    expect(error.message).toBe(message)
    expect(error.message).not.toContain('秘密路')
    expect(error.message).not.toContain('測試路')
  })

  it('名冊沒有任何學生', () => {
    const error = errorOf(() => parseRosterHtml(rosterHtml([])))
    expect(error).toBeInstanceOf(RosterFileError)
    expect(error.message).toBe('名冊沒有任何學生')
  })

  it('缺必要欄位時說找不到名冊表格', () => {
    for (const header of [['編號', '通訊地址'], ['編號', '出生日期']]) {
      const error = errorOf(() => parseRosterHtml(rosterHtml([['2022/02/11', '測試路1號']], { header })))
      expect(error).toBeInstanceOf(RosterFileError)
      expect(error.message).toBe('找不到有「出生日期」「通訊地址」兩欄的名冊表格')
    }
  })

  it('不是 HTML 的檔案丟 RosterFileError', () => {
    const pdf = String.fromCharCode(...[0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])
    for (const text of [pdf, '']) {
      const error = errorOf(() => parseRosterHtml(text))
      expect(error).toBeInstanceOf(RosterFileError)
      expect(error.message).toBe('找不到有「出生日期」「通訊地址」兩欄的名冊表格')
    }
  })

  it('不執行檔案裡的腳本', () => {
    parseRosterHtml('<script>window.__pwned=1</script><img src=x onerror="window.__pwned=1">' + rosterHtml(PAIRS))
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined()
  })
})

describe('enrolledPreviewBody', () => {
  const html = rosterHtml(PAIRS)

  it('以名冊日期的學年換算班別，只輸出 roster_date 與每位的 grade、address', () => {
    // 學年 115：2023/03/01 滿 3 歲 → 小班；2022 年生 → 中班。
    expect(enrolledPreviewBody(parseRosterHtml(html), '2026-10-15')).toEqual({
      roster_date: '2026-10-15',
      students: [
        { grade: '小班', address: '本揚里1鄰義華路68號' },
        { grade: '小班', address: '本揚里1鄰義華路68號' },
        { grade: '中班', address: '臺北市內湖區文德路1號' },
        { grade: '中班', address: '高雄市三民區義華路999號' },
      ],
    })
  })

  it('送出的本文沒有姓名與生日，也看不出清冊列序', () => {
    const reversedHtml = rosterHtml([...PAIRS].reverse())
    const body = enrolledPreviewBody(parseRosterHtml(html), '2026-10-15')
    const text = JSON.stringify(body)
    expect(text).not.toContain('測試小明')
    expect(text).not.toContain('2023/03/01')
    expect(text).not.toContain('2023-03-01')
    expect(Object.keys(body.students[0]!).sort()).toEqual(['address', 'grade'])
    expect(enrolledPreviewBody(parseRosterHtml(reversedHtml), '2026-10-15')).toEqual(body)
  })

  it('依班別（幼幼班→小班→中班→大班→其他）再依地址排序，地址用字碼比較、不看語系', () => {
    const roster = parseRosterHtml(
      rosterHtml([
        ['2019/03/03', '乙路1號'], // 7 歲 → 其他
        ['2021/01/05', '丙路3號'], // 大班
        ['2022/05/10', '乙路2號'], // 中班
        ['2024/04/04', '甲路1號'], // 幼幼班
        ['2022/05/11', 'B路1號'],
        ['2022/05/12', 'a路1號'],
        ['2023/03/01', '甲路2號'], // 小班
        ['2024/10/10', '甲路0號'], // 學年中滿 2 歲 → 幼幼班
      ]),
    )
    const body = enrolledPreviewBody(roster, '2026-10-15')
    expect(body.students.map((student) => [student.grade, student.address])).toEqual([
      ['幼幼班', '甲路0號'],
      ['幼幼班', '甲路1號'],
      ['小班', '甲路2號'],
      ['中班', 'B路1號'],
      ['中班', 'a路1號'],
      ['中班', '乙路2號'],
      ['大班', '丙路3號'],
      ['其他', '乙路1號'],
    ])
  })

  it('學年跟著名冊日期走：同一份名冊在 2027-02 與 2026-10 的班別不同', () => {
    const roster = parseRosterHtml(rosterHtml([['2023/03/01', '測試路1號']]))
    expect(enrolledPreviewBody(roster, '2026-10-15').students[0]!.grade).toBe('小班')
    // 2027-02 仍是 115 學年下學期；2027-08 起換 116 學年，同一位升中班。
    expect(enrolledPreviewBody(roster, '2027-02-01').students[0]!.grade).toBe('小班')
    expect(enrolledPreviewBody(roster, '2027-10-01').students[0]!.grade).toBe('中班')
  })
})
