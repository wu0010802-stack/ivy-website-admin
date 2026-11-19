// 孩子的一天混剪比稿用：擋掉遙測，並把寫死正式站網域的請求改回本機代理（第三方連線另由 serve.py 的 CSP 擋）
(() => {
  const PROD = /^https:\/\/(www\.ivykidschool\.com|web-production-04caa\.up\.railway\.app)/
  const blocked = (u) => /telemetry|client-errors|analytics|collect/i.test(String(u))
  navigator.sendBeacon = () => true
  const f = window.fetch.bind(window)
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input?.url
    if (blocked(url)) return Promise.resolve(new Response(null, { status: 204 }))
    if (typeof input === 'string') input = input.replace(PROD, '')
    return f(input, init)
  }
  // 開場布幕每個工作階段只播一次；比稿要反覆重新整理看首屏，直接當作看過
  try { sessionStorage.setItem('ivy-entrance-a-seen', '1') } catch {}
})()
