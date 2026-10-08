"""地址正規化與解析（2026-10-08 區域分析規格 §6.2）。純函式，不連資料庫。"""

from __future__ import annotations

import pytest

from app.admissions.geo.address import ParsedAddress, cn_number, cn_to_int, normalize_text, parse_address, unit_token
from app.admissions.geo.kaohsiung import CODE_OF_DISTRICT, DISTRICTS, LEGACY_TOWNS, TOWN_CODES, fix_village_name


def P(district=None, street=None, lane=None, alley=None, number=None, sub=0, outside=False) -> ParsedAddress:
    return ParsedAddress(district, street, lane, alley, number, sub, outside)


YIHUA_68 = P("三民區", "義華路", number=68)
YIHUA_68_1 = P("三民區", "義華路", number=68, sub=1)
OUTSIDE = P(outside=True)
NO_DISTRICT = P()

CASES = [
    # 同一個門牌的各種寫法（Review Focus 1）
    ("高雄市三民區義華路68號", YIHUA_68),
    ("807高雄市三民區義華路68號", YIHUA_68),
    ("80794高雄市三民區義華路68號", YIHUA_68),
    ("[807]高雄市三民區義華路６８號", YIHUA_68),
    ("（807）高雄市三民區義華路68號", YIHUA_68),
    ("台灣高雄市三民區義華路68號", YIHUA_68),
    ("三民區義華路68號", YIHUA_68),
    ("高雄三民區義華路68號", YIHUA_68),
    ("高雄市 三民區 義華路 68 號", YIHUA_68),
    ("高雄市三民區本揚里3鄰義華路68號3樓之2", YIHUA_68),
    ("高雄市三民區鼎金里義華路68號", YIHUA_68),
    ("高雄市三民區3鄰義華路68號", YIHUA_68),
    ("高雄市三民區義華路68號3F", YIHUA_68),
    ("高雄市三民區義華路68號十二樓之3", YIHUA_68),
    ("高雄市三民區義華路68", YIHUA_68),
    ("高雄市三民區義華路六十八號", YIHUA_68),
    ("高雄市三民區義華路68-1號", YIHUA_68_1),
    ("高雄市三民區義華路68－1號", YIHUA_68_1),
    ("高雄市三民區義華路68之1號", YIHUA_68_1),
    ("高雄市三民區義華路68號之1", YIHUA_68_1),
    # 外縣市
    ("臺北市大安區信義路三段1號", OUTSIDE),
    ("台中市西屯區台灣大道三段99號", OUTSIDE),
    ("屏東縣屏東市自由路1號", OUTSIDE),
    ("臺南市東區中華東路二段185巷14號", OUTSIDE),
    ("台南市", OUTSIDE),
    # 舊高雄縣
    ("高雄縣仁武鄉京吉一路102號", P("仁武區", "京吉一路", number=102)),
    ("高雄縣鳳山市建國路三段100號", P("鳳山區", "建國路三段", number=100)),
    ("高雄縣三民鄉民生村1號", P("那瑪夏區", "民生村", number=1)),
    # 路名序數、段號的阿拉伯數字轉成門牌表的中文寫法
    ("高雄市仁武區京吉1路102號", P("仁武區", "京吉一路", number=102)),
    ("高雄市鳳山區建國路3段100號", P("鳳山區", "建國路三段", number=100)),
    ("高雄市三民區建國3路100號", P("三民區", "建國三路", number=100)),
    ("高雄市三民區民族1路10號", P("三民區", "民族一路", number=10)),
    ("高雄市彌陀區舊港路東段46巷21號", P("彌陀區", "舊港路東段", lane="46", number=21)),
    # 街名本身帶「里」「村」不能被當成里拿掉
    ("高雄市大樹區五里路1號", P("大樹區", "五里路", number=1)),
    ("高雄市橋頭區里林東路10號", P("橋頭區", "里林東路", number=10)),
    # 「臺」統一成門牌表的「台」
    ("高雄市大寮區臺上路1號", P("大寮區", "台上路", number=1)),
    # 「地區」型、具名巷、巷弄
    ("高雄市楠梓區右昌一巷12號", P("楠梓區", "右昌一巷", number=12)),
    ("高雄市仁武區仁心路博愛巷1弄2之1號", P("仁武區", "仁心路", lane="博愛", alley="1", number=2, sub=1)),
    ("高雄市三民區義華路12巷3弄5號", P("三民區", "義華路", lane="12", alley="3", number=5)),
    ("高雄市三民區義華路十二巷5號", P("三民區", "義華路", lane="12", number=5)),
    ("高雄市三民區義華路12巷", P("三民區", "義華路", lane="12")),
    ("高雄市三民區義華路", P("三民區", "義華路")),
    ("高雄市三民區", P("三民區")),
    # 多門牌：取寫著「號」的那個
    ("高雄市楠梓區大學東路115、117號", P("楠梓區", "大學東路", number=117)),
    # 解析不出高雄市的區
    ("義華路68號", NO_DISTRICT),
    ("高雄市", NO_DISTRICT),
    ("台北", NO_DISTRICT),
]


@pytest.mark.parametrize(("raw", "expected"), CASES, ids=[case[0] for case in CASES])
def test_parse_address(raw, expected):
    assert parse_address(raw) == expected


@pytest.mark.parametrize("raw", [None, "", "   ", "　　"])
def test_blank_address_is_none(raw):
    assert parse_address(raw) is None


def test_chinese_numbers():
    assert [cn_number(n) for n in (1, 3, 10, 12, 20, 21)] == ["一", "三", "十", "十二", "二十", "二十一"]
    assert [cn_to_int(t) for t in ("三", "十", "十二", "二十", "六十八")] == [3, 10, 12, 20, 68]
    assert cn_to_int("博愛") is None
    assert cn_to_int("") is None


def test_normalize_text():
    assert normalize_text("臺北 １２３－４　號") == "台北123-4號"


@pytest.mark.parametrize(("token", "expected"), [("06", "6"), ("66", "66"), ("十二", "12"), ("博愛", "博愛"), ("光明10", "光明10")])
def test_unit_token(token, expected):
    assert unit_token(token) == expected


def test_kaohsiung_tables():
    assert len(TOWN_CODES) == 38 and len(DISTRICTS) == 38
    assert CODE_OF_DISTRICT["三民區"] == "6400500" and CODE_OF_DISTRICT["仁武區"] == "6401700"
    assert len(LEGACY_TOWNS) == 27
    assert set(LEGACY_TOWNS.values()) <= DISTRICTS
    assert LEGACY_TOWNS["三民鄉"] == "那瑪夏區"


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("北美術館", "北美術館里"), ("南美術館", "南美術館里"), ("達卡努瓦", "達卡努瓦里"), ("鼎金里", "鼎金里"), (" 本揚里 ", "本揚里")],
)
def test_fix_village_name(raw, expected):
    assert fix_village_name(raw) == expected
