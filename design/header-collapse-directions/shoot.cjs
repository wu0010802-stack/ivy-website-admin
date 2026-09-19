// 截圖＋狀態檢查：node shoot.cjs（需先啟動 python3 -m http.server 8770 於 repo 根目錄）
const path = require('path');
const fs = require('fs');
const pwPath = fs.readdirSync(path.join(process.env.HOME, '.npm/_npx')).map(d => path.join(process.env.HOME, '.npm/_npx', d, 'node_modules/playwright-core')).find(p => fs.existsSync(p));
const { chromium } = require(pwPath);
const BASE = 'http://127.0.0.1:8770/design/header-collapse-directions/view.html';
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const report = [];
  const devices = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 760, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } };
  for (const [deviceName, vp] of Object.entries(devices)) {
    for (const direction of ['a', 'b', 'c']) {
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.isMobile, hasTouch: !!vp.hasTouch, deviceScaleFactor: vp.deviceScaleFactor || 1, locale: 'zh-TW' });
      const page = await context.newPage();
      const errors = [];
      page.on('console', m => { if (['error', 'warning'].includes(m.type())) errors.push(m.type() + ': ' + m.text()); });
      page.on('pageerror', e => errors.push('pageerror: ' + e.message));
      await page.goto(`${BASE}?direction=${direction}`, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      await wait(300);
      const probe = async () => page.evaluate(() => {
        const h = document.getElementById('header');
        const panel = document.getElementById('menu-panel');
        const toggles = [...document.querySelectorAll('.menu-toggle')];
        const overflow = document.documentElement.scrollWidth > document.documentElement.clientWidth;
        const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).opacity !== '0'; };
        return {
          state: h.dataset.state, menu: h.dataset.menu, scrollY: Math.round(scrollY), overflow,
          barH: h.querySelector('.header-top').offsetHeight,
          navVisible: visible(h.querySelector('.navigation')),
          toggleVisible: toggles.map(visible),
          expanded: toggles.map(t => t.getAttribute('aria-expanded')),
          panelHidden: panel.hidden, panelOpen: panel.classList.contains('is-open'),
          pillVisible: visible(h.querySelector('.header-pill')),
          bookText: h.querySelector('.header-book').innerText.replace(/\s+/g, ' '),
          active: document.activeElement && (document.activeElement.tagName + '.' + document.activeElement.className + ':' + (document.activeElement.textContent || '').trim().slice(0, 12)),
        };
      });
      if (direction === 'a') await page.screenshot({ path: `shots/hero-${deviceName}.png` });
      const hero = await probe();
      if (direction === 'a') { await page.evaluate(() => scrollTo({ top: 320, behavior: 'instant' })); await wait(600); await page.screenshot({ path: `shots/hero-scrolled-${deviceName}.png` }); }
      await page.evaluate(() => scrollTo({ top: document.getElementById('about').offsetTop - 64, behavior: 'instant' }));
      await wait(900);
      const compact = await probe();
      await page.screenshot({ path: `shots/${direction}-${deviceName}-compact.png` });
      // 打開選單：點目前看得到的那顆漢堡
      // 真的用滑鼠點看得到的那顆漢堡（程式 click 會讓 :focus-visible 誤亮）
      const toggleBox = await page.evaluate(() => { const t = [...document.querySelectorAll('.menu-toggle')].find(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden'); const r = t.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
      await page.mouse.click(toggleBox.x, toggleBox.y);
      await wait(1000);
      const menu = await probe();
      await page.screenshot({ path: `shots/${direction}-${deviceName}-menu.png` });
      // Esc 關閉 → 焦點回到按鈕
      await page.keyboard.press('Escape');
      await wait(700);
      const closed = await probe();
      // 回到首屏 → 狀態還原
      await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
      await wait(800);
      const back = await probe();
      report.push({ direction, device: deviceName, errors, hero, compact, menu, closed, back });
      await context.close();
    }
  }
  await browser.close();
  fs.writeFileSync('shots/report.json', JSON.stringify(report, null, 1));
  for (const r of report) {
    const ok = r.hero.state === 'hero' && r.compact.state === 'compact' && r.menu.panelOpen && r.closed.panelHidden && r.back.state === 'hero' && !r.compact.overflow && !r.menu.overflow;
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${r.direction}/${r.device} hero=${r.hero.state} compact=${r.compact.state}/${r.compact.barH}px menuOpen=${r.menu.panelOpen} closed=${r.closed.panelHidden} back=${r.back.state} overflow=${r.compact.overflow}/${r.menu.overflow} nav(hero/compact)=${r.hero.navVisible}/${r.compact.navVisible} toggles(compact)=${JSON.stringify(r.compact.toggleVisible)} pill=${r.compact.pillVisible} focusAfterOpen=${r.menu.active} focusAfterEsc=${r.closed.active} errors=${r.errors.length}`);
    r.errors.forEach(e => console.log('   ', e));
  }
})().catch(e => { console.error(e); process.exit(1); });
