#!/usr/bin/env python3
"""Build three font-direction artboards for the Ivy website canvas."""
import base64, json, re, html as H
from pathlib import Path
C = Path(__file__).resolve().parent
PH = json.load(open(C.parent / 'ph.json'))['icons']

def ico(name, size=18, extra=''):
    return f'<svg viewBox="0 0 256 256" width="{size}" height="{size}" fill="currentColor" aria-hidden="true" style="flex-shrink:0;{extra}">{PH[name]["body"]}</svg>'

def face(family, weight, fname):
    p = C / 'fonts' / fname
    if not p.exists():
        return ''
    b = base64.b64encode(p.read_bytes()).decode()
    return f"@font-face{{font-family:'{family}';font-weight:{weight};font-display:block;src:url(data:font/woff;base64,{b}) format('woff')}}\n"

SYS = "'PingFang TC','Microsoft JhengHei',system-ui,sans-serif"
LS = "'LINE Seed TW'," + SYS
IAN = "'Iansui'," + SYS

DIRS = {
 'DirectionA.dc.html': dict(label='方向 A', name='系統字（現況）', desc='標題與內文都用裝置內建字型：iPhone 是 PingFang，Windows 是微軟正黑體，Android 是 Noto Sans。', body=SYS, head=SYS, hw='600', h1w='600', quote=SYS, qw='500', story=SYS, fonts=''),
 'Main.dc.html': dict(label='方向 B', name='LINE Seed TW 標題（園方選定）', desc='標題改用 LINE Seed TW（免費可商用），所有裝置長相一致；內文維持系統字。已於 2026-09-10 接進網站。', body=SYS, head=LS, hw='700', h1w='800', quote=SYS, qw='500', story=LS, fonts=face('LINE Seed TW',700,'lineseed-bd.woff')+face('LINE Seed TW',800,'lineseed-eb.woff')),
 'DirectionC.dc.html': dict(label='方向 C', name='LINE Seed TW ＋ 芫荽點綴', desc='在方向 B 之上，孩子視角的句子改用芫荽（教育部標準寫法的硬筆楷書，開源可商用），只用於引言。', body=SYS, head=LS, hw='700', h1w='800', quote=IAN, qw='400', story=IAN, fonts=face('LINE Seed TW',700,'lineseed-bd.woff')+face('LINE Seed TW',800,'lineseed-eb.woff')+face('Iansui',400,'iansui.woff')),
}

CSS = """
%%FONTS%%
body{margin:0;background:oklch(99% .006 100)}
a{color:inherit;text-decoration:none}a:hover{color:oklch(52% .09 158)}
h1,h2,h3,p{margin:0}
h1,h2,h3{font-family:%%HEAD%%;font-weight:%%HW%%;line-height:1.4}
.root{width:1200px;background:oklch(99% .006 100);color:oklch(31% .025 160);font-family:%%BODY%%;font-size:16px;line-height:1.8;-webkit-font-smoothing:antialiased}
.container{width:1104px;margin:0 auto}
.eyebrow{display:block;font-size:13px;font-weight:600;letter-spacing:.14em;color:oklch(52% .09 158);margin-bottom:18px;font-family:%%BODY%%}
.button{display:inline-flex;align-items:center;justify-content:center;gap:10px;min-height:52px;padding:12px 28px;border-radius:5px;font-weight:600;line-height:1.5}
.primary{background:oklch(38% .055 162);color:oklch(99% .006 100)}
.yellow{background:oklch(87% .13 88);color:oklch(28% .04 162)}
.text-link{display:inline-flex;align-items:center;gap:8px;min-height:44px;border-bottom:1px solid currentColor;font-weight:600}
.section-title{font-size:36px;letter-spacing:.03em}
.section-copy{color:oklch(47% .025 155);margin-top:24px;line-height:2}
.muted{color:oklch(47% .025 155)}
.quote{font-family:%%QUOTE%%;font-weight:%%QW%%}
.story-title{font-family:%%STORY%%}
.day-trail{display:grid;grid-template-columns:repeat(6, minmax(0, 1fr));margin:44px 0 32px;position:relative;isolation:isolate}
.day-trail:before{content:'';position:absolute;top:18px;left:8.333%;right:8.333%;height:1px;background:oklch(64% .055 155);z-index:-1}
.day-tab{display:flex;flex-direction:column;align-items:center;gap:12px;min-height:82px;padding:0 8px 8px;color:oklch(88% .022 150);font-size:14px;white-space:nowrap}
.day-dot{display:grid;place-items:center;width:38px;height:38px;border:1px solid oklch(64% .055 155);border-radius:50%;background:oklch(38% .055 162)}
.day-tab.on{color:oklch(87% .13 88);font-weight:600}
.day-tab.on .day-dot{background:oklch(87% .13 88);color:oklch(28% .04 162);border-color:oklch(87% .13 88)}
"""

def tab(name, icon, on=False):
    return f'<div class="day-tab{" on" if on else ""}"><span class="day-dot">{ico(icon,18)}</span><span>{name}</span></div>'

CONTENT = """
<div class="root">
 <div style="background:oklch(99.7% .003 100);border-bottom:1px solid oklch(86% .018 145)">
  <div class="container" style="height:105px;display:flex;justify-content:space-between;align-items:center;gap:32px">
   <img src="logo.png" alt="高雄市私立常春藤幼兒園 Ivy Kindergarten" style="width:284px;height:auto;display:block">
   <div style="display:flex;align-items:center;gap:32px">
    <span class="muted" style="font-size:13px;letter-spacing:.08em">給孩子，一個喜歡上學的理由。</span>
    <a class="button primary" href="#" style="min-height:46px;font-size:14px;gap:8px">%%ICO_CAL%%預約參觀</a>
   </div>
  </div>
  <div class="container" style="border-top:1px solid oklch(86% .018 145);min-height:58px;display:flex;justify-content:space-between;align-items:center;gap:20px;font-size:14px;font-weight:500">
   <a href="#">認識常春藤</a><a href="#">教育理念</a><a href="#">五校介紹</a><a href="#">校園生活</a><a href="#">參觀與入學</a>
   <a href="#" style="color:oklch(52% .09 158);font-size:12px">找到離你最近的常春藤</a>
  </div>
 </div>
 <div style="position:relative;height:620px;background:oklch(38% .055 162);color:oklch(99% .006 100);overflow:hidden;isolation:isolate">
  <img src="hero.webp" alt="義華校的戶外活動與孩子的校園生活" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:65% center;z-index:-3">
  <div style="position:absolute;inset:0;background:linear-gradient(90deg, rgb(17 42 33 / .83), rgb(17 42 33 / .28) 60%, rgb(17 42 33 / .08));z-index:-1"></div>
  <div class="container" style="height:100%;display:flex;flex-direction:column;justify-content:center;padding-top:20px;padding-bottom:65px;box-sizing:border-box">
   <span class="eyebrow" style="color:oklch(87% .13 88);margin-bottom:24px">常春藤幼兒園 · 高雄五校</span>
   <h1 style="font-size:56px;font-weight:%%H1W%%;letter-spacing:.06em;line-height:1.45">讓每一份好奇，<br><span style="color:oklch(87% .13 88)">慢慢長大。</span></h1>
   <p style="margin-top:24px;font-size:16px;letter-spacing:.06em">在被理解、被陪伴的日常裡，<br>發現世界，也發現自己的可能。</p>
   <div style="display:flex;gap:28px;align-items:center;margin-top:36px"><a class="button yellow" href="#">走進五所校園</a><a class="text-link" href="#" style="color:oklch(99% .006 100)">認識常春藤</a></div>
  </div>
  <div style="position:absolute;bottom:24px;left:48px;right:48px;display:flex;align-items:center;justify-content:space-between;font-size:12px;letter-spacing:.08em">
   <span style="padding:6px 12px;background:rgb(17 42 33 / .7);border-radius:3px">義華校生活影像 · 影片封面示意</span>
   <span style="display:inline-flex;align-items:center;gap:6px">往下探索%%ICO_DOWN%%</span>
  </div>
 </div>
 <div style="padding:100px 0">
  <div class="container" style="display:grid;grid-template-columns:0.9fr 1.1fr;align-items:center;gap:100px">
   <div>
    <span class="eyebrow">認識常春藤</span>
    <h2 class="section-title" style="font-size:36px;line-height:1.65">成長的每一小步，<br>都值得好好陪伴。</h2>
    <p class="section-copy">一個問題、一段故事、一次勇敢的嘗試。<br>我們相信，學習發生在孩子每天的生活裡。</p>
    <p class="section-copy">從義華校的教育理念出發，認識常春藤重視的愛與關懷，以及閱讀、探索和生活自理的練習。也歡迎走進各校，找到適合孩子的成長環境。</p>
    <a class="text-link" href="#" style="margin-top:32px">我們重視的事</a>
   </div>
   <div style="position:relative;padding-bottom:30px">
    <img src="campus.jpg" alt="義華校校舍與戶外廣場" style="width:100%;aspect-ratio:1.38;object-fit:cover;border-radius:5px 5px 65px 5px;display:block">
    <span class="muted" style="position:absolute;bottom:0;left:24px;background:oklch(96% .02 92);padding:16px 24px;font-size:13px">義華校 · 孩子每天生活的地方</span>
   </div>
  </div>
 </div>
 <div style="background:oklch(38% .055 162);color:oklch(99% .006 100);padding:80px 0">
  <div class="container">
   <div style="display:flex;justify-content:space-between;align-items:end;gap:32px">
    <div><span class="eyebrow" style="color:oklch(87% .13 88)">孩子的一天</span><h2 class="section-title">跟著孩子，過一天。</h2></div>
    <p style="font-size:14px;color:oklch(88% .022 150);line-height:1.9">點選一個片刻，<br>看看成長如何在日常裡發生。</p>
   </div>
   <div class="day-trail">%%TABS%%</div>
   <div style="display:grid;grid-template-columns:1.12fr 1fr;background:oklch(99% .006 100);color:oklch(31% .025 160);border-radius:6px;overflow:hidden;min-height:510px">
    <div style="position:relative;min-height:510px;background:oklch(28% .04 162);isolation:isolate;overflow:hidden">
     <img src="campus.jpg" alt="義華校校園照片 · 入園情境示意" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:-2">
     <div style="position:absolute;inset:45% 0 0;background:linear-gradient(transparent, rgb(17 42 33 / .88));z-index:-1"></div>
     <div style="position:absolute;left:32px;right:32px;bottom:70px;color:oklch(99% .006 100)">
      <span style="font-size:11px;letter-spacing:.14em;color:oklch(87% .13 88)">今天的小小記憶</span>
      <p class="quote" style="font-size:22px;margin-top:12px;line-height:1.8;max-width:20ch">一聲早安，是一天的小小起點。</p>
     </div>
     <span style="position:absolute;bottom:20px;left:32px;right:24px;color:oklch(88% .022 150);font-size:12px;line-height:1.6">義華校校園照片 · 入園情境示意</span>
    </div>
    <div style="padding:36px 40px 28px;display:flex;flex-direction:column;min-width:0">
     <div style="display:flex;justify-content:space-between;align-items:center;color:oklch(52% .09 158);font-size:13px;letter-spacing:.05em"><span>一天的開始</span><span style="font-size:24px;color:oklch(38% .055 162);font-weight:500">01 <span class="muted" style="font-size:11px;font-weight:400">/ 06</span></span></div>
     <h3 class="story-title" style="font-size:27px;line-height:1.65;margin-top:18px">早安，今天的我<br>準備好了。</h3>
     <p class="muted" style="font-size:15px;line-height:2;margin-top:20px;max-width:34ch">和家人說聲再見，走進熟悉的校園。從整理小書包開始，一點一點，找到自己的步調。</p>
     <div style="margin-top:28px;padding-top:22px;border-top:1px solid oklch(86% .018 145)">
      <span class="muted" style="display:block;font-size:11px;margin-bottom:8px">給正在了解學校的你</span>
      <div style="display:flex;gap:16px;justify-content:space-between;align-items:start;font-size:14px;font-weight:500;line-height:1.8"><span>孩子第一次上學，如何陪伴適應？</span>%%ICO_PLUS%%</div>
     </div>
     <div style="margin-top:auto;padding-top:28px;display:flex;justify-content:space-between;gap:12px;align-items:center">
      <span class="muted" style="font-size:12px;white-space:nowrap">已探索 1 / 6 個片刻</span>
      <div style="display:flex;gap:8px">
       <span style="display:inline-flex;align-items:center;justify-content:center;min-width:44px;min-height:44px;border:1px solid oklch(86% .018 145);border-radius:4px;opacity:.5">%%ICO_LEFT%%</span>
       <span style="display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:8px 12px;border-radius:4px;background:oklch(38% .055 162);color:oklch(99% .006 100);font-size:12px">下一個片刻%%ICO_RIGHT%%</span>
      </div>
     </div>
    </div>
   </div>
   <div style="margin-top:24px;display:flex;align-items:center;justify-content:space-between;gap:32px">
    <p style="font-size:12px;color:oklch(88% .022 150);max-width:64ch">日常情境提案，以義華校影像呈現；各校、各班實際作息請向園所確認。</p>
    <a class="text-link" href="#" style="font-size:13px;color:oklch(99% .006 100)">想親自看看？認識五所校園</a>
   </div>
  </div>
 </div>
 <div style="background:oklch(96% .02 92);border-top:1px solid oklch(86% .018 145)">
  <div class="container" style="display:flex;align-items:baseline;justify-content:space-between;gap:32px;padding:22px 0">
   <div style="display:flex;align-items:baseline;gap:16px"><strong style="font-size:18px;color:oklch(38% .055 162)">%%LABEL%% · %%NAME%%</strong><span class="muted" style="font-size:13px">%%DESC%%</span></div>
   <span class="muted" style="font-size:12px;white-space:nowrap">常春藤官網字型方向比較</span>
  </div>
 </div>
</div>
"""

TABS = ''.join([tab('早安入園','sun-horizon',True), tab('好奇探索','magnifying-glass'), tab('一起用餐','bowl-food'), tab('安靜片刻','moon-stars'), tab('午後玩耍','tree'), tab('帶故事回家','house-line')])

def build(fname, d):
    content = (CONTENT
        .replace('%%ICO_CAL%%', ico('calendar-check', 16)).replace('%%ICO_DOWN%%', ico('arrow-down', 14))
        .replace('%%ICO_PLUS%%', ico('plus', 18, 'margin-top:4px')).replace('%%ICO_LEFT%%', ico('arrow-left', 16)).replace('%%ICO_RIGHT%%', ico('arrow-right', 16))
        .replace('%%TABS%%', TABS).replace('%%H1W%%', d['h1w'])
        .replace('%%LABEL%%', d['label']).replace('%%NAME%%', d['name']).replace('%%DESC%%', d['desc']))
    css = (CSS.replace('%%FONTS%%', d['fonts']).replace('%%HEAD%%', d['head']).replace('%%HW%%', d['hw'])
        .replace('%%BODY%%', d['body']).replace('%%QUOTE%%', d['quote']).replace('%%QW%%', d['qw']).replace('%%STORY%%', d['story']))
    page = f'<!doctype html>\n<html>\n<head>\n  <meta charset="utf-8">\n  <script src="./support.js"></script>\n</head>\n<body>\n<x-dc>\n<helmet>\n  <style>{css}</style>\n</helmet>\n{content}\n</x-dc>\n</body>\n</html>\n'
    (C / fname).write_text(page)
    return content

texts = []
for fname, d in DIRS.items():
    texts.append(build(fname, d))
chars = set()
for t in texts:
    plain = H.unescape(re.sub(r'<[^>]+>', ' ', t))
    chars.update(ch for ch in plain if not ch.isspace())
chars.update('0123456789/ ·（）：，。、！？「」')
(C / 'chars.txt').write_text(''.join(sorted(chars)))
H_ART = 2600
canvas = {
 'pages': [{'id': 'page-1', 'name': '選定：方向 B'}, {'id': 'page-2', 'name': '未採用的方向'}],
 'artboards': [
  {'file': 'Main.dc.html', 'title': '方向 B · LINE Seed TW 標題（園方選定）', 'x': 0, 'y': 0, 'w': 1200, 'h': H_ART, 'page': 'page-1'},
  {'file': 'DirectionA.dc.html', 'title': '方向 A · 系統字（現況）', 'x': 0, 'y': 0, 'w': 1200, 'h': H_ART, 'page': 'page-2'},
  {'file': 'DirectionC.dc.html', 'title': '方向 C · LINE Seed TW ＋ 芫荽點綴', 'x': 1320, 'y': 0, 'w': 1200, 'h': H_ART, 'page': 'page-2'},
 ],
 'annotations': [
  {'id': 'brief', 'x': 0, 'y': -420, 'w': 620, 'page': 'page-1', 'text': '字型方向：園方於 2026-09-10 選定方向 B。\n標題改用 LINE Seed TW，內文維持系統字，已接進網站；未採用的方向 A 與 C 保留在第二頁。'},
  {'id': 'note-b', 'x': 0, 'y': -200, 'w': 1200, 'page': 'page-1', 'text': '方向 B · LINE Seed TW 標題\n動機：標題換成圓角親和的 LINE Seed TW，所有裝置長相一致；內文仍是系統字，閱讀習慣不變。\n取捨：多載入約 190KB 字型（已只保留全站用到的字）；頁尾已註明字型來源。'},
  {'id': 'note-a', 'x': 0, 'y': -200, 'w': 1200, 'page': 'page-2', 'text': '方向 A · 系統字（現況）\n動機：零載入成本；iPhone 上是 PingFang，讀起來最熟悉。\n取捨：Windows 變成微軟正黑體、Android 是 Noto Sans，三種裝置長相不同，品牌感無法統一。'},
  {'id': 'note-c', 'x': 1320, 'y': -200, 'w': 1200, 'page': 'page-2', 'text': '方向 C · B ＋ 芫荽點綴\n動機：孩子視角的句子改用教育部標準寫法的硬筆楷書，一眼看出「這是孩子說的話」，也是台灣幼教熟悉的語彙。\n取捨：多一套字型與一條使用規則；只能留給引言，用多了會顯得幼稚。'},
 ],
 'launch': {'view': 'canvas', 'page': 'page-1'},
}
(C / 'canvas.json').write_text(json.dumps(canvas, ensure_ascii=False, indent=1))
print('built', list(DIRS), '| unique chars:', len(chars), '| fonts embedded:', {k: bool(v['fonts']) for k, v in DIRS.items()})
