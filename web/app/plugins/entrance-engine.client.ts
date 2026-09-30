// 首次進站布幕的引擎（連同 three）在 plugin 階段就開始下載，不等 EntranceCurtain 掛載：
// 2026-09-30 起 three 不進 SSR prefetch（nuxt.config 的 build:manifest），布幕仍要趕 2.8 s 的載入上限
// （見 utils/entrance-policy.ts bootstrap 的註解）。bootstrap 沒標 pending（已看過、減少動態、慢速連線）就不載。
// 跟 EntranceCurtain 一樣，hydration 晚過 1.8 s 就不播了，也不必下載。
export default defineNuxtPlugin(() => {
  const { ivyEntrance, ivyEntranceStarted } = document.documentElement.dataset
  if (ivyEntrance !== 'pending' || Date.now() - Number(ivyEntranceStarted || 0) > 1800) return
  void import('~/utils/entranceCurtain').catch(() => {})
})
