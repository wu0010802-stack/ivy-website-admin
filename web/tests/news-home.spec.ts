import { describe, expect, it } from 'vitest'
import {
  campusFilterOptions,
  campusShort,
  countdownLabel,
  dateParts,
  eventGoogleCalendarUrl,
  eventIcs,
  eventIcsFileName,
  homeFeed,
  homeStories,
  storiesForCampus,
  storyRings,
} from '../app/utils/news-home'
import type { Campus, HomeFilm, NewsArticle, NewsEvent } from '../app/types/site-content'

const campus = (key: string, name: string) => ({ key, name }) as Campus
const campuses = [campus('yihua', '義華校'), campus('minghua', '明華校'), campus('chongde', '崇德校'), campus('renwu', '仁武校')]
const article = (id: string, date: string, keys?: string[], name = '義華校'): NewsArticle => ({
  id, date, campus: name, campusKeys: keys, category: '校園日常', title: id, description: '', image: 'x', alt: '',
})
const event = (id: string, date: string, extra: Partial<NewsEvent> = {}): NewsEvent => ({
  id, date, month: 'OCT', campus: '全校', campusKeys: [], title: '親子探索日', description: '帶水壺', ...extra,
})

describe('首頁消息的校區篩選（2026-10-17 方向 1）', () => {
  const articles = [
    article('a', '2026-10-08', ['yihua']),
    article('b', '2026-10-02', ['yihua']),
    article('c', '2026-09-10', ['renwu'], '仁武校'),
    article('d', '2026-09-08', [], '全校'),
  ]

  it('只列有自己消息的校區，數字含全校消息', () => {
    expect(campusFilterOptions(articles, campuses)).toEqual([
      { key: 'all', label: '全部', count: 4 },
      { key: 'yihua', label: '義華', count: 3 },
      { key: 'renwu', label: '仁武', count: 2 },
    ])
  })

  it('只有一校有自己的消息時不出篩選（只剩「全部」等於沒得選）', () => {
    expect(campusFilterOptions(articles.filter((a) => a.id !== 'c'), campuses)).toEqual([])
  })

  it('內建示意消息沒有 campusKeys 時比對校名', () => {
    const fixture = [article('x', '2026-09-16', undefined, '義華校'), article('y', '2026-09-10', undefined, '仁武校')]
    expect(campusFilterOptions(fixture, campuses).map((o) => o.key)).toEqual(['all', 'yihua', 'renwu'])
  })

  it('全部：一則大圖＋最多三列，不補其他校區', () => {
    const feed = homeFeed([...articles, article('e', '2026-09-01', ['minghua'], '明華校')], undefined)
    expect(feed.lead?.id).toBe('a')
    expect(feed.rest.map((a) => a.id)).toEqual(['b', 'c', 'd'])
    expect(feed.others).toEqual([])
  })

  it('只看一校而消息不到四則時，用其他校區最近的補滿三列', () => {
    const feed = homeFeed(articles, campus('renwu', '仁武校'))
    expect(feed.lead?.id).toBe('c')
    expect(feed.rest.map((a) => a.id)).toEqual(['d'])
    expect(feed.others.map((a) => a.id)).toEqual(['a', 'b'])
  })

  it('校名去掉「校」當篩選鈕文字', () => {
    expect(campusShort('義華校')).toBe('義華')
    expect(campusShort('國際')).toBe('國際')
  })
})

describe('活動日期與倒數', () => {
  it('星期用台北的日曆日，不受執行環境時區影響', () => {
    expect(dateParts('2026-10-24')).toEqual({ year: 2026, month: 10, day: 24, weekday: '六' })
    expect(dateParts('2026-11-02')).toMatchObject({ weekday: '一' })
  })

  it('今天、明天，其他寫還有幾天', () => {
    expect(countdownLabel('2026-10-17', '2026-10-17')).toBe('今天')
    expect(countdownLabel('2026-10-17', '2026-10-18')).toBe('明天')
    expect(countdownLabel('2026-10-17', '2026-10-24')).toBe('還有 7 天')
    expect(countdownLabel('2026-12-31', '2027-01-02')).toBe('還有 2 天')
  })
})

describe('加入行事曆', () => {
  const timed = event('outdoor', '2026-10-24', { allDay: false, startTime: '09:30', endTime: '11:30', location: '各校園' })

  it('Google 日曆：台北時間換成 UTC，標題帶校區', () => {
    const url = new URL(eventGoogleCalendarUrl(timed))
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render')
    expect(url.searchParams.get('action')).toBe('TEMPLATE')
    expect(url.searchParams.get('dates')).toBe('20261024T013000Z/20261024T033000Z')
    expect(url.searchParams.get('text')).toBe('親子探索日｜常春藤全校')
    expect(url.searchParams.get('location')).toBe('各校園')
    expect(url.searchParams.get('ctz')).toBe('Asia/Taipei')
  })

  it('全天活動用日期，結束是隔天（跨月也對）', () => {
    const url = new URL(eventGoogleCalendarUrl(event('x', '2026-10-31')))
    expect(url.searchParams.get('dates')).toBe('20261031/20261101')
  })

  it('只有開始時間時當一小時；跨過台北午夜換算到前一天 UTC', () => {
    const early = event('y', '2026-10-24', { allDay: false, startTime: '07:00' })
    expect(new URL(eventGoogleCalendarUrl(early)).searchParams.get('dates')).toBe('20261023T230000Z/20261024T000000Z')
  })

  it('.ics：CRLF、UTC 時間、逗號分號換行要跳脫', () => {
    const ics = eventIcs({ ...timed, description: '帶水壺, 帽子; 防曬\n第二行' }, new Date('2026-10-17T00:00:00Z'))
    expect(ics.split('\r\n')).toEqual(expect.arrayContaining([
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT',
      'UID:outdoor-2026-10-24@ivy-kids', 'DTSTAMP:20261017T000000Z',
      'DTSTART:20261024T013000Z', 'DTEND:20261024T033000Z',
      'SUMMARY:親子探索日｜常春藤全校',
      'DESCRIPTION:帶水壺\\, 帽子\\; 防曬\\n第二行',
      'LOCATION:各校園', 'TRIGGER:-P1D', 'END:VEVENT', 'END:VCALENDAR',
    ]))
    expect(ics.endsWith('\r\n')).toBe(true)
  })

  it('全天活動的 .ics 用 VALUE=DATE', () => {
    const ics = eventIcs(event('x', '2026-10-31'), new Date('2026-10-17T00:00:00Z'))
    expect(ics).toContain('DTSTART;VALUE=DATE:20261031')
    expect(ics).toContain('DTEND;VALUE=DATE:20261101')
  })

  it('檔名拿掉不能當檔名的字元', () => {
    expect(eventIcsFileName('親子共讀・故事的午後')).toBe('親子共讀・故事的午後.ics')
    expect(eventIcsFileName('A/B: "C"?')).toBe('A B C.ics')
  })
})

describe('手機動態（2026-10-17 方向 3）', () => {
  const films: HomeFilm[] = [
    { id: 'run', title: '一起跑向前', type: 'file', src: '/a.mp4', start: 0, end: 9.7, poster: '/p.webp' },
    { id: 'yt-1', title: '放風箏', type: 'youtube', youtubeId: 'abc', poster: '/k.webp' },
  ]
  const articles = [article('a', '2026-10-08', ['yihua']), article('c', '2026-09-10', ['renwu'], '仁武校')]
  const events = [event('outdoor', '2026-10-24'), event('family', '2026-10-31', { campus: '義華校', campusKeys: ['yihua'] })]
  const stories = homeStories(events, articles, films)

  it('活動排最前，接著消息（照首頁順序），最後是活動影片', () => {
    expect(stories.map((s) => s.id)).toEqual(['event:outdoor', 'event:family', 'news:a', 'news:c', 'film:run', 'film:yt-1'])
    expect(stories.filter((s) => s.kind === 'event').map((s) => s.kind === 'event' && s.tint)).toEqual([0, 1])
  })

  it('一校的動態：適用這一校的活動（含全校）＋這一校自己的消息，不含影片', () => {
    expect(storiesForCampus(stories, campus('renwu', '仁武校')).map((s) => s.id)).toEqual(['event:outdoor', 'news:c'])
    expect(storiesForCampus(stories, undefined)).toHaveLength(6)
  })

  it('校區圈：只出現有自己活動或消息的校區', () => {
    expect(storyRings(stories, campuses)).toEqual([
      { key: 'all', label: '全部', count: 6 },
      { key: 'yihua', label: '義華', count: 3 },
      { key: 'renwu', label: '仁武', count: 2 },
    ])
  })
})
