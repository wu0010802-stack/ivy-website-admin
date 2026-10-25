// 原尺寸播放影片、停在指定格截圖（量螢幕上實際顏色）。node frames.cjs <mp4> <outdir> <chrome|webkit> <W> <H> <fps> <frames,...>
const { chromium, webkit } = require('/Users/yilunwu/Desktop/ivy-website-admin/node_modules/playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const [file, outdir, which, W, H, fps, list] = process.argv.slice(2);
fs.mkdirSync(outdir, { recursive: true });
const buf = fs.readFileSync(file);
const srv = http.createServer((q, s) => {
  if (q.url.startsWith('/v.mp4')) { const r = q.headers.range;
    if (r) { const [a, b] = r.replace('bytes=', '').split('-'); const st = +a, en = b ? +b : buf.length - 1;
      s.writeHead(206, { 'Content-Type': 'video/mp4', 'Content-Range': `bytes ${st}-${en}/${buf.length}`, 'Accept-Ranges': 'bytes', 'Content-Length': en - st + 1 }); return s.end(buf.slice(st, en + 1)); }
    s.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': buf.length }); return s.end(buf); }
  s.writeHead(200, { 'Content-Type': 'text/html' }); s.end(`<!doctype html><body style="margin:0;background:#000"><video id=v src="/v.mp4" muted playsinline style="display:block;width:${W}px;height:${H}px"></video>`);
}).listen(0, async () => {
  const port = srv.address().port;
  const b = await (which === 'webkit' ? webkit.launch() : chromium.launch({ channel: 'chrome' }));
  const p = await b.newPage({ viewport: { width: +W, height: +H } });
  await p.goto(`http://127.0.0.1:${port}/`);
  await p.waitForFunction(() => document.getElementById('v').readyState >= 2);
  await p.evaluate(async () => { const v = document.getElementById('v'); await v.play(); await new Promise(r => setTimeout(r, 500)); v.pause(); });
  for (const [k, f] of list.split(',').map(Number).entries()) {
    await p.evaluate(async (t) => { const v = document.getElementById('v'); v.currentTime = t; await new Promise(r => v.addEventListener('seeked', r, { once: true })); }, (f + 0.5) / +fps);
    await p.waitForTimeout(250);
    await p.screenshot({ path: path.join(outdir, `f${k}.png`) });
  }
  await b.close(); srv.close(); console.log('ok', outdir);
});
