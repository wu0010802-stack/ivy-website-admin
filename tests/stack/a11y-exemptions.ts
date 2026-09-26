// axe 自動檢查（a11y.spec.ts）的已知問題豁免。門檻是 serious／critical：這裡列的是
// 已經看過、決定暫不修的節點，每條都要寫原因；修好就把那條刪掉。
// 豁免只比對「規則＋頁面＋節點在哪個容器裡」，同一頁其他地方出現同樣問題仍會失敗。

export interface AxeExemption {
  rule: string
  /** 頁面路徑（不含 query）要符合 */
  pages: RegExp
  /** 違規節點在這個容器裡（element.closest）才豁免 */
  within: string
  reason: string
}

const DESIGN_PAGES = /^\/(admission|curriculum|environment)$/

export const AXE_EXEMPTIONS: AxeExemption[] = [
  {
    rule: 'color-contrast',
    pages: DESIGN_PAGES,
    within: '.adm-watermark',
    reason: '章節背景的大字浮水印是純裝飾（aria-hidden），WCAG 1.4.3 不要求裝飾文字的對比。',
  },
  {
    rule: 'color-contrast',
    pages: DESIGN_PAGES,
    within: '.adm-kicker',
    reason:
      '已知問題（2026-09-26 axe 首次掃描）：章節編號與英文小標是雙語裝飾標記，同一章的中文標題傳達同樣內容；' +
      '顏色是 DESIGN.md 定案的設計，要改需設計確認。',
  },
  {
    rule: 'color-contrast',
    pages: /^\/admission$/,
    within: '.adm-ranges, .adm-week, .adm-allowance, .adm-refund-group',
    reason:
      '已知問題（2026-09-26 axe 首次掃描）：入學資訊頁彩色底卡上的小字對比 3.8–4.4:1，略低於 4.5:1；' +
      '底色與字色都是設計定案，待設計一起調整。',
  },
]
