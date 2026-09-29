/** Only active viewing time counts towards advancing the carousel. */
export function createCarouselClock(options: {
  duration: number
  onAdvance: () => void
  onProgress: (progress: number) => void
}) {
  let timer: ReturnType<typeof setInterval> | undefined
  let elapsed = 0
  let last = 0
  function collect() {
    const now = performance.now()
    elapsed += Math.max(0, now - last)
    last = now
  }
  function reset() {
    elapsed = 0
    last = performance.now()
    options.onProgress(0)
  }
  function start() {
    if (timer !== undefined) return
    last = performance.now()
    timer = setInterval(() => {
      collect()
      if (elapsed >= options.duration) {
        reset()
        options.onAdvance()
      } else options.onProgress(elapsed / options.duration)
    }, 50)
  }
  function pause() {
    if (timer === undefined) return
    collect()
    clearInterval(timer)
    timer = undefined
    options.onProgress(Math.min(1, elapsed / options.duration))
  }
  function destroy() {
    clearInterval(timer)
    timer = undefined
  }
  return { start, pause, reset, destroy }
}
