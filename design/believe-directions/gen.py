#!/usr/bin/env python3
"""「我們相信」區塊三個方向的設計畫布產生器（2026-09-15）。
產出 Main.dc.html（方向 A）、DirectionB.dc.html、DirectionC.dc.html、canvas.json 與四張示意照片。
照片從園方廣告片抽幀（避開右上校徽與底部字幕），只做方向討論用，正式版由園方選照。
"""
import base64, re, subprocess, sys, json
from pathlib import Path
from PIL import Image
C = Path(__file__).resolve().parent
ROOT = C.parent.parent
AD = Path.home() / 'Downloads' / '常春藤廣告+配音.mp4'

# ---------- 照片 ----------
PHOTOS = {  # name: (time, crop box in the 1080×1080 frame, out width, quality)
 'intro-curious.jpg':  (16.0, (250, 0, 880, 472), 720, 78),   # 黃衣女孩指著發現的東西（4:3）
 'value-discover.jpg': (21.6, (100, 0, 732, 790), 640, 76),    # 專注低頭觀察的孩子（4:5）
 'value-company.jpg':  (36.9, (230, 0, 862, 790), 640, 76),    # 老師與孩子面對面（4:5）
 'value-grow.jpg':     (20.0, (170, 0, 802, 790), 640, 76),    # 自己拿起東西的孩子（4:5）
}
def make_photos():
    if not AD.exists():
        print('ad video missing; keeping existing photos', file=sys.stderr); return
    for name, (t, box, w, q) in PHOTOS.items():
        tmp = C / '_frame.png'
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(t), '-i', str(AD), '-frames:v', '1', str(tmp)], check=True)
        im = Image.open(tmp).convert('RGB').crop(box)
        if im.width > w: im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
        im.save(C / name, 'JPEG', quality=q, optimize=True, progressive=True)
        tmp.unlink()

# ---------- 色彩 token（與 styles.css / studio.css 相同） ----------
T = dict(green='oklch(38% .055 162)', deep='oklch(28% .04 162)', leaf='oklch(52% .09 158)', paper='oklch(99% .006 100)',
         cream='oklch(96% .02 92)', yellow='oklch(87% .13 88)', text='oklch(31% .025 160)', muted='oklch(47% .025 155)',
         line='oklch(86% .018 145)', white='oklch(99.7% .003 100)', sage='oklch(94% .024 140)', ink='17 42 33')
SYS = "'PingFang TC','Microsoft JhengHei',system-ui,sans-serif"
HEAD = "'LINE Seed TW'," + SYS

def font_css(chars):
    src = ROOT / 'assets' / 'fonts' / 'lineseed-bd.woff'
    out = C / 'lineseed-canvas.woff'
    txt = C / 'chars.txt'; txt.write_text(''.join(sorted(set(chars))))
    subprocess.run(['pyftsubset', str(src), f'--text-file={txt}', '--flavor=woff', '--no-hinting', '--desubroutinize',
                    '--layout-features=*', f'--output-file={out}'], check=True)
    b = base64.b64encode(out.read_bytes()).decode()
    return f"@font-face{{font-family:'LINE Seed TW';font-weight:700;font-display:block;src:url(data:font/woff;base64,{b}) format('woff')}}"

# ---------- 共用片段 ----------
def eyebrow(text, mb=18):
    return f'<span style="display:block;font-size:13px;font-weight:500;letter-spacing:.1em;color:{T["leaf"]};margin-bottom:{mb}px">{text}</span>'
def h2(html, size=40, lh=1.55, extra=''):
    return f'<h2 style="margin:0;font-family:{HEAD};font-weight:700;font-size:{size}px;line-height:{lh};letter-spacing:.01em;color:{T["text"]};{extra}">{html}</h2>'
COPY = '一個問題、一段故事、一次勇敢的嘗試。<br>我們珍惜孩子自己的步調，陪他們在生活裡，慢慢找到「我可以」。'
def copy(mt=24, size=15):
    return f'<p style="margin:{mt}px 0 0;font-size:{size}px;line-height:2;color:{T["muted"]}">{COPY}</p>'
VALUES = [('01', '發現', '把世界，當作教室。', '從故事、植物和日常小事開始，<br>讓每一次觀察，都有新的可能。', 'value-discover.jpg'),
          ('02', '陪伴', '每個步調，都被看見。', '練習表達，也練習聆聽。<br>在理解與關懷中，安心做自己。', 'value-company.jpg'),
          ('03', '成長', '小小的事，自己試試。', '從照顧自己到與同伴分享，<br>累積一點一滴的勇氣與自信。', 'value-grow.jpg')]
def index_label(n, kw, pl=0):
    return (f'<span style="display:flex;gap:10px;align-items:baseline;font-size:12px;letter-spacing:.06em;padding-left:{pl}px">'
            f'<span style="color:{T["leaf"]}">{n}</span><span style="color:{T["muted"]}">{kw}</span></span>')
def h3(text, mt=18):
    return f'<h3 style="margin:{mt}px 0 0;font-family:{HEAD};font-weight:700;font-size:20px;line-height:1.4;color:{T["text"]}">{text}</h3>'
def vp(text, mt=14):
    return f'<p style="margin:{mt}px 0 0;font-size:14px;line-height:2;color:{T["muted"]}">{text}</p>'
def band_top():
    return (f'<div style="height:56px;background:{T["deep"]};display:flex;align-items:center;justify-content:space-between;padding:0 80px;'
            f'color:{T["white"]};font-size:13px;font-weight:500"><span>五所校園：三民 · 左營 · 鳥松 · 仁武</span><span>往下，認識我們</span></div>')
def band_bottom():
    return (f'<div style="height:64px;background:{T["sage"]};display:flex;align-items:center;padding:0 80px;font-size:13px;'
            f'font-weight:500;letter-spacing:.1em;color:{T["leaf"]}">孩子的一天</div>')

def page(title, body, fonts, w=1440):
    return f'''<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <title>{title}</title>
  <style>
    {fonts}
    body {{ margin: 0; background: {T["paper"]}; }}
    a {{ color: {T["green"]}; }} a:hover {{ color: {T["leaf"]}; }}
    img {{ display: block; }}
  </style>
</helmet>
<div style="width:{w}px;background:{T['paper']};color:{T['text']};font-family:{SYS};font-size:16px;line-height:1.8;-webkit-font-smoothing:antialiased">
{body}
</div>
</x-dc>
</body>
</html>
'''

# ---------- 方向 A：照片作證 ----------
def direction_a():
    values = ''.join(
        f'<article style="border-top:1px solid {T["line"]};padding-top:24px;display:flex;flex-direction:column">'
        f'{index_label(n, kw)}{h3(t)}{vp(p)}</article>' for n, kw, t, p, _ in VALUES)
    body = band_top() + f'''
<section style="padding:96px 0 88px">
  <div style="width:1280px;margin:0 auto;display:grid;grid-template-columns:repeat(2, minmax(0, 1fr));gap:96px;align-items:center">
    <div style="display:flex;flex-direction:column;max-width:560px">
      {eyebrow('關於常春藤')}
      {h2('童年，不急著有答案。<br>先讓好奇，有地方發芽。')}
      <p style="margin:24px 0 0;font-size:15px;line-height:2;color:{T['muted']}">常春藤教育機構在高雄有五所幼兒園：義華、明華、崇德、國際與仁武，分布在三民、左營、鳥松和仁武。</p>
      <p style="margin:12px 0 0;font-size:15px;line-height:2;color:{T['muted']}">我們相信孩子從遊戲中學習。老師的陪伴、一次次自己動手的嘗試、戶外的探索與節慶活動，都是為了讓每個孩子在自己的步調裡，慢慢找到「我可以」。</p>
      <a href="#" style="display:inline-flex;align-items:center;align-self:flex-start;min-height:44px;margin-top:28px;border-bottom:1px solid currentColor;font-size:14px;font-weight:600;color:{T['green']};text-decoration:none">認識五所校園</a>
    </div>
    <figure style="margin:0;position:relative">
      <img src="intro-curious.jpg" alt="校園片刻示意：孩子指著發現的東西" style="width:100%;aspect-ratio:4 / 3;object-fit:cover;border-radius:2px">
      <figcaption style="position:absolute;left:-16px;bottom:28px;background:{T['cream']};padding:10px 14px;font-size:12px;line-height:1.6;color:{T['muted']};border-radius:2px;box-shadow:0 10px 24px -16px rgb({T['ink']} / .6)">常春藤的孩子 · 校園片刻</figcaption>
    </figure>
  </div>
  <div style="width:1280px;margin:80px auto 0;display:grid;grid-template-columns:repeat(3, minmax(0, 1fr));gap:56px">
    {values}
  </div>
</section>
''' + band_bottom()
    return body

# ---------- 方向 B：一條發芽的線 ----------
def direction_b():
    # 三個信念沿一條往右上長的線排列：01 最低、03 最高
    tops = [200, 100, 0]
    values = ''.join(
        f'<article style="padding-top:{tp}px;display:flex;flex-direction:column">'
        f'{index_label(n, kw, pl=22)}{h3(t)}{vp(p)}</article>' for (n, kw, t, p, _), tp in zip(VALUES, tops))
    line = (f'<svg aria-hidden="true" viewBox="0 0 1280 420" style="position:absolute;left:0;top:0;width:1280px;height:420px;overflow:visible">'
            f'<path d="M4 210 C 150 208, 300 192, 450 110 S 760 24, 896 10 S 1160 -6, 1276 -40" fill="none" stroke="{T["yellow"]}" stroke-width="3" stroke-linecap="round"/>'
            f'<circle cx="4" cy="210" r="5" fill="{T["yellow"]}"/><circle cx="450" cy="110" r="5" fill="{T["yellow"]}"/><circle cx="896" cy="10" r="5" fill="{T["yellow"]}"/></svg>')
    grow = (f'<span style="position:relative;display:inline-block">有地方發芽'
            f'<svg aria-hidden="true" viewBox="0 0 360 18" style="position:absolute;left:0;bottom:-6px;width:100%;height:16px;overflow:visible">'
            f'<path d="M4 12Q100 0 183 9T354 7" fill="none" stroke="{T["yellow"]}" stroke-width="3.5" stroke-linecap="round"/></svg></span>')
    body = band_top() + f'''
<section style="padding:96px 0 96px">
  <div style="width:1280px;margin:0 auto">
    <div style="max-width:760px;display:flex;flex-direction:column">
      {eyebrow('我們相信')}
      {h2('童年，不急著有答案。<br>先讓好奇，' + grow + '。', size=48, lh=1.45)}
      {copy(mt=28)}
    </div>
  </div>
  <div style="width:1280px;margin:96px auto 0;position:relative">
    {line}
    <div style="position:relative;display:grid;grid-template-columns:repeat(3, minmax(0, 1fr));gap:56px">
      {values}
    </div>
  </div>
</section>
''' + band_bottom()
    return body

# ---------- 方向 C：三個片刻 ----------
def direction_c():
    tops = [0, 56, 112]
    values = ''.join(
        f'<article style="margin-top:{tp}px;display:flex;flex-direction:column">'
        f'<img src="{img}" alt="校園片刻示意：{kw}" style="width:100%;aspect-ratio:4 / 5;object-fit:cover;border-radius:2px">'
        f'<div style="margin-top:22px;display:flex;flex-direction:column">{index_label(n, kw)}{h3(t, mt=12)}{vp(p, mt=10)}</div></article>'
        for (n, kw, t, p, img), tp in zip(VALUES, tops))
    body = band_top() + f'''
<section style="padding:96px 0 88px">
  <div style="width:1280px;margin:0 auto;display:grid;grid-template-columns:1.35fr 1fr;gap:64px;align-items:end">
    <div style="display:flex;flex-direction:column">
      {eyebrow('我們相信')}
      {h2('童年，不急著有答案。<br>先讓好奇，有地方發芽。')}
    </div>
    {copy(mt=0)}
  </div>
  <div style="width:1280px;margin:72px auto 0;display:grid;grid-template-columns:1.1fr 1fr .9fr;gap:40px;align-items:start">
    {values}
  </div>
</section>
''' + band_bottom()
    return body

if __name__ == '__main__':
    make_photos()
    bodies = {'Main.dc.html': ('關於常春藤 · 採用版（左文右圖）', direction_a()),
              'DirectionB.dc.html': ('我們相信 · 方向 B 一條發芽的線', direction_b()),
              'DirectionC.dc.html': ('我們相信 · 方向 C 三個片刻', direction_c())}
    chars = ''.join(re.findall(r'[　-鿿＀-￯0-9/·]', ''.join(b for _, b in bodies.values()))) + '0123456789'
    fonts = font_css(chars)
    for name, (title, body) in bodies.items():
        (C / name).write_text(page(title, body, fonts))
    canvas = {
      'artboards': [
        {'file': 'Main.dc.html', 'title': '關於常春藤 · 採用版', 'x': 0, 'y': 0, 'w': 1440, 'h': 1040, 'page': 'page-1'},
        {'file': 'DirectionB.dc.html', 'title': '方向 B · 一條發芽的線', 'x': 0, 'y': 0, 'w': 1440, 'h': 1020, 'page': 'page-2'},
        {'file': 'DirectionC.dc.html', 'title': '方向 C · 三個片刻', 'x': 1560, 'y': 0, 'w': 1440, 'h': 1270, 'page': 'page-2'},
      ],
      'pages': [{'id': 'page-1', 'name': '關於常春藤（採用）'}, {'id': 'page-2', 'name': '未採用的方向'}],
      'annotations': [
        {'id': 'brief', 'x': 0, 'y': -200, 'w': 520, 'page': 'page-1', 'text': '關於常春藤區塊（2026-09-15 採用）\n左邊是關於常春藤的文字、右邊是照片位置，已實作進網站。文案用的都是既有事實：五所校園與所在區，以及園方廣告片自己的說法（從遊戲中學習、老師陪伴、自己動手嘗試、戶外探索與節慶活動）。照片為廣告片截圖，正式版由園方換成選定的照片。'},
        {'id': 'note-b', 'x': 0, 'y': -150, 'w': 440, 'page': 'page-2', 'text': '方向 B · 一條發芽的線（未採用）\n把標題的「發芽」變成結構：一條黃色手繪線從 01 往右上長到 03。'},
        {'id': 'note-c', 'x': 1560, 'y': -150, 'w': 440, 'page': 'page-2', 'text': '方向 C · 三個片刻（未採用）\n每個信念配一張直式照片，欄寬與起點錯落。'},
      ],
      'launch': {'view': 'canvas', 'page': 'page-1'},
    }
    (C / 'canvas.json').write_text(json.dumps(canvas, ensure_ascii=False, indent=2))
    for f in sorted(C.iterdir()):
        if f.suffix in ('.jpg', '.woff', '.html', '.json'): print(f'{f.stat().st_size:8d}  {f.name}')
