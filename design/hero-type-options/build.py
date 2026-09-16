"""Build an offline typography comparison from the current header and hero."""
from pathlib import Path
import base64
import json
import re

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent


def data_uri(path, mime):
    return f'data:{mime};base64,' + base64.b64encode(path.read_bytes()).decode()


index = (ROOT / 'index.html').read_text()
app = (ROOT / 'app.js').read_text()
css = (ROOT / 'styles.css').read_text() + '\n' + (ROOT / 'studio.css').read_text()
for name in ('lineseed-bd.woff', 'lineseed-eb.woff'):
    css = css.replace('url(assets/fonts/' + name + ')', 'url(' + data_uri(ROOT / 'assets/fonts' / name, 'font/woff') + ')')
logo = data_uri(ROOT / 'assets/logo.png', 'image/png')
css = css.replace('assets/logo.png', logo)
for font in json.loads((HERE / 'fonts/sources.json').read_text()):
    uri = data_uri(HERE / 'fonts' / font['file'], 'font/ttf')
    css += f"\n@font-face{{font-family:'{font['family']}';font-weight:{font['weight']};font-display:swap;src:url({uri}) format('truetype')}}"

sprite = index.split('<body>', 1)[1].split('<a class="skip"', 1)[0]
header = re.search(r'<header\b.*?</header>', index, re.S).group().replace('assets/logo.png', logo)
hero = app.split('function home(){return `\n', 1)[1].split('\n<section class="section studio-about"', 1)[0]
hero = re.sub(r"\$\{icon\('([^']+)'\)\}", lambda m: f'<svg class="icon" aria-hidden="true"><use href="#i-{m[1]}"/></svg>', hero)
poster = data_uri(ROOT / 'assets/hero-campus-still.webp', 'image/webp')
hero = re.sub(r"\$\{img\([^}]+\)\}", f'<img src="{poster}" alt="常春藤孩子的校園生活影像">', hero)
hero = re.sub(r'<video\b.*?</video>', '', hero, flags=re.S)
hero = hero.replace('<div id="video-controls" hidden>', '<div id="video-controls">')
hero = hero.replace('播放影片</button>', '靜態畫面</button>')
css += '\n.studio-hero-copy>*,.studio-hero .growing-word path{animation:none!important}.studio-hero .growing-word path{stroke-dashoffset:0}body{overflow-x:hidden}a,button{cursor:default}'
scene = f'<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>{css}</style><style id="type-variant"></style></head><body>{sprite}{header}<main>{hero}</main></body></html>'
assert '${' not in scene
template = (HERE / 'viewer.template.html').read_text()
result = template.replace('__SCENE_B64__', base64.b64encode(scene.encode()).decode())
(HERE / 'index.html').write_text(result)
print(f'Created {HERE / "index.html"} ({len(result.encode()):,} bytes)')
