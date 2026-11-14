// 公開頁用 useHead／app.head 放的 inline script 本文（2026-11-04 資安強化）。
// 公開頁的 CSP 是 script-src 'self' 加逐支 sha256（web/server/utils/script-csp.ts）：
// SSR 送出的 inline script 由 render:html 依實際 HTML 算雜湊；但用戶端換頁時 head 管理器
// 會再插入這些 script（例如從別頁點回首頁），那時沒有伺服器在場，雜湊要事先登記。
// 所以每支 inline script 的本文都放在這裡，元件與 nuxt.config 從這裡取，CSP 也從這裡算，
// 兩邊不會對不上。新增 inline script 也要放這裡並加進 CLIENT_INLINE_SCRIPTS，
// 否則用戶端換頁插入時會被 CSP 擋下（SSR 那次仍會動）。
// 進站布幕的 entranceBootstrap 本文在 entrance-policy.ts（與布幕常數放一起）。

/** 第一次繪製前標記動效版面就緒（nuxt.config 的 app.head，錯誤頁也有）。 */
export const MOTION_LAYOUT_SCRIPT = "document.documentElement.dataset.ivyMotion='ready'"

// 2026-11-11：/anniversary 開場影片的閘門（ANNI_INTRO_GATE_SCRIPT）隨 30 秒開場動畫一起拿掉；新的紀念影片按了才播，不需要第一次繪製前的腳本。
