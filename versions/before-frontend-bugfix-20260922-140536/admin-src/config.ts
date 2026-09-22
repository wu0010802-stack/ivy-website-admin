// 校園探索編輯器需要顯示官網目前的圖片（fixture 素材，尚未接媒體庫，
// 見 docs/website-admin/acceptance.md CMS 擴展小結）。這些圖片由 Nuxt
// 官網（web/）以靜態資產提供，不是這個 admin app 自己的伺服器，所以
// 用一個可覆蓋的 base URL 指過去；本機預設官網跑在 3000 埠。
export const WEBSITE_ASSET_BASE: string =
  (import.meta.env.VITE_WEBSITE_ASSET_BASE as string | undefined) ?? 'http://127.0.0.1:3000'

export function websiteAssetUrl(imageKey: string): string {
  return `${WEBSITE_ASSET_BASE}/assets/${imageKey}.webp`
}
