#!/usr/bin/env python3
"""常春藤的一天背景片混剪比稿（2026-11-13）的本機代理，從 design/hero-landscape-20261113/serve.py 改來。

把正式站首頁原封不動搬到本機（第一次讀到的資源快取在 .cache/），依 cookie `daybg` 換「孩子的一天」的背景影片與封面：
  current  正式站現行（明華幼幼六鏡「小手與背影」）
  mix      仁武九幕＋明華幼幼橫式六鏡混剪（本目錄的 day-mix-*）
  pick     使用者看過每一幕後指定的十四鏡（本目錄的 day-pick-*）
左下角的切換鈕會設 cookie 並重新整理；也可以用網址 ?daybg=mix。

只轉 GET；POST、遙測一律在本機吞掉。HTML 裡的 GA4／Meta Pixel 代號清空，另加 CSP 只准連本機，
所以這一頁不會送任何資料到正式站或第三方。不帶任何使用者身分。影片回應支援 Range。

  python3 -I design/day-film-mix-20261113/serve.py   # http://127.0.0.1:8891/?daybg=mix
"""
import hashlib, json, os, re, ssl, urllib.request, urllib.error
from http.cookies import SimpleCookie
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

ORIGIN = 'https://www.ivykidschool.com'
HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, '.cache')
PORT = int(os.environ.get('PORT', '8891'))
BLOCK = re.compile(r'telemetry|client-errors|analytics|gtag|googletagmanager|facebook|fbevents|/collect', re.I)
MIME = {'.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml',
        '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json', '.mp4': 'video/mp4'}
CSP = "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:"
HEAD_GUARD = '<script src="/__mock/guard.js"></script>'
TAIL = '<script src="/__mock/toggle.js" defer></script>'
CAPTION_FROM = '明華校 · 幼幼班的一天'
CAPTION = {'mix': '仁武校 · 明華校', 'pick': '明華校 · 仁武校', 'pick2': '明華校 · 仁武校', 'pick3': '明華校 · 仁武校', 'pick4': '明華校 · 仁武校'}  # 圖說暫定，定案時再確認
# cookie `dayshade`：on＝照正式站；off＝拿掉網頁疊在影片上的墨綠紗；raw＝再加上影片本身不壓暗（只有第四輪有這支檔）
NO_SHADE = '<style>.day-film-shade{display:none!important}</style>'
# cards＝常駐的紗拿掉，只留開場大標那一屏（跟著大標淡掉的 ::before），數值補成跟現在兩層合起來一樣（.6／.34／.67）
TITLE_ONLY = ('<style>.day-film-shade{background:none!important}.day-film-shade::before{background:linear-gradient(180deg,'
              'rgb(var(--ink) / .6),rgb(var(--ink) / .34) 42%,rgb(var(--ink) / .67))!important}</style>')
RAW_FILM = {'pick4': 'day-pick4raw'}
FILM = {'mix': 'day-mix', 'pick': 'day-pick', 'pick2': 'day-pick2', 'pick3': 'day-pick3', 'pick4': 'day-pick4'}
SWAP = [  # 正式站的網址 → 本目錄的檔（{v}＝版本的檔名前綴）
    (re.compile(r'^/assets/(optimized/)?day-(desktop|film)(?!-mobile)[^/]*\.mp4$'), '{v}-desktop.mp4'),
    (re.compile(r'^/assets/(optimized/)?day-(mobile|film-mobile)[^/]*\.mp4$'), '{v}-mobile.mp4'),
    (re.compile(r'^/assets/(optimized/|responsive/)?day-poster-mobile[^/]*\.(webp|avif)$'), '{v}-poster-mobile.webp'),
    (re.compile(r'^/assets/(optimized/|responsive/)?day-poster[^/]*\.(webp|avif)$'), '{v}-poster.webp'),
]

os.makedirs(CACHE, exist_ok=True)
# python.org 版 Python 沒帶憑證，改用 macOS 系統的憑證檔
CTX = ssl.create_default_context(cafile='/etc/ssl/cert.pem' if os.path.exists('/etc/ssl/cert.pem') else None)


def fetch(path):
    key = hashlib.sha1(path.encode()).hexdigest()
    body_f, meta_f = os.path.join(CACHE, key), os.path.join(CACHE, key + '.json')
    if os.path.exists(meta_f):
        with open(meta_f) as f: meta = json.load(f)
        with open(body_f, 'rb') as f: return meta['status'], meta['type'], f.read()
    req = urllib.request.Request(ORIGIN + path, headers={'User-Agent': 'Mozilla/5.0 (local design mockup)', 'Accept-Encoding': 'identity'})
    for attempt in range(3):  # 正式站偶爾 TLS 握手逾時，重試兩次
        try:
            with urllib.request.urlopen(req, timeout=60, context=CTX) as r:
                status, ctype, body = r.status, r.headers.get('Content-Type', 'application/octet-stream'), r.read()
            break
        except urllib.error.HTTPError as e:
            return e.code, e.headers.get('Content-Type', 'text/plain'), e.read()
        except urllib.error.URLError:
            if attempt == 2: return 502, 'text/plain', b'upstream timeout'
    if status == 200:
        with open(body_f, 'wb') as f: f.write(body)
        with open(meta_f, 'w') as f: json.dump({'status': status, 'type': ctype, 'path': path}, f)
    return status, ctype, body


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def send(self, status, ctype, body, cache='max-age=3600'):
        rng = self.headers.get('Range')
        m = re.match(r'bytes=(\d*)-(\d*)', rng or '')
        if status == 200 and m and (ctype.startswith('video/') or ctype == 'application/octet-stream'):
            start = int(m.group(1)) if m.group(1) else max(0, len(body) - int(m.group(2)))
            end = int(m.group(2)) if m.group(1) and m.group(2) else len(body) - 1
            end = min(end, len(body) - 1)
            self.send_response(206)
            self.send_header('Content-Range', f'bytes {start}-{end}/{len(body)}')
            body = body[start:end + 1]
        else:
            self.send_response(status)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Cache-Control', cache)
        if ctype.startswith('text/html'):
            self.send_header('Content-Security-Policy', CSP)
        self.end_headers()
        self.wfile.write(body)

    def variant(self):
        q = re.search(r'[?&]daybg=(\w+)', self.path)  # 網址參數優先於 cookie
        if q: return q.group(1)
        c = SimpleCookie(self.headers.get('Cookie', ''))
        return c['daybg'].value if 'daybg' in c else 'current'

    def shade(self):
        c = SimpleCookie(self.headers.get('Cookie', ''))
        return c['dayshade'].value if 'dayshade' in c else 'on'

    def do_GET(self):
        path, v = self.path.split('?')[0], self.variant()
        shade = self.shade()
        if path.startswith('/__mock/'):
            rel = path[len('/__mock/'):] or 'index.html'
            fp = os.path.normpath(os.path.join(HERE, rel))
            if not fp.startswith(HERE) or not os.path.isfile(fp):
                return self.send(404, 'text/plain', b'not found')
            with open(fp, 'rb') as f:
                return self.send(200, MIME.get(os.path.splitext(fp)[1], 'application/octet-stream'), f.read(), 'no-store')
        if BLOCK.search(self.path):
            return self.send(204, 'text/plain', b'')
        swapped = any(p.match(path) for p, _ in SWAP)
        if swapped and v in FILM:
            for pattern, template in SWAP:
                name = os.path.join(HERE, template.format(v=RAW_FILM[v] if shade == 'raw' and v in RAW_FILM else FILM[v]))
                if pattern.match(path) and os.path.isfile(name):
                    with open(name, 'rb') as f:
                        return self.send(200, MIME[os.path.splitext(name)[1]], f.read(), 'no-store')
        # 靜態檔的 ?daybg= 只給本機判斷用，不轉給正式站、不進快取鍵
        status, ctype, body = fetch(path if re.search(r'\.(mp4|webp|avif|js|css|woff2?)$', path) else self.path)
        cache = 'no-store' if swapped else 'max-age=3600'  # 同一網址依 cookie 回不同檔，不能讓瀏覽器快取
        if ctype.startswith('text/html'):
            html = body.decode('utf-8')
            html = re.sub(r'<head([^>]*)>', lambda m: f'<head{m.group(1)}>{HEAD_GUARD}', html, count=1)
            html = html.replace('</body>', TAIL + '</body>', 1)
            # 這一頁不送遙測、不載 GA4／Meta Pixel
            html = re.sub(r'telemetryEnabled:true', 'telemetryEnabled:false', html)
            html = re.sub(r'errorReportsEnabled:true', 'errorReportsEnabled:false', html)
            html = re.sub(r'gaMeasurementId:"[^"]*"', 'gaMeasurementId:""', html)
            html = re.sub(r'metaPixelId:[^,}]*', 'metaPixelId:""', html)
            if v in FILM:
                html = html.replace(CAPTION_FROM, CAPTION[v])
            if shade in ('off', 'raw'):
                html = html.replace('</head>', NO_SHADE + '</head>', 1)
            elif shade == 'cards':
                html = html.replace('</head>', TITLE_ONLY + '</head>', 1)
            body, cache = html.encode('utf-8'), 'no-store'
        self.send(status, ctype, body, cache)

    def do_POST(self):
        self.send(204, 'text/plain', b'')


if __name__ == '__main__':
    print(f'http://127.0.0.1:{PORT}/?daybg=mix', flush=True)
    ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
