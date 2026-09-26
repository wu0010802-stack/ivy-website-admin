// 用法：node design/flip-hint-natural-20260924/shot.cjs（先在 repo 根目錄 python3 -m http.server 8769 --bind 127.0.0.1）
// ONLY=still|hint|mobile|reduce|batch2 只跑其中一段；逐格原圖寫到 output/flip-hint-natural-20260924/frames（gitignore）
// 第一批 A–C 用 ?batch=1，第二批 D–F 是預設
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PW || path.join(process.env.HOME, '.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core'));
const BASE = 'http://127.0.0.1:8769/design/flip-hint-natural-20260924/';
const OUT = __dirname;
const FRAMES = path.join(__dirname, '../../output/flip-hint-natural-20260924/frames');
fs.mkdirSync(FRAMES, { recursive: true });
const ONLY = process.env.ONLY;
const wait = ms => new Promise(r => setTimeout(r, ms));
const want = k => !ONLY || ONLY === k;
const ready = page => page.waitForSelector('body[data-ready="1"]', { timeout: 30000 });
// 把指定卡片捲到畫面正中央
const center = (page, sel) => page.evaluate(s => {
  const r = document.querySelector(s).getBoundingClientRect();
  scrollBy(0, r.top + r.height / 2 - innerHeight / 2);
}, sel);

(async () => {
  // 無頭 Chrome 用 Metal 才拿得到 GPU（SwiftShader 太慢，逐格會失真）
  const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const errors = [];
  const watch = page => page.on('console', m => ['error', 'warning'].includes(m.type()) && errors.push(m.text())).on('pageerror', e => errors.push(String(e)));
  const report = {};

  if (want('still')) {
    const desk = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
    watch(desk);
    // 靜止：A、B 卡片與現況相同；B 多一行引言、C 多一行提問
    await desk.goto(BASE + '?batch=1', { waitUntil: 'networkidle' });
    await ready(desk);
    await (await desk.$('.board')).screenshot({ path: path.join(OUT, 'rest-comparison.png') });
    // A 停在提示最高點
    await desk.goto(BASE + '?batch=1&still=1', { waitUntil: 'networkidle' });
    await ready(desk);
    await (await desk.$('.board')).screenshot({ path: path.join(OUT, 'desktop-comparison.png') });
    await (await desk.$('.v-a .card')).screenshot({ path: path.join(OUT, 'still-a.png') });
    const b = await desk.evaluate(() => {
      const r = document.querySelector('.v-b .sec-head').getBoundingClientRect(), c = document.querySelector('.v-b .card').getBoundingClientRect();
      return { x: r.left - 20, y: r.top + scrollY - 20, width: Math.max(r.width, c.right - r.left) + 40, height: c.bottom - r.top + 40 };
    });
    await desk.screenshot({ path: path.join(OUT, 'still-b.png'), clip: b, fullPage: true });
    await (await desk.$('.v-c .card')).screenshot({ path: path.join(OUT, 'still-c.png') });
    report.webgl = await desk.evaluate(() => document.querySelectorAll('.card.webgl').length);
    await desk.close();
  }

  if (want('hint')) {
    // A：停在一張上 → 1.2 秒後掀一次；同一張不再掀；翻過之後另一張也不掀
    const live = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    watch(live);
    await live.goto(BASE + '?view=a', { waitUntil: 'networkidle' });
    await ready(live);
    await center(live, '.v-a .card');
    const t0 = Date.now();
    const card = await live.$('.v-a .card');
    const log = [];
    for (let i = 0; i < 26; i++) {
      await card.screenshot({ path: path.join(FRAMES, `a-${String(i).padStart(2, '0')}.png`) });
      log.push([Date.now() - t0, await live.evaluate(() => document.querySelector('.live').textContent)]);
      await wait(120);
    }
    report.hintLog = [log[0], log.find(([, t]) => t.startsWith('已提示')), log.at(-1)];
    // 往下捲一點再捲回同一張：不應再掀
    await live.mouse.wheel(0, 200); await wait(300); await center(live, '.v-a .card'); await wait(1800);
    report.hintedAfterReturn = await live.evaluate(() => document.querySelector('.live').textContent);
    // 翻第一張 → 「翻過了」
    await live.click('.v-a .card .turn'); await wait(1300);
    await live.click('.v-a .card .turn'); await wait(1300);
    report.afterFlip = await live.evaluate(() => document.querySelector('.live').textContent);
    // 重播 → 再掀一次（點按鈕時 Playwright 會先捲到按鈕，點完把卡片捲回中央）
    report.scrollBeforeReplay = await live.evaluate(() => scrollY);
    await live.click('.replay');
    report.scrollAtReplay = await live.evaluate(() => scrollY);
    await center(live, '.v-a .card'); await wait(1800);
    report.afterReplay = await live.evaluate(() => document.querySelector('.live').textContent);
    await live.close();
  }

  if (want('mobile')) {
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    watch(phone);
    for (const k of ['a', 'b', 'c', 'd', 'e', 'f']) {
      await phone.goto(BASE + `?view=${k}&still=1`, { waitUntil: 'networkidle' });
      await ready(phone);
      await phone.evaluate(() => document.querySelector('.direction:not([hidden]) .sec-head').scrollIntoView());
      await wait(300);
      await phone.screenshot({ path: path.join(OUT, `mobile-${k}.png`) });
      report[`overflow-${k}`] = await phone.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    }
    await phone.close();
  }

  if (want('reduce')) {
    const calm = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    watch(calm);
    await calm.goto(BASE + '?batch=1', { waitUntil: 'networkidle' });
    await ready(calm);
    report.reduce = await calm.evaluate(() => ({ webgl: document.querySelectorAll('.card.webgl').length, live: document.querySelector('.v-a .live').textContent, replayDisabled: document.querySelector('.replay').disabled }));
    await calm.goto(BASE, { waitUntil: 'networkidle' });
    await ready(calm);
    await wait(1500);
    report.reduce2 = await calm.evaluate(() => ({ webgl: document.querySelectorAll('.card.webgl').length, dBack: document.querySelector('.v-d .card').classList.contains('is-flipped'), fBack: document.querySelector('.v-f .card').classList.contains('is-flipped'), fLive: document.querySelector('.v-f .live').textContent, eNote: getComputedStyle(document.querySelector('.v-e .print'), '::before').content !== 'none' }));
    await (await calm.$('.v-e .card')).screenshot({ path: path.join(OUT, 'reduce-e.png') });
    await calm.close();
  }

  if (want('batch2')) {
    const desk = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
    watch(desk);
    // 靜止：D、F 第一張背面朝上，E 露出便條紙邊（?still=1 讓 F 不自己翻）
    await desk.goto(BASE + '?still=1', { waitUntil: 'networkidle' });
    await ready(desk);
    await (await desk.$('.board')).screenshot({ path: path.join(OUT, 'batch2-comparison.png') });
    for (const k of ['d', 'e']) await (await desk.$(`.v-${k} .card`)).screenshot({ path: path.join(OUT, `still-${k}.png`) });
    // E 翻過來：便條那一面在前，相紙的邊從後面露出來
    await desk.goto(BASE + '?view=e', { waitUntil: 'networkidle' });
    await ready(desk);
    await center(desk, '.v-e .card');
    await desk.click('.v-e .card .turn');
    await wait(1500);
    await (await desk.$('.v-e .card')).screenshot({ path: path.join(OUT, 'flipped-e.png') });
    // D 點一下翻回照片
    await desk.goto(BASE + '?view=d', { waitUntil: 'networkidle' });
    await ready(desk);
    await desk.click('.v-d .card .turn');
    await wait(1500);
    report.dAfterClick = await desk.evaluate(() => document.querySelector('.v-d .card').classList.contains('is-flipped'));
    await desk.close();
    // F：捲到第一張，逐格看它翻開
    const live = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    watch(live);
    await live.goto(BASE + '?view=f', { waitUntil: 'networkidle' });
    await ready(live);
    report.fBefore = await live.evaluate(() => document.querySelector('.v-f .live').textContent);
    const card = await live.$('.v-f .card');
    await center(live, '.v-f .card');
    for (let i = 0; i < 22; i++) {
      await card.screenshot({ path: path.join(FRAMES, `f-${String(i).padStart(2, '0')}.png`) });
      await wait(60);
    }
    report.fAfter = await live.evaluate(() => ({ live: document.querySelector('.v-f .live').textContent, flipped: document.querySelector('.v-f .card').classList.contains('is-flipped') }));
    await live.click('.replay');
    await wait(400);
    report.fReplayBack = await live.evaluate(() => document.querySelector('.v-f .card').classList.contains('is-flipped'));
    await wait(1800);
    report.fReplayOpened = await live.evaluate(() => !document.querySelector('.v-f .card').classList.contains('is-flipped'));
    await live.close();
  }

  report.errors = errors;
  console.log(JSON.stringify(report, null, 1));
  await browser.close();
})();
