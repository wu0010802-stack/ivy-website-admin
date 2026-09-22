import { brotliCompressSync, constants, gzipSync } from 'node:zlib'

// Railway 的反向代理不會壓縮回應，首頁 SSR HTML（含 payload 與圖示 sprite）
// 約 94 KB，在 4G 上多花將近半秒。靜態資源由 nitro.compressPublicAssets
// 預先壓好；這裡只補 SSR 頁面本體。brotli 品質 5 對這個大小約 1–2 ms。
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('render:response', (response, { event }) => {
    if (typeof response.body !== 'string' || response.body.length < 1024) return
    const headers = (response.headers ??= {})
    if (headers['content-encoding']) return
    const accept = getRequestHeader(event, 'accept-encoding') ?? ''
    const encoding = /\bbr\b/.test(accept) ? 'br' : /\bgzip\b/.test(accept) ? 'gzip' : null
    if (!encoding) return
    const raw = Buffer.from(response.body, 'utf8')
    const compressed = encoding === 'br'
      ? brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 5, [constants.BROTLI_PARAM_SIZE_HINT]: raw.length } })
      : gzipSync(raw, { level: 6 })
    // nitro 的 render handler 直接回傳 body，h3 可送 Buffer；型別宣告仍是 string。
    response.body = compressed as unknown as string
    headers['content-encoding'] = encoding
    headers.vary = headers.vary ? `${headers.vary}, accept-encoding` : 'accept-encoding'
    delete headers['content-length']
  })
})
