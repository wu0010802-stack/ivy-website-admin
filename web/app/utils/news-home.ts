import type { Campus, HomeFilm, NewsArticle, NewsEvent } from '../types/site-content'
import { newsInCampus } from './news-content'
import { escapeText, foldLine } from './visit-calendar'

/**
 * 首頁「近期活動／最新消息」2026-10-17 改版用的純函式：桌機方向 1（活動放大、消息依校區篩、不輪播），
 * 手機方向 3（活動、消息、活動影片排成一列直式卡，點開連續看）。比稿在 design/news-directions-20261017。
 */

type CampusRef = Pick<Campus, 'key' | 'name'>
type Scoped = Pick<NewsArticle, 'campus' | 'campusKeys'>

/** 篩選鈕與校區圈的短名：「義華校」→「義華」。 */
export function campusShort(name: string): string {
  return name.replace(/校$/, '')
}

/** 這一則是不是這一校「自己的」（全校消息不算）；沒有 campusKeys 的內建示意消息比對校名。 */
export function ownedByCampus(item: Scoped, campus: CampusRef): boolean {
  if (item.campusKeys) return item.campusKeys.includes(campus.key)
  return item.campus.split('、').map((name) => name.trim()).includes(campus.name)
}

export interface CampusOption { key: string; label: string; count: number }

/**
 * 首頁消息的校區篩選：只列有自己消息的校區（數字含全校消息）。
 * 少於兩校有自己的消息時，篩選只剩「全部」和一校，等於沒得選，回空陣列不出篩選。
 */
export function campusFilterOptions(articles: readonly NewsArticle[], campuses: readonly CampusRef[]): CampusOption[] {
  const owners = campuses.filter((c) => articles.some((a) => ownedByCampus(a, c)))
  if (owners.length < 2) return []
  return [
    { key: 'all', label: '全部', count: articles.length },
    ...owners.map((c) => ({ key: c.key, label: campusShort(c.name), count: articles.filter((a) => newsInCampus(a, c.key, c.name)).length })),
  ]
}

export const HOME_FEED_ROWS = 3

export interface HomeFeed { lead?: NewsArticle; rest: NewsArticle[]; others: NewsArticle[] }

/**
 * 桌機消息區：一則大圖＋最多三列。只看一校而這一校不到四則時，用其他校區最近的補滿三列（畫面標明是其他校區），
 * 不讓右欄空掉，也不放參觀入口（2026-10-17 使用者裁定拿掉）。順序沿用首頁消息（homeArticles）。
 */
export function homeFeed(articles: readonly NewsArticle[], campus: CampusRef | undefined): HomeFeed {
  const mine = campus ? articles.filter((a) => newsInCampus(a, campus.key, campus.name)) : [...articles]
  const [lead, ...after] = mine
  const rest = after.slice(0, HOME_FEED_ROWS)
  const others = campus
    ? articles.filter((a) => !newsInCampus(a, campus.key, campus.name)).slice(0, HOME_FEED_ROWS - rest.length)
    : []
  return { lead, rest, others }
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']
const utcDay = (date: string) => {
  const [y, m, d] = date.split('-').map(Number)
  return Date.UTC(y!, m! - 1, d!)
}

/** YYYY-MM-DD 當成台北的日曆日拆開（用 UTC 算星期，不受伺服器或瀏覽器時區影響）。 */
export function dateParts(date: string): { year: number; month: number; day: number; weekday: string } {
  const [year, month, day] = date.split('-').map(Number)
  return { year: year!, month: month!, day: day!, weekday: WEEKDAYS[new Date(utcDay(date)).getUTCDay()]! }
}

export function daysBetween(from: string, to: string): number {
  return Math.round((utcDay(to) - utcDay(from)) / 86_400_000)
}

/** 活動卡的倒數：今天、明天，其他寫「還有 N 天」（活動過期會自動下架，不會有負數）。 */
export function countdownLabel(today: string, date: string): string {
  const n = daysBetween(today, date)
  if (n <= 0) return '今天'
  if (n === 1) return '明天'
  return `還有 ${n} 天`
}

// ── 加入行事曆 ──────────────────────────────────────────────

type CalendarEvent = Pick<NewsEvent, 'id' | 'date' | 'campus' | 'title' | 'description' | 'allDay' | 'startTime' | 'endTime' | 'location'>

/** 台北沒有日光節約：當地時間直接減 8 小時就是 UTC。 */
function taipeiTime(date: string, time: string): number {
  const [h, m] = time.split(':').map(Number)
  return utcDay(date) + (h! - 8) * 3_600_000 + m! * 60_000
}
/** 20261024T013000Z */
const utcStamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
const compactDate = (date: string) => date.replaceAll('-', '')
const nextDate = (date: string) => new Date(utcDay(date) + 86_400_000).toISOString().slice(0, 10)

/** 有開始時間才算有時段（同 eventTimeDetail）；只有開始時間時當一小時。全天用日期，結束是隔天。 */
function calendarRange(event: CalendarEvent): { timed: boolean; start: string; end: string } {
  if (event.allDay === false && event.startTime) {
    const start = taipeiTime(event.date, event.startTime)
    const end = event.endTime ? taipeiTime(event.date, event.endTime) : start + 3_600_000
    return { timed: true, start: utcStamp(start), end: utcStamp(end) }
  }
  return { timed: false, start: compactDate(event.date), end: compactDate(nextDate(event.date)) }
}

const calendarTitle = (event: CalendarEvent) => `${event.title}｜常春藤${event.campus}`

export function eventGoogleCalendarUrl(event: CalendarEvent): string {
  const { start, end } = calendarRange(event)
  const query = new URLSearchParams({
    action: 'TEMPLATE',
    text: calendarTitle(event),
    dates: `${start}/${end}`,
    details: event.description,
    location: event.location ?? '',
    ctz: 'Asia/Taipei',
  })
  return `https://calendar.google.com/calendar/render?${query}`
}

/** Apple、Outlook 用的 .ics（RFC 5545：CRLF、文字跳脫、75 位元組折行，沿用 visit-calendar 的寫法），前一天提醒。 */
export function eventIcs(event: CalendarEvent, now = new Date()): string {
  const { timed, start, end } = calendarRange(event)
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Ivy Education//Website Event//ZH-TW',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${event.id}-${event.date}@ivy-kids`,
    `DTSTAMP:${utcStamp(now.getTime())}`,
    timed ? `DTSTART:${start}` : `DTSTART;VALUE=DATE:${start}`,
    timed ? `DTEND:${end}` : `DTEND;VALUE=DATE:${end}`,
    `SUMMARY:${escapeText(calendarTitle(event))}`,
    `DESCRIPTION:${escapeText(event.description)}`,
    `LOCATION:${escapeText(event.location ?? '')}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeText(`明天：${event.title}`)}`,
    'TRIGGER:-P1D',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return lines.map(foldLine).join('\r\n') + '\r\n'
}

export function eventIcsFileName(title: string): string {
  return `${title.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'event'}.ics`
}

// ── 手機動態 ──────────────────────────────────────────────

export type HomeStory =
  | { kind: 'event'; id: string; event: NewsEvent; tint: number }
  | { kind: 'news'; id: string; article: NewsArticle }
  | { kind: 'film'; id: string; film: HomeFilm }

/** 活動（今天以後、近到遠）排最前，接著首頁消息，最後是活動影片。活動輪流用三種底色。 */
export function homeStories(events: readonly NewsEvent[], articles: readonly NewsArticle[], films: readonly HomeFilm[]): HomeStory[] {
  return [
    ...events.map((event, i): HomeStory => ({ kind: 'event', id: `event:${event.id}`, event, tint: i % 3 })),
    ...articles.map((article): HomeStory => ({ kind: 'news', id: `news:${article.id}`, article })),
    ...films.map((film): HomeStory => ({ kind: 'film', id: `film:${film.id}`, film })),
  ]
}

/** 一校的動態：適用這一校的活動（含全校）＋這一校自己的消息。影片沒有校區欄位，只在「全部」出現。 */
export function storiesForCampus(stories: readonly HomeStory[], campus: CampusRef | undefined): HomeStory[] {
  if (!campus) return [...stories]
  return stories.filter((s) =>
    s.kind === 'event' ? newsInCampus(s.event, campus.key, campus.name)
      : s.kind === 'news' ? ownedByCampus(s.article, campus)
        : false)
}

/** 校區圈：「全部」＋有自己活動或消息的校區。 */
export function storyRings(stories: readonly HomeStory[], campuses: readonly CampusRef[]): CampusOption[] {
  const owns = (c: CampusRef) => stories.some((s) => (s.kind === 'event' && ownedByCampus(s.event, c)) || (s.kind === 'news' && ownedByCampus(s.article, c)))
  return [
    { key: 'all', label: '全部', count: stories.length },
    ...campuses.filter(owns).map((c) => ({ key: c.key, label: campusShort(c.name), count: storiesForCampus(stories, c).length })),
  ]
}
