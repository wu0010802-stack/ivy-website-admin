const { chromium } = require('/Users/yilunwu/.npm/_npx/31e32ef8478fbf80/node_modules/playwright-core');
(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const p = await b.newPage({ viewport: { width: 1640, height: 1500 }, deviceScaleFactor: 2 });
  await p.goto('http://127.0.0.1:8765/design/flip-button-mockup-20260921/index.html', { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  await p.screenshot({ path: 'output/playwright/flip-glass/mockup-all.png', fullPage: true });
  for (const k of ['a','b','c']) {
    const cards = await p.locator(`#col-${k} .print-card`).all();
    for (const [i, c] of cards.entries()) {
      const bb = await c.boundingBox();
      await p.screenshot({ path: `output/playwright/flip-glass/mock-${k}-${i?'back':'front'}.png`, clip: { x: bb.x + bb.width - 240, y: bb.y + bb.height - 120, width: 250, height: 130 } });
    }
  }
  await b.close();
})();
