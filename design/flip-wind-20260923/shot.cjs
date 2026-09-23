// 用法：node design/flip-wind-20260923/shot.cjs（先在 repo 根目錄 python3 -m http.server 8769 --bind 127.0.0.1）
// ONLY=still|gust|mobile 只跑其中一段；逐格原圖寫到 output/flip-wind-20260923/frames（gitignore）
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PW || path.join(process.env.HOME, '.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core'));
const BASE = 'http://127.0.0.1:8769/design/flip-wind-20260923/';
const OUT = __dirname;
const FRAMES = path.join(__dirname, '../../output/flip-wind-20260923/frames');
fs.mkdirSync(FRAMES, { recursive: true });
const ONLY = process.env.ONLY;
const wait = ms => new Promise(r => setTimeout(r, ms));
const want = k => !ONLY || ONLY === k;
const ready = page => page.waitForSelector('body[data-ready="1"]', { timeout: 30000 });

(async () => {
  // 無頭 Chrome 用 Metal 才拿得到 GPU（SwiftShader 太慢，逐格會失真）
  const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const errors = [];
  const watch = page => page.on('console', m => ['error', 'warning'].includes(m.type()) && errors.push(m.text())).on('pageerror', e => errors.push(String(e)));
  const report = {};

  if (want('still')) {
    const desk = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
    watch(desk);
    // 靜止：三版都應該是一張完整、平貼的相紙
    await desk.goto(BASE, { waitUntil: 'networkidle' });
    await ready(desk);
    await (await desk.$('.board')).screenshot({ path: path.join(OUT, 'rest-comparison.png') });
    // 一陣風最強時的定格
    await desk.goto(BASE + '?still=1', { waitUntil: 'networkidle' });
    await ready(desk);
    await (await desk.$('.board')).screenshot({ path: path.join(OUT, 'desktop-comparison.png') });
    for (const k of ['a', 'b', 'c']) await (await desk.$(`.v-${k} .card`)).screenshot({ path: path.join(OUT, `still-${k}.png`) });
    report.webgl = await desk.evaluate(() => document.querySelectorAll('.card.webgl').length);
    // 翻到背面（WebGL 版自己轉），等翻完
    await desk.goto(BASE + '?view=b', { waitUntil: 'networkidle' });
    await ready(desk);
    await desk.click('.v-b .card .turn');
    await wait(1400);
    await (await desk.$('.v-b .card')).screenshot({ path: path.join(OUT, 'flipped-b.png') });
    await desk.close();
  }

  if (want('gust')) {
    // 單版按「吹一陣風」後每 80ms 截一格，拼成條帶
    const live = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    watch(live);
    for (const k of ['a', 'b', 'c']) {
      await live.goto(BASE + `?view=${k}`, { waitUntil: 'networkidle' });
      await ready(live);
      await live.evaluate(() => document.querySelector('.board').scrollIntoView());
      await wait(1500);
      await live.click('.gust');
      const card = await live.$(`.v-${k} .card`);
      for (let i = 0; i < 16; i++) {
        await card.screenshot({ path: path.join(FRAMES, `${k}-${String(i).padStart(2, '0')}.png`) });
        await wait(80);
      }
    }
    await live.close();
  }

  if (want('mobile')) {
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    watch(phone);
    for (const k of ['a', 'b', 'c']) {
      await phone.goto(BASE + `?view=${k}&still=1`, { waitUntil: 'networkidle' });
      await ready(phone);
      await phone.evaluate(() => document.querySelector('.stack').scrollIntoView());
      await wait(300);
      await phone.screenshot({ path: path.join(OUT, `mobile-${k}.png`) });
    }
    report.overflow = await phone.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    await phone.close();
  }

  report.errors = errors;
  console.log(JSON.stringify(report));
  await browser.close();
})();
