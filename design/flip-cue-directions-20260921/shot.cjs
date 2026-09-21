const { chromium } = require('/Users/yilunwu/.npm/_npx/31e32ef8478fbf80/node_modules/playwright-core');
(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const p = await b.newPage({ viewport: { width: 2600, height: 1400 }, deviceScaleFactor: 2 });
  await p.goto('http://127.0.0.1:8765/design/flip-cue-directions-20260921/index.html', { waitUntil: 'networkidle' });
  await p.waitForTimeout(2200);
  await p.screenshot({ path: 'output/playwright/flip-cue/all.png', fullPage: true });
  for (const k of ['v0','v1','v2','v12','v3']) {
    const cards = await p.locator(`#grid .col[data-k=${k}] .print-card`).all();
    for (const [i, c] of cards.entries()) {
      const bb = await c.boundingBox();
      await p.screenshot({ path: `output/playwright/flip-cue/${k}-${i?'back':'front'}.png`, clip: { x: bb.x + bb.width - 300, y: bb.y + bb.height - 140, width: 320, height: 160 }, fullPage: true });
    }
  }
  // 折角掀一次的中段
  await p.click('#grid .col[data-k=v12] [data-replay]');
  await p.waitForTimeout(950);
  const c = await p.locator('#grid .col[data-k=v12] .print-card').first().boundingBox();
  await p.screenshot({ path: 'output/playwright/flip-cue/v12-peel-mid.png', clip: { x: c.x + c.width - 300, y: c.y + c.height - 140, width: 320, height: 160 }, fullPage: true });
  await b.close();
})();
