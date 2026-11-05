// 後台的 Service worker（scope /admin/，2026-11-05）：只負責手機推播（Web Push）。
// 不攔截請求、不快取任何東西（沒有 fetch handler）：後台每次發版都換檔名，舊版 worker 不能把舊畫面卡住。
// 推播內容由 API 送來（backend/app/notifications/web_push.py），格式 {title, body, url, tag}；
// 內容不含家長姓名、電話、Email（鎖定畫面看得到）。這支檔案不經過打包，維持純 JS、沒有 import。

const ADMIN_HOME = '/admin/'
const FALLBACK_TITLE = '官網後台有新通知'
const ICON = '/admin/pwa-192.png'

// 點通知要開的網址：只收同源、/admin/ 底下的路徑（含 query 與 #），其他一律回後台首頁。
function safeAdminUrl(value) {
  try {
    const url = new URL(String(value), self.location.origin)
    if (url.origin === self.location.origin && url.pathname.startsWith(ADMIN_HOME)) {
      return url.pathname + url.search + url.hash
    }
  } catch (_) {
    // 不是網址
  }
  return ADMIN_HOME
}

function text(value, limit) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, limit) : ''
}

// 解不開（不是 JSON、沒有本文）就當成沒有內容，顯示通用通知；iOS 要求每則推播都要顯示通知。
function readPayload(event) {
  try {
    const data = event.data ? event.data.json() : null
    return data && typeof data === 'object' ? data : {}
  } catch (_) {
    return {}
  }
}

function notificationFor(payload) {
  const tag = text(payload.tag, 100)
  const options = { icon: ICON, data: { url: safeAdminUrl(payload.url) } }
  const body = text(payload.body, 300)
  if (body) options.body = body
  // 同一個 tag 的新通知取代舊的；renotify 讓取代時仍然會響（沒有 tag 時設 renotify 會丟例外）。
  if (tag) {
    options.tag = tag
    options.renotify = true
  }
  return { title: text(payload.title, 120) || FALLBACK_TITLE, options }
}

async function openAdminWindow(target) {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  for (const client of windows) {
    let url
    try {
      url = new URL(client.url)
    } catch (_) {
      continue
    }
    if (url.origin !== self.location.origin || !url.pathname.startsWith(ADMIN_HOME)) continue
    try {
      const focused = await client.focus()
      await (focused || client).navigate(target)
      return
    } catch (_) {
      // 這個瀏覽器不能導覽既有視窗：改開新視窗
      break
    }
  }
  await self.clients.openWindow(target)
}

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  const { title, options } = notificationFor(readPayload(event))
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data
  event.waitUntil(openAdminWindow(safeAdminUrl(data && data.url)))
})
