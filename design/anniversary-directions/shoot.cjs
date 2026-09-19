// 截圖：node shoot.cjs（需先啟動 python3 -m http.server 8770 於 repo 根目錄）
const path = require('path');
const fs = require('fs');
const pwPath = fs.readdirSync(path.join(process.env.HOME, '.npm/_npx')).map(d => path.join(process.env.HOME, '.npm/_npx', d, 'node_modules/playwright-core')).find(p => fs.existsSync(p));
const { chromium } = require(pwPath);
const BASE = 'http://127.0.0.1:8770/index.html';
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const devices = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 760, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } };
  for (const [deviceName, vp] of Object.entries(devices)) {
    for (const d of ['current', 'a', 'b', 'c']) {
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.isMobile, hasTouch: !!vp.hasTouch, deviceScaleFactor: vp.deviceScaleFactor || 2, locale: 'zh-TW', reducedMotion: 'reduce' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(`${BASE}${d === 'current' ? '' : '?anni=' + d}#/home`, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => { document.querySelectorAll('video').forEach(v => { v.pause(); v.currentTime = 0; }); });
      await wait(500);
      const barH = deviceName === 'desktop' ? 130 : 96;
      await page.screenshot({ path: `shots/${d}-${deviceName}-hero.png`, clip: { x: 0, y: 0, width: vp.width, height: barH } });
      const info = await page.evaluate(() => { const b = document.querySelector('.header-top .brand'); const r = b.getBoundingClientRect(); const nav = document.querySelector('.nav-inner')?.getBoundingClientRect(); return { brandW: Math.round(r.width), brandH: Math.round(r.height), brandRight: Math.round(r.right), navLeft: nav ? Math.round(nav.left) : null, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth }; });
      // 捲離首屏 → 膠囊
      await page.evaluate(() => scrollTo({ top: 720, behavior: 'instant' }));
      await wait(900);
      await page.screenshot({ path: `shots/${d}-${deviceName}-pill.png`, clip: { x: 0, y: 0, width: vp.width, height: 90 } });
      // 分校頁：淺底、綠字的頁首
      if (deviceName === 'desktop') {
        await page.goto(`${BASE}${d === 'current' ? '' : '?anni=' + d}#/yihua`, { waitUntil: 'networkidle' });
        await wait(500);
        await page.screenshot({ path: `shots/${d}-${deviceName}-campus.png`, clip: { x: 0, y: 0, width: vp.width, height: 130 } });
      }
      console.log(d, deviceName, JSON.stringify(info), errors.length ? errors : '');
      await context.close();
    }
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
