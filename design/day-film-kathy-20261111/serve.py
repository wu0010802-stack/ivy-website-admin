#!/usr/bin/env python3
"""常春藤的一天背景換明華〈2024幼幼班介紹Kathy〉六鏡版（2026-11-11）的本機代理，從 design/day-film-fb-20261105/serve.py 改來。

把正式站首頁原封不動搬到本機（第一次讀到的資源快取在 .cache/），依 cookie `daybg` 換「孩子的一天」的背景：
current＝正式站原檔、hands＝本目錄的 day-kathy-*＋拍立得上來後深綠紗加重（kathy.js／kathy.css）、handsraw＝同一支片但紗不加重。
頁面左下角的切換鈕會設 cookie 並重新整理。只轉 GET；POST 與 telemetry 一律在本機吞掉，不打到正式站。
不帶任何使用者身分。影片回應支援 Range。

  python3 -I design/day-film-kathy-20261111/serve.py   # http://127.0.0.1:8878/?daybg=hands
"""
import hashlib, json, os, re, ssl, urllib.request, urllib.error
from http.cookies import SimpleCookie
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

ORIGIN = 'https://web-production-04caa.up.railway.app'
HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, '.cache')
PORT = int(os.environ.get('PORT', '8878'))
BLOCK = re.compile(r'telemetry|analytics|gtag|googletagmanager|facebook|/collect', re.I)
MIME = {'.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml',
        '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json', '.mp4': 'video/mp4'}
HEAD_GUARD = '<script src="/__mock/guard.js"></script>'
TAIL = '<link rel="stylesheet" href="/__mock/kathy.css"><script src="/__mock/kathy.js" defer></script><script src="/__mock/toggle.js" defer></script>'
CAPTION_FROM = '義華校 · 遊藝表演'
CAPTION = {'hands': '明華校 · 幼幼班的一天', 'handsraw': '明華校 · 幼幼班的一天'}  # 圖說暫定，定案時再確認
FILM = {'hands': os.path.join(HERE, 'day-kathy'), 'handsraw': os.path.join(HERE, 'day-kathy')}
SWAP = [  # 正式站的 AV1／H.264、桌機／手機各一檔，都換成本目錄的 H.264
    (re.compile(r'^/assets/(optimized/)?day-(desktop|film)(?!-mobile)[^/]*\.mp4'), '{v}-desktop.mp4'),
    (re.compile(r'^/assets/(optimized/)?day-(mobile|film-mobile)[^/]*\.mp4'), '{v}-mobile.mp4'),
    (re.compile(r'^/assets/(optimized/|responsive/)?day-poster[^/]*\.webp'), '{v}-poster.webp'),
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
        self.end_headers()
        self.wfile.write(body)

    def variant(self):
        q = re.search(r'[?&]daybg=(\w+)', self.path)  # 總覽頁用網址參數指定，優先於 cookie
        if q: return q.group(1)
        c = SimpleCookie(self.headers.get('Cookie', ''))
        return c['daybg'].value if 'daybg' in c else 'current'

    def do_GET(self):
        path, v = self.path.split('?')[0], self.variant()
        if not path.startswith('/__mock/') and re.search(r'\.(mp4|webp)$', path):
            self.path = path  # 影片與圖片的 ?daybg= 只給本機判斷用，不轉給正式站、不進快取鍵
        if path.startswith('/__mock/'):
            rel = path[len('/__mock/'):] or 'index.html'
            fp = os.path.normpath(os.path.join(HERE, rel))
            if not fp.startswith(HERE) or not os.path.isfile(fp):
                return self.send(404, 'text/plain', b'not found')
            with open(fp, 'rb') as f:
                return self.send(200, MIME.get(os.path.splitext(fp)[1], 'application/octet-stream'), f.read(), 'no-store')
        if BLOCK.search(self.path):
            return self.send(204, 'text/plain', b'')
        if v in FILM:
            for pattern, template in SWAP:
                name = template.format(v=FILM[v])
                if pattern.match(path) and os.path.isfile(name):
                    with open(name, 'rb') as f:
                        return self.send(200, MIME[os.path.splitext(name)[1]], f.read(), 'no-store')
        status, ctype, body = fetch(self.path)
        cache = 'max-age=3600'
        if any(p.match(path) for p, _ in SWAP):
            cache = 'no-store'  # 同一網址依 cookie 回不同檔，不能讓瀏覽器快取
        if ctype.startswith('text/html'):
            html = body.decode('utf-8')
            html = re.sub(r'<head([^>]*)>', lambda m: f'<head{m.group(1)}>{HEAD_GUARD}', html, count=1)
            html = html.replace('</body>', TAIL + '</body>', 1)
            if v in FILM:
                html = html.replace(CAPTION_FROM, CAPTION[v])
            body, cache = html.encode('utf-8'), 'no-store'
        self.send(status, ctype, body, cache)

    def do_POST(self):
        self.send(204, 'text/plain', b'')


if __name__ == '__main__':
    print(f'http://127.0.0.1:{PORT}/?daybg=hands', flush=True)
    ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
