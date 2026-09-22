"""Build a bounded, public fixture snapshot for the independent visual proposal."""
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
site = json.loads((ROOT / 'web/server/data/site-fixture.json').read_text())
campuses = []
for original in site['campuses']:
    c = {key: original[key] for key in ['key', 'name', 'district', 'address', 'phone', 'image', 'panoramaPos', 'intro', 'description', 'line']}
    c['facebook'] = original['facebook'] if c['key'] == 'yihua' else None
    if isinstance(original['tourScenes'], list):
        c['scenes'] = original['tourScenes']
    else:
        c['scenes'] = [{'name': '校園外觀', 'image': c['image'], 'intro': f"先從外觀與位置，認識{c['name']}。", 'spots': [{'name': f"認識{c['name']}", 'text': f"{c['name']}位於{c['address']}。這張照片取自常春藤機構官網，歡迎觀察校園外觀。", 'question': '室內環境、參觀動線與接送安排，可直接向園所詢問。'}]}]
    c['faq'] = original['faq']['items']
    # Mirror the legacy text normalization in web/app/utils/public-copy.ts.
    c['faq'][0]['a'] = f"請先選擇{c['name']}，查看目前開放的參觀聯絡方式，也可致電 {c['phone']} 詢問。若開放線上填寫，送出的是參觀需求，仍須由園方聯絡確認時間，才算預約成立。"
    c['faq'][2]['a'] = f"招生年齡、名額與費用依校區與學年度而異。請致電 {c['phone']} 向{c['name']}確認當期資訊。"
    c['faq'].append({'q': f"{c['name']}在哪裡？如何聯絡？", 'a': f"{c['name']}位於{c['address']}，參觀專線為 {c['phone']}。請事先聯絡園所確認接待時間，再使用本頁的地圖與路線連結規劃交通。"})
    campuses.append(c)
symbols = []
source = (ROOT / 'index.html').read_text()
for name in ['phone', 'map-pin', 'calendar-check', 'line', 'facebook', 'arrow-right']:
    match = re.search(r'<symbol\b[^>]*id="i-' + name + r'"[\s\S]*?</symbol>', source)
    if match:
        symbols.append(match.group(0))
data = {'campuses': campuses, 'footer': site['footer'], 'symbols': ''.join(symbols)}
(HERE / 'data.js').write_text('window.CAMPUS_PROPOSAL = ' + json.dumps(data, ensure_ascii=False, indent=2) + ';\n')
print(f'Wrote {len(campuses)} campuses and {len(symbols)} existing icon symbols.')
