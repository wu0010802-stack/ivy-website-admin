import { ANNI_INTRO_SESSION_KEY } from './anniversary/timeline'
import { HERO_MIN_DOWNLINK_MBPS } from './media-policy'

// 公開頁用 useHead／app.head 放的 inline script 本文（2026-11-04 資安強化）。
// 公開頁的 CSP 是 script-src 'self' 加逐支 sha256（web/server/utils/script-csp.ts）：
// SSR 送出的 inline script 由 render:html 依實際 HTML 算雜湊；但用戶端換頁時 head 管理器
// 會再插入這些 script（例如從別頁點進 /anniversary），那時沒有伺服器在場，雜湊要事先登記。
// 所以每支 inline script 的本文都放在這裡，元件與 nuxt.config 從這裡取，CSP 也從這裡算，
// 兩邊不會對不上。新增 inline script 也要放這裡並加進 CLIENT_INLINE_SCRIPTS，
// 否則用戶端換頁插入時會被 CSP 擋下（SSR 那次仍會動）。
// 進站布幕的 entranceBootstrap 本文在 entrance-policy.ts（與布幕常數放一起）。

/** 第一次繪製前標記動效版面就緒（nuxt.config 的 app.head，錯誤頁也有）。 */
export const MOTION_LAYOUT_SCRIPT = "document.documentElement.dataset.ivyMotion='ready'"

/**
 * /anniversary 開場影片閘門：第一次繪製前決定要不要播，要播就先蓋一層深色（AnniversaryIntro.vue）。
 * 5 秒還沒開始播就拿掉蓋層；連線閘門比照首屏影片（media-policy 的 heroMayAutoplay）。
 */
export const ANNI_INTRO_GATE_SCRIPT = `(function(){try{var d=document.documentElement;if(location.hash||matchMedia('(prefers-reduced-motion: reduce)').matches||sessionStorage.getItem('${ANNI_INTRO_SESSION_KEY}'))return;var c=navigator.connection;if(c&&(c.saveData||/^(slow-2g|2g|3g)$/.test(c.effectiveType||'')||(c.downlink>0&&c.downlink<${HERO_MIN_DOWNLINK_MBPS})))return;d.dataset.anniIntro='pending';setTimeout(function(){if(d.dataset.anniIntro==='pending')delete d.dataset.anniIntro},5000)}catch(e){}})()`
