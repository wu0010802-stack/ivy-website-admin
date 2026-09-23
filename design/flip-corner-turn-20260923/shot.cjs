// 用法：node design/flip-corner-turn-20260923/shot.cjs（先在 repo 根目錄 python3 -m http.server 8769 --bind 127.0.0.1）
// ONLY=film|live|mobile；逐格原圖寫到 output/flip-corner-turn-20260923/（gitignore）
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PW || path.join(process.env.HOME, '.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core'));
const BASE = 'http://127.0.0.1:8769/design/flip-corner-turn-20260923/';
const OUT = __dirname;
const RAW = path.join(__dirname, '../../output/flip-corner-turn-20260923');
fs.mkdirSync(RAW, { recursive: true });
const ONLY = process.env.ONLY;
const want = k => !ONLY || ONLY === k;
const wait = ms => new Promise(r => setTimeout(r, ms));
const ready = page => page.waitForSelector('body[data-ready="1"]', { timeout: 30000 });
const STEPS = [0, 0.08, 0.16, 0.26, 0.38, 0.5, 0.62, 0.74, 0.86, 1];

(async () => {
  // 無頭 Chrome 用 Metal 才拿得到 GPU
  const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const errors = [];
  const watch = page => page.on('console', m => ['error', 'warning'].includes(m.type()) && errors.push(m.text())).on('pageerror', e => errors.push(String(e)));
  const report = {};

  if (want('film')) {
    // 各版第一張卡：翻面進度逐格定格（mockPose），存原圖，之後拼膠卷
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    watch(page);
    for (const k of ['a', 'b', 'c']) {
      await page.goto(BASE + `?view=${k}`, { waitUntil: 'networkidle' });
      await ready(page);
      const card = await page.$(`.v-${k} .card`);
      await card.scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollBy(0, -140));
      const b = await card.boundingBox();
      const clip = { x: b.x - 170, y: b.y - 40, width: b.width + 240, height: b.height + 80 };
      for (const p of STEPS) {
        await page.evaluate(v => window.mockPose(v), p);
        await page.screenshot({ path: path.join(RAW, `${k}-${String(Math.round(p * 100)).padStart(3, '0')}.png`), clip });
      }
    }
    await page.close();
  }

  if (want('live')) {
    // 真的點下去翻：確認時鐘、翻完的背面、翻到一半再點會倒回
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
    watch(page);
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await ready(page);
    await page.evaluate(() => document.querySelector('.stack').scrollIntoView());
    await wait(500);
    await page.click('.flip-all');
    await wait(1900);
    await (await page.$('.board')).screenshot({ path: path.join(OUT, 'all-flipped.png') });
    report.flipped = await page.evaluate(() => [...document.querySelectorAll('.card')].map(c => c.classList.contains('is-flipped')).join(','));
    await page.click('.v-c .card .turn');
    await wait(450);
    await page.click('.v-c .card .turn');
    await wait(1400);
    report.reverse = await page.evaluate(() => { const c = document.querySelector('.v-c .card'); return { flipped: c.classList.contains('is-flipped'), expanded: c.querySelector('.turn').getAttribute('aria-expanded') }; });
    await page.close();
    const rm = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    await rm.goto(BASE, { waitUntil: 'networkidle' });
    await ready(rm);
    report.reduced = await rm.evaluate(() => ({ webgl: document.querySelectorAll('.card.webgl').length, disabled: [...document.querySelectorAll('.controls button')].every(b => b.disabled) }));
    await rm.close();
  }

  if (want('mobile')) {
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    watch(phone);
    for (const k of ['a', 'b', 'c']) {
      await phone.goto(BASE + `?view=${k}`, { waitUntil: 'networkidle' });
      await ready(phone);
      await phone.evaluate(() => document.querySelector('.stack').scrollIntoView());
      await wait(300);
      await phone.evaluate(() => window.mockPose(0.38));
      await phone.screenshot({ path: path.join(OUT, `mobile-${k}.png`) });
    }
    report.overflow = await phone.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    await phone.close();
  }

  report.errors = errors;
  console.log(JSON.stringify(report));
  await browser.close();
})();
