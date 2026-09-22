/** 手機紙張初始化共用佇列：等捲動停止，且一次只啟動一張。 */
const IDLE_MS = 200

type IdleTask = { run: () => Promise<void> | void }
const queue: IdleTask[] = []
let timer: ReturnType<typeof setTimeout> | undefined
let running = false
let listening = false
let lastScrollAt = 0
let nextTaskAt = 0

/** 未觀測時不推定 idle；執行中的 task 可在 await 後再次確認。 */
export function isScrollIdle(): boolean {
  return listening && performance.now() - lastScrollAt >= IDLE_MS
}

function releaseIfEmpty() {
  // 執行中的 async task 仍需觀測 scroll，供 await 後的檢查使用。
  if (queue.length || running) return
  clearTimeout(timer)
  timer = undefined
  if (listening) window.removeEventListener('scroll', onScroll)
  listening = false
}

function scheduleNext() {
  if (running || !queue.length) return
  clearTimeout(timer)
  const delay = Math.max(0, Math.max(lastScrollAt + IDLE_MS, nextTaskAt) - performance.now())
  timer = setTimeout(runNext, delay)
}

function onScroll() {
  lastScrollAt = performance.now()
  scheduleNext()
}

async function runNext() {
  timer = undefined
  if (running) return
  if (!isScrollIdle() || performance.now() < nextTaskAt) {
    scheduleNext()
    return
  }
  const task = queue.shift()
  if (!task) { releaseIfEmpty(); return }
  running = true
  try {
    await task.run()
  } catch (error) {
    // 一張卡失敗不阻塞其餘卡片；呼叫端仍能在自己的 task 處理 fallback。
    console.error('[scrollIdle] Task failed', error)
  } finally {
    running = false
    // 即使期間一直沒有捲動，也不把多張初始化擠在同一個空檔。
    nextTaskAt = performance.now() + IDLE_MS
    if (queue.length) scheduleNext()
    else releaseIfEmpty()
  }
}

/** 取消僅適用尚未開始的 task；已開始的 async 工作由呼叫端檢查 connected 狀態。 */
export function scheduleScrollIdle(run: () => Promise<void> | void): () => void {
  if (typeof window === 'undefined') return () => {}
  const task = { run }
  queue.push(task)
  if (!listening) {
    listening = true
    lastScrollAt = performance.now()
    nextTaskAt = lastScrollAt
    window.addEventListener('scroll', onScroll, { passive: true })
  }
  scheduleNext()
  return () => {
    const index = queue.indexOf(task)
    if (index < 0) return
    queue.splice(index, 1)
    releaseIfEmpty()
  }
}
