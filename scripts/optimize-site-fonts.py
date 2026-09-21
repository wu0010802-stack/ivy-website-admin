"""以同一份字形轉 WOFF2，不擴張／變更現有子集。需 fontTools[woff]。"""
from pathlib import Path
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
for name in ['lineseed-bd', 'lineseed-eb']:
    source = ROOT / f'web/public/assets/fonts/{name}.woff'
    target = source.with_suffix('.woff2')
    font = TTFont(source)
    font.flavor = 'woff2'
    font.save(target)
    print(f'{name}: {source.stat().st_size:,} → {target.stat().st_size:,} bytes')
