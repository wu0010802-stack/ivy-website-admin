// 用法：node design/flip-hint-subtle-20260923/shot.cjs（先在 repo 根目錄 python3 -m http.server 8769 --bind 127.0.0.1）
const path = require('path');
const { chromium } = require(process.env.PW || path.join(process.env.HOME, '.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core'));
const BASE = 'http://127.0.0.1:8769/design/flip-hint-subtle-20260923/';
const OUT = __dirname;
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const errors = [];
  const watch = page => page.on('console', m => m.type() === 'error' && errors.push(m.text())).on('pageerror', e => errors.push(String(e)));

  // 桌機三欄定格
  const desk = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
  watch(desk);
  await desk.goto(BASE + '?still=1', { waitUntil: 'networkidle' });
  await desk.evaluate(() => document.fonts.ready);
  await (await desk.$('.board')).screenshot({ path: path.join(OUT, 'desktop-comparison.png') });
  for (const k of ['a', 'b', 'c']) await (await desk.$(`.v-${k} .card`)).screenshot({ path: path.join(OUT, `still-${k}.png`) });

  // C 翻到背面：確認另外半顆貼紙在背面左緣
  await desk.click('.v-c .card .turn');
  await wait(1200);
  await (await desk.$('.v-c .card')).screenshot({ path: path.join(OUT, 'still-c-back.png') });

  // A 實際滑鼠透光（非定格）：旋轉卡片上的 offsetX 是否對得上
  const live = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
  watch(live);
  await live.goto(BASE + '?view=a', { waitUntil: 'networkidle' });
  const box = await (await live.$('.v-a .card')).boundingBox();
  await live.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.8);
  await live.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.78, { steps: 8 });
  await wait(900);
  const lit = await live.evaluate(() => { const c = document.querySelector('.v-a .card'); return { lit: c.classList.contains('is-lit'), lx: c.style.getPropertyValue('--lx'), ly: c.style.getPropertyValue('--ly'), w: c.offsetWidth, h: c.offsetHeight }; });
  await (await live.$('.v-a .card')).screenshot({ path: path.join(OUT, 'live-a-hover.png') });

  // B 模擬一陣捲動：取折角數值曲線
  await live.goto(BASE + '?view=b', { waitUntil: 'networkidle' });
  await live.click('.replay');
  const curve = [];
  for (let i = 0; i < 14; i++) {
    curve.push(await live.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.v-b .card')).getPropertyValue('--ear'))));
    if (i === 2) await (await live.$('.v-b .card')).screenshot({ path: path.join(OUT, 'live-b-gust.png') });
    await wait(90);
  }

  // 手機
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  watch(phone);
  for (const k of ['a', 'b', 'c']) {
    await phone.goto(BASE + `?view=${k}&still=1`, { waitUntil: 'networkidle' });
    await phone.evaluate(() => document.querySelector('.board').scrollIntoView());
    await wait(300);
    await phone.screenshot({ path: path.join(OUT, `mobile-${k}.png`) });
  }
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - innerWidth);

  console.log(JSON.stringify({ lit, curve, overflow, errors }, null, 1));
  await browser.close();
})();
