// @vitest-environment node
import { describe, expect, it } from 'vitest'
import fixture from '../server/data/site-fixture.json'
import type { SiteContent } from '../app/types/site-content'
import { ADMISSION_TA_COPY, publicCopy } from '../app/utils/public-copy'
import { ADMISSION_FAQ } from '../app/utils/admission-faq'

// 2026-11-10 入學頁文字照目標家長（2 歲新手家長、轉園家長、接送的阿公阿嬤、新搬來家庭）改成白話。
// 內建內容（fixture）仍是原文，官網輸出時一字不差才換；這裡擋三件事：對照表沒有對不到原文的死條目、
// 改寫沒有動到數字（時間、張數、日期都是事實）、園方之後改過的句子照園方的。
const site = fixture as unknown as SiteContent
const texts = (admission: NonNullable<SiteContent['admission']>) => [
  admission.notice,
  ...admission.steps.map((step) => step.text),
  ...admission.phases.flatMap((phase) => phase.tips),
  admission.uniformNote,
  ...admission.pickupNotes,
  ...admission.registrationNotes,
  admission.allowanceNote
]
const digits = (text: string) => (text.match(/\d+/g) ?? []).sort().join(',')

describe('入學頁白話改寫（public-copy.ts 的 ADMISSION_TA_COPY）', () => {
  it('每一條原文都還在內建內容裡，輸出後都換成新句子', () => {
    const before = texts(site.admission!)
    const after = texts(publicCopy(site).admission!)
    for (const [original, next] of Object.entries(ADMISSION_TA_COPY)) {
      expect(before, original).toContain(original)
      expect(after, original).not.toContain(original)
      expect(after, next).toContain(next)
    }
  })

  it('只改說法：數字一個都沒變', () => {
    for (const [original, next] of Object.entries(ADMISSION_TA_COPY)) expect(digits(next), original).toBe(digits(original))
  })

  it('學校沒有接送證（2026-11-12）：新生準備、接送安全、孩子的一天背面都不再提，接送寫打電話', () => {
    const out = publicCopy(site)
    const page = [...texts(out.admission!), ...(out.dayExperience?.moments ?? []).map((moment) => moment.answer)].join('\n')
    expect(page).not.toMatch(/接送證|麻煩在/)
    expect(out.admission!.pickupNotes.join('')).toContain('30 分鐘先打電話告訴老師')
  })

  it('園方改過的句子照園方的，不被換掉', () => {
    const edited = { ...site, admission: { ...site.admission!, uniformNote: '制服於開學當週發放。', pickupNotes: ['接送請走側門。'] } }
    const out = publicCopy(edited).admission!
    expect(out.uniformNote).toBe('制服於開學當週發放。')
    expect(out.pickupNotes).toEqual(['接送請走側門。'])
  })

  it('整頁不再出現公文腔與行話', () => {
    const page = [...texts(publicCopy(site).admission!), ...ADMISSION_FAQ.flatMap((group) => group.items.flatMap((item) => [item.q, ...item.a]))].join('\n')
    expect(page).not.toMatch(/請勿|以免|以便|園所|園方|幼生|受託人|如廁|來電告知/)
    // 同日使用者要更正式：內文對家長說話用「您」，不寫「爸爸媽媽」（「請勿…以免…您的慌亂」那種公文句仍不用）。
    expect(page).not.toMatch(/爸爸媽媽|爸媽/)
    expect(page.match(/您/g)?.length).toBe(4)
  })
})
