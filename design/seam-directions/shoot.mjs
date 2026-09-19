// 截「關於常春藤 → 常春藤的一天」接縫過程：現況 vs ?seam=1，各截接縫在 70% / 45% / 20% 視窗高的三個瞬間。
import { chromium } from '/Users/yilunwu/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';
const base = 'http://localhost:8886/index.html';
const out = 'design/seam-directions/shots';
const browser = await chromium.launch();
for (const [name, query] of [['current', ''], ['seam', '?seam=1'], ['seam2', '?seam=2']]) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' });
  await page.goto(base + query + '#/home', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  // 找接縫：關於區塊底邊。捲到讓它落在指定視窗比例。
  for (const frac of [0.7, 0.45, 0.2]) {
    await page.evaluate(async (frac) => {
      const about = document.querySelector('.home-belief');
      // 逐步捲動，讓 sticky／clip 狀態隨 scroll 事件更新
      let y = scrollY;
      for (let i = 0; i < 400; i++) {
        const bottom = about.getBoundingClientRect().bottom;
        const seam = document.documentElement.dataset.seam === '1' ? bottom : (() => {
          // 現況：接縫 = 視窗高 - clip inset 底
          const m = /inset\(0(?:px)? 0(?:px)? ([\d.]+)px/.exec(about.style.clipPath || '');
          return m ? innerHeight - parseFloat(m[1]) : bottom;
        })();
        if (seam <= innerHeight * frac) break;
        y += 40; scrollTo(0, y);
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      }
    }, frac);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/${name}-${Math.round(frac * 100)}.png` });
  }
  await page.close();
}
await browser.close();
