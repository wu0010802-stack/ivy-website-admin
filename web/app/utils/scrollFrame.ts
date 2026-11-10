/**
 * 捲動驅動效果共用的每幀排程（2026-11-10 渲染流暢度）：同一幀裡所有效果先一起「讀」、再一起「寫」。
 *
 * 原本每個元件各自 scroll → requestAnimationFrame：排在前面的寫了 clip-path、CSS 變數、inert、class，
 * 排在後面的再讀 window.scrollY 或 getBoundingClientRect，瀏覽器就得在同一幀裡同步重算整頁樣式與版面。
 * 讀 window.scrollY 本身也算（Chromium 會先更新版面，實驗：版面髒時每次約 4ms，跟讀 offsetTop 一樣）。
 * 正式站手機 4 倍降速實測：頁首 10–33ms、孩子的一天淡出 12–39ms、簾幕 17–30ms、環境頁圓點小路 48ms。
 *
 * 規則：read 只讀版面（rect、offset、elementFromPoint），不寫 DOM；write 只寫，不讀版面。
 * scrollY 在這一幀開頭讀一次，傳給 read／write，不要在裡面再讀 window.scrollY。
 * 同一個 task 一幀只跑一次；在 run 期間再排的 task 排到下一幀。
 */
export interface ScrollFrameTask {
  read?: (scrollY: number) => void
  write?: (scrollY: number) => void
}

const queue = new Set<ScrollFrameTask>()
let frame = 0

/** 一個 task 丟例外不擋其他 task（跟原本各自一個 rAF 時一樣），例外照舊送到 window 的 error。 */
function guarded(fn: () => void) {
  try {
    fn()
  } catch (error) {
    setTimeout(() => {
      throw error
    })
  }
}

function run() {
  frame = 0
  const tasks = [...queue]
  queue.clear()
  if (!tasks.length) return
  const y = window.scrollY
  for (const task of tasks) if (task.read) guarded(() => task.read!(y))
  for (const task of tasks) if (task.write) guarded(() => task.write!(y))
}

export function requestScrollFrame(task: ScrollFrameTask) {
  queue.add(task)
  if (!frame) frame = requestAnimationFrame(run)
}

/** 元件卸載時呼叫；排程空了就把 rAF 一起取消。 */
export function cancelScrollFrame(task: ScrollFrameTask) {
  queue.delete(task)
  if (!queue.size && frame) {
    cancelAnimationFrame(frame)
    frame = 0
  }
}
