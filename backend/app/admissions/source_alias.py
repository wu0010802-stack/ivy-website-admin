"""招生來源的相近寫法（2026-11-20，招生統計「來源分析」的「合併相近寫法」）。

來源是自由文字：同一個管道會被寫成「FB」「Facebook」「臉書」，來源排名把它們拆成三列，每列筆數都少、
可能範圍都很寬，看不出這個管道其實是第二大來源。這裡只負責把一個寫法換成「比對用的鍵」：鍵相同就當成
同一個來源，合併與比率、可能範圍在 stats.py 算（用同一支 estimation.rate_range，前端不重算）。

只合併「同一個東西的不同寫法」，不合併「相關但不同的管道」：
- 大小寫、全形半形、空白與標點的差異（「Face book」「ＦＢ」「Google  評論」）。
- 中英文與縮寫（FB＝Facebook＝臉書、IG＝Instagram、谷歌＝Google、賴＝LINE）。
- 幾個固定說法（官方網站＝官網、朋友介紹＝親友介紹、傳單＝傳單／DM）。
「Google 評論」「Google 搜尋」「Google 地圖」是不同管道，各自一組；「FB 廣告」和「FB」也不同。
拿不準的不要加進表裡：合併錯了會把兩個管道的預繳率混在一起，比分開算更誤導。

只用標準函式庫、不碰資料庫（同 estimation.py）。資料庫裡存的仍是家長或老師填的原文，這裡不改資料。
"""
from __future__ import annotations

import re
import unicodedata

# 比對時不看的字元：空白與常見的分隔、括號標點。
_IGNORED = re.compile(r"[\s\-_/・．.。,，、:：()\[\]「」『』]+")

# 整段換字：中文說法換成英文名（「臉書粉專」→「facebook粉專」）。
_REPLACEMENTS: tuple[tuple[str, str], ...] = (
    ("臉書", "facebook"),
    ("面書", "facebook"),
    ("谷歌", "google"),
    ("估狗", "google"),
)

# 開頭的縮寫：後面不是英文字母才換（「fb」「fb粉專」換，「fbi」不換）。
_PREFIXES: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"^fb(?![a-z])"), "facebook"),
    (re.compile(r"^ig(?![a-z])"), "instagram"),
)

# 整個鍵完全相同才換的固定說法。
_SYNONYMS: dict[str, str] = {
    "賴": "line",
    "官方網站": "官網",
    "學校官網": "官網",
    "學校網站": "官網",
    "網站": "官網",
    "朋友介紹": "親友介紹",
    "親戚介紹": "親友介紹",
    "友人介紹": "親友介紹",
    "親友推薦": "親友介紹",
    "朋友推薦": "親友介紹",
    "傳單": "傳單dm",
    "dm": "傳單dm",
}


def source_key(label: str) -> str:
    """來源寫法的比對鍵：鍵相同的寫法算同一個來源。認不出任何規則的寫法，鍵就是它正規化後的自己。"""
    key = _IGNORED.sub("", unicodedata.normalize("NFKC", label).casefold())
    for old, new in _REPLACEMENTS:
        key = key.replace(old, new)
    for pattern, new in _PREFIXES:
        key = pattern.sub(new, key)
    return _SYNONYMS.get(key, key)
