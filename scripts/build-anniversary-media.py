#!/usr/bin/env python3
"""30 週年分頁（/anniversary）時間軸的素材場：五校卡片、校徽、紙偶、紙紋。

來源是《手牽手，走到 30》展示作的輸出資料夾（repo 外、已 gitignore 的
output/ivy-30th-20261003/ 的 page-assets/）。重算素材場之後跑一次：

    python3 scripts/build-anniversary-media.py --src ~/Desktop/ivy-website-admin/output/ivy-30th-20261003

輸出到 web/public/assets/anniversary/，檔名帶內容雜湊（/assets 是長快取），
並改寫 web/app/utils/anniversary/media.ts。

2026-11-11：那支 30 秒開場動畫與它的海報不再放上官網（首屏換成紀念影片《長成自己喜歡的樣子》，
素材由 scripts/build-anniversary-film.py 產生、放在 assets/anniversary-film/），這裡不再輸出影片與海報。
"""
import argparse
import hashlib
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'web/public/assets/anniversary'
TS = ROOT / 'web/app/utils/anniversary/media.ts'
CAMPUS_KEYS = ['yihua', 'minghua', 'chongde', 'international', 'renwu']


def digest(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()[:10]


def publish(tmp: Path, stem: str, ext: str) -> str:
    name = f'{stem}-{digest(tmp)}.{ext}'
    shutil.copyfile(tmp, OUT / name)
    return f'/assets/anniversary/{name}'


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True, type=Path)
    a = ap.parse_args()
    src = a.src.expanduser()
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob('*'):
        old.unlink()
    media: dict = {}
    pa = src / 'page-assets'
    media['fields'] = {k: publish(pa / f'fields-{k}.webp', f'fields-{k}', 'webp') for k in CAMPUS_KEYS}
    media['crestFields'] = publish(pa / 'crest-fields.webp', 'crest-fields', 'webp')
    media['kidsBody'] = publish(pa / 'kids-body.webp', 'kids-body', 'webp')
    media['kidsBorder'] = publish(pa / 'kids-border.webp', 'kids-border', 'webp')
    media['paper'] = publish(pa / 'paper-tile.webp', 'paper', 'webp')
    meta = json.loads((pa / 'meta.json').read_text())
    media['cards'] = meta['cards']
    media['kid'] = meta['kid']
    body = json.dumps(media, ensure_ascii=False, indent=2)
    TS.write_text(
        '// 由 scripts/build-anniversary-media.py 產生，不要手改。\n'
        '// 時間軸的素材場來自《手牽手，走到 30》展示作（output/ivy-30th-20261003）。首屏的紀念影片在 film-media.ts。\n'
        f'export const ANNI_MEDIA = {body} as const\n'
    )
    for k, v in media.items():
        if isinstance(v, str):
            print(k, v, (OUT / Path(v).name).stat().st_size // 1024, 'KB')


if __name__ == '__main__':
    main()
