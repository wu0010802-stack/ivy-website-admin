import { isIP } from 'node:net'

/**
 * 從 X-Forwarded-For 取訪客 IP：由右往左數 `trustedHops` 層。
 *
 * 最左段是訪客自己可以隨便填的；每經過一層可信代理，那層會在最右邊
 * 附上「它看到的連線來源」。所以只有從右邊數過可信代理層數的那一段
 * 才可信（Railway 前面只有一層 edge，預設 1）。header 不存在、層數不夠
 * 或內容不是 IP 時回 null，呼叫端退回 socket 位址。
 */
export function clientIpFromForwardedFor(header: string | undefined, trustedHops: number): string | null {
  if (!header || trustedHops < 1) return null
  const parts = header.split(',').map(part => part.trim()).filter(Boolean)
  if (parts.length < trustedHops) return null
  const candidate = parts[parts.length - trustedHops]
  return candidate !== undefined && isIP(candidate) ? candidate : null
}

// 素材上傳以外的 API 本文都是小 JSON。素材單檔上限是部署設定：API 端是
// WEBSITE_MEDIA_MAX_IMAGE_MB／WEBSITE_MEDIA_MAX_VIDEO_MB（預設 15／150），這裡用
// NUXT_MEDIA_MAX_UPLOAD_MB（取兩者較大的那個，預設 150），本文上限的算法與 API
// 相同：最大單檔再加 5 MB 給 multipart 欄位與邊界。
export const DEFAULT_MEDIA_MAX_UPLOAD_MB = 150
export const DEFAULT_BODY_LIMIT = 1024 * 1024

export function mediaUploadBodyLimit(maxUploadMb: number = DEFAULT_MEDIA_MAX_UPLOAD_MB): number {
  const mb = Number.isFinite(maxUploadMb) && maxUploadMb > 0 ? maxUploadMb : DEFAULT_MEDIA_MAX_UPLOAD_MB
  return (mb + 5) * 1024 * 1024
}

export const MEDIA_UPLOAD_BODY_LIMIT = mediaUploadBodyLimit()

const MEDIA_UPLOAD_PATH = /^\/admin\/media(?:\/[0-9a-f-]{36}\/replace)?\/?(?:\?|$)/i

/** 代理轉送前允許的請求本文上限；path 是去掉 `/api/website/v1` 前綴後的路徑。 */
export function proxyBodyLimit(path: string, maxUploadMb: number = DEFAULT_MEDIA_MAX_UPLOAD_MB): number {
  return MEDIA_UPLOAD_PATH.test(path) ? mediaUploadBodyLimit(maxUploadMb) : DEFAULT_BODY_LIMIT
}

export function isMediaUploadPath(path: string): boolean {
  return MEDIA_UPLOAD_PATH.test(path)
}
