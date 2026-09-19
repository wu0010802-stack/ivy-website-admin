"""Snapshot R with an independent A ending. Never writes to the source R page."""
from pathlib import Path
import re

base = Path(__file__).resolve().parent
source = (base.parent / 'day-timeline-directions/r.html').read_text()
source = source.replace('R 紙張翻面｜常春藤・孩子的一天', 'A 把今天背回家｜常春藤的一天')
source = source.replace('body class="', 'body class="homecoming-preview ')
source = re.sub(r'(href|src)="((?:directions[^"/]*\.css|compare\.js|round\d+\.js))"',
                r'\1="../day-timeline-directions/\2"', source)
source = source.replace('</head>', '<link rel="stylesheet" href="ending.css">\n<script src="ending.js" defer></script>\n</head>')
source = re.sub(r'          <section class="finale finale-q".*?</section>', '', source, flags=re.S)
source = re.sub(r'        <footer class="day-ending">.*?</footer>', '', source, flags=re.S)
source = re.sub(r'<nav class="design-toolbar".*?</nav>', '', source, flags=re.S)
ending = (base / 'ending.html').read_text()
# Static completed composition remains available without JavaScript.
for selector, transform in {
    'hc-parent': 'translate(704 120)', 'hc-child': 'translate(470 120)',
    'hc-bag-back': 'translate(561 357) rotate(-12) scale(.36)',
    'hc-bag-front': 'translate(561 357) rotate(-12) scale(.36)',
    'hc-flap-wrap': 'translate(561 357) rotate(-12) scale(.36)',
    'hc-hold': 'translate(768 335)',
}.items():
    ending = ending.replace(f'class="{selector}" aria-hidden', f'class="{selector}" transform="{transform}" aria-hidden')
source = source.replace('  </main>', ending + '\n  </main>')
(base / 'index.html').write_text(source)
print('Built', base / 'index.html')
