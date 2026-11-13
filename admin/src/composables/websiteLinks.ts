import { WEBSITE_ASSET_BASE } from '../config'

/**
 * 另開分頁連到官網頁面的網址。
 *
 * 後台在獨立子網域（admin.ivykidschool.com，2026-11-12）時，素材與草稿預覽仍走後台自己的主機
 * （WEBSITE_ASSET_BASE 是空字串），但連到官網的連結不能再用相對路徑：後台主機的「/」會被 web
 * 轉回 /admin/（web/server/utils/admin-host.ts），點「查看官網」只會回到後台。官網的 origin 由
 * /auth/login、/auth/me 的 features.public_site_origin 帶來（後端 WEBSITE_PUBLIC_ORIGIN）；
 * 沒有值（後台與官網同網域、本機開發）就照舊接在 WEBSITE_ASSET_BASE 後面。
 */
export function websitePageUrl(path: string, publicSiteOrigin?: string | null): string {
  return `${(publicSiteOrigin || WEBSITE_ASSET_BASE).replace(/\/+$/, '')}${path}`
}
