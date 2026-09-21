// 用法：node scripts/summarize-web-vitals.mjs < exported-web-logs.jsonl
// 接受純 JSON 日誌或 Railway {message:"..."} 包裝；只彙整自家固定欄位。
import { createInterface } from 'node:readline'
const metrics = new Map()
const counts = new Map()
for await (const line of createInterface({ input: process.stdin })) {
  try {
    let row = JSON.parse(line)
    if (typeof row.message === 'string') row = JSON.parse(row.message)
    if (row.type !== 'website_telemetry') continue
    const group = `${row.page}/${row.campus ?? 'all'}/${row.device}/${row.event}`
    if (['LCP', 'INP', 'CLS'].includes(row.event) && Number.isFinite(row.value)) {
      // 同一 metric 更新只保留最後一次，避免重複回報扭曲 p75。
      metrics.set(`${group}/${row.id}`, { group, value: row.value, event: row.event })
    } else if (['page_view', 'visit_click'].includes(row.event)) counts.set(group, (counts.get(group) ?? 0) + 1)
  } catch { /* 忽略非觀測日誌，不輸出原文，避免其他日誌中的個資外洩。 */ }
}
const groups = new Map()
for (const metric of metrics.values()) {
  if (!groups.has(metric.group)) groups.set(metric.group, [])
  groups.get(metric.group).push(metric.value)
}
const output = []
for (const [group, values] of groups) {
  values.sort((a, b) => a - b)
  const p75 = values[Math.ceil(values.length * 0.75) - 1]
  const threshold = group.endsWith('/LCP') ? 2500 : group.endsWith('/INP') ? 200 : 0.1
  output.push({ group, samples: values.length, p75, target: threshold, meetsTarget: p75 <= threshold })
}
console.log(JSON.stringify({ metrics: output, counts: Object.fromEntries(counts), note: '非唯一訪客；CWV 依 document 進入頁歸屬，需足夠真實流量及一致期間才可評估。' }, null, 2))
