// 操作紀錄的「裝置」：把 User-Agent 縮成「iPhone・LINE」這類短字，完整字串
// 畫面放在 title。只認同事實際會用的幾種，不追版本號。已知限制：iPadOS 的
// Safari 預設用桌機版 UA，會被認成 Mac。

// 先比對的先贏：iPhone／iPad 的 UA 也有「Mac OS X」，Android 的也有「Linux」。
const DEVICES: [RegExp, string][] = [
  [/iPad/, 'iPad'],
  [/iPhone|iPod/, 'iPhone'],
  [/Android/, 'Android'],
  [/Windows/, 'Windows'],
  [/CrOS/, 'Chromebook'],
  [/Macintosh|Mac OS X/, 'Mac'],
  [/Linux/, 'Linux'],
]

// App 內建瀏覽器要排在前面：LINE 的 UA 也有 Safari／Chrome。Edge、Samsung、
// Opera 的 UA 都有 Chrome，Chrome 的也有 Safari。
const BROWSERS: [RegExp, string][] = [
  [/\bLine\/\d/, 'LINE'],
  [/FBAN|FBAV|FB_IAB/, 'Facebook'],
  [/Instagram/, 'Instagram'],
  [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
  [/SamsungBrowser\//, 'Samsung Internet'],
  [/\bOPR\/|Opera/, 'Opera'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/CriOS\/|Chrome\//, 'Chrome'],
  [/Safari\//, 'Safari'],
]

function match(ua: string, rules: [RegExp, string][]): string | undefined {
  return rules.find(([pattern]) => pattern.test(ua))?.[1]
}

export function describeUserAgent(ua: string | null | undefined): string {
  const value = ua?.trim()
  if (!value) return ''
  // 不是瀏覽器（curl、程式呼叫）就寫程式名稱。
  if (!value.startsWith('Mozilla/')) return value.split(/[\s/]/, 1)[0]!.slice(0, 32)
  const parts = [match(value, DEVICES), match(value, BROWSERS)].filter(Boolean)
  return parts.length ? parts.join('・') : '其他裝置'
}
