// 逐格算圖：起本機靜態伺服器（repo 根目錄）→ 無頭 Chromium 開 film/index.html → 每格 seek(frame) 後截圖。
//
//   node render.mjs stills 0 240 1600 3700          # 指定幾格存成 PNG（output/anniversary-film/stills-check/）
//   node render.mjs range 0 4320 --workers 3          # 算整段，輸出近無損的分段影片 output/anniversary-film/segments/
//   node render.mjs sheet 0 4320 60                   # 每 60 格取一格拼成總表（檢查用）
//   加 --fmt=v 算直式 9:16 版（1080×1920，輸出到 segments-v／stills-check-v）
//
// 需要 repo 的 devDependency playwright（或環境預裝的 playwright）與 ffmpeg。
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const OUT = path.join(REPO, 'output/anniversary-film');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff' };

function serve() {
  return new Promise((resolve) => {
    const srv = createServer(async (req, res) => {
      try {
        const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        const p = path.join(REPO, path.normalize(u));
        if (!p.startsWith(REPO)) { res.writeHead(403).end(); return; }
        const st = await stat(p);
        res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream', 'content-length': st.size, 'cache-control': 'max-age=3600' });
        createReadStream(p).pipe(res);
      } catch { res.writeHead(404).end(); }
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

const VERT = process.argv.includes('--fmt=v');
const SUFFIX = VERT ? '-v' : '';
async function openPage(browser, port) {
  const page = await browser.newPage({ viewport: VERT ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.error('console', m.text()); });
  await page.goto(`http://127.0.0.1:${port}/design/anniversary-film-20261110/film/index.html${VERT ? '?fmt=v' : ''}`);
  await page.evaluate(() => window.seek(0));
  return page;
}

async function shot(page, f) {
  await page.evaluate((fr) => window.seek(fr), f);
  return page.locator('#stage').screenshot({ type: 'png', animations: 'disabled', caret: 'hide' });
}

async function main() {
  const [mode, ...rest] = process.argv.slice(2);
  const args = rest.filter((a) => !a.startsWith('--'));
  const workers = Number((rest.find((a) => a.startsWith('--workers=')) || '--workers=3').split('=')[1]);
  const srv = await serve();
  const port = srv.address().port;
  const browser = await chromium.launch({ args: ['--disable-gpu-vsync', '--force-color-profile=srgb', '--font-render-hinting=none'] });
  try {
    if (mode === 'stills') {
      const dir = path.join(OUT, 'stills-check' + SUFFIX);
      await mkdir(dir, { recursive: true });
      const page = await openPage(browser, port);
      for (const a of args) {
        const f = Number(a);
        const buf = await shot(page, f);
        await writeFile(path.join(dir, `f${String(f).padStart(4, '0')}.png`), buf);
        console.log('frame', f);
      }
    } else if (mode === 'sheet') {
      const [a, b, step] = args.map(Number);
      const dir = path.join(OUT, 'sheet' + SUFFIX);
      await mkdir(dir, { recursive: true });
      const page = await openPage(browser, port);
      for (let f = a; f < b; f += step) {
        await writeFile(path.join(dir, `f${String(f).padStart(4, '0')}.png`), await shot(page, f));
      }
      console.log('sheet frames in', dir);
    } else if (mode === 'range') {
      const [a, b] = args.map(Number);
      const dir = path.join(OUT, 'segments' + SUFFIX);
      await mkdir(dir, { recursive: true });
      const n = b - a, per = Math.ceil(n / workers);
      const jobs = [];
      for (let w = 0; w < workers; w++) {
        const s = a + w * per, e = Math.min(b, s + per);
        if (s >= e) continue;
        jobs.push((async () => {
          const page = await openPage(browser, port);
          const file = path.join(dir, `seg-${String(s).padStart(4, '0')}-${String(e).padStart(4, '0')}.mkv`);
          const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', '30', '-c:v', 'png', '-i', '-',
            '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv444p', '-c:v', 'libx264', '-preset', 'medium', '-crf', '6',
            '-x264-params', 'keyint=30', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', file], { stdio: ['pipe', 'inherit', 'inherit'] });
          const t0 = Date.now();
          for (let f = s; f < e; f++) {
            const buf = await shot(page, f);
            if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
            if ((f - s) % 60 === 0) console.log(`[${s}-${e}] ${f} (${((Date.now() - t0) / (f - s + 1)).toFixed(0)} ms/frame)`);
          }
          ff.stdin.end();
          await new Promise((r, j) => ff.on('close', (c) => (c === 0 ? r() : j(new Error('ffmpeg ' + c)))));
          await page.close();
          console.log('done', file);
        })());
      }
      await Promise.all(jobs);
    } else {
      console.error('usage: node render.mjs stills|sheet|range ...');
      process.exitCode = 2;
    }
  } finally {
    await browser.close();
    srv.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
