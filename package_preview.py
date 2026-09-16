"""Bundle the local prototype into a self-contained HTML, without dependencies."""
from pathlib import Path
import base64

root = Path(__file__).resolve().parent
html = (root / 'index.html').read_text()
css = (root / 'styles.css').read_text() + '\n' + (root / 'studio.css').read_text()
js = (root / 'app.js').read_text()
assets = {}
for path in sorted((root / 'assets').glob('*')):
    if path.suffix not in ('.webp', '.png'):
        continue
    mime = 'image/png' if path.suffix == '.png' else 'image/webp'
    assets[path.name] = 'data:' + mime + ';base64,' + base64.b64encode(path.read_bytes()).decode()
import json
js = 'const EMBEDDED_ASSETS = ' + json.dumps(assets) + ';\n' + js.replace("'use strict';", '')
js = js.replace('src="assets/${name}.webp"', 'src="${EMBEDDED_ASSETS[name+\'.webp\']}"')
js = js.replace("'assets/'+trigger.dataset.photo+'.webp'", "EMBEDDED_ASSETS[trigger.dataset.photo+'.webp']")
js = js.replace('poster="assets/hero-campus-still.webp"', 'poster="${EMBEDDED_ASSETS[\'hero-campus-still.webp\']}"')
video = root / 'assets' / 'hero-campus.mp4'
if video.exists():
    js = js.replace("const HERO_VIDEO_SRC = 'assets/hero-campus.mp4';", "const HERO_VIDEO_SRC = 'data:video/mp4;base64," + base64.b64encode(video.read_bytes()).decode() + "';")
import re
html = re.sub(r'<link rel="preload"[^>]*href="assets/[^"]+"[^>]*>', '', html)
for font in sorted((root / 'assets' / 'fonts').glob('*.woff')):
    css = css.replace('url(assets/fonts/' + font.name + ')', 'url(data:font/woff;base64,' + base64.b64encode(font.read_bytes()).decode() + ')')
html = html.replace('src="assets/logo.png"', 'src="' + assets['logo.png'] + '"')
css = css.replace('url("assets/logo.png")', 'url("' + assets['logo.png'] + '")')
html = html.replace('<link rel="stylesheet" href="styles.css">', '<style>' + css + '</style>')
html = html.replace('<link rel="stylesheet" href="studio.css">', '')
html = html.replace('<script src="app.js" defer></script>', '')
html = html.replace('</body>', '<script>\n' + js + '\n</script></body>')
(root / 'preview.html').write_text(html)
print('Created preview.html:', len(html.encode()), 'bytes')
