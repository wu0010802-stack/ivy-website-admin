// 孩子的一天背景片比稿用（沿用 environment-playful-directions-20261019）：擋掉送往正式站的 telemetry，並把寫死正式站網域的請求改回本機代理
(() => {
  const PROD = 'https://web-production-04caa.up.railway.app'
  const blocked = (u) => /telemetry|analytics|collect/i.test(String(u))
  navigator.sendBeacon = () => true
  const f = window.fetch.bind(window)
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input?.url
    if (blocked(url)) return Promise.resolve(new Response(null, { status: 204 }))
    if (typeof input === 'string' && input.startsWith(PROD)) input = input.slice(PROD.length)
    return f(input, init)
  }
})()
