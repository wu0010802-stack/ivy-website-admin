"""地址正規化與解析（2026-10-08 區域分析規格 §6.2）。純函式，不連資料庫。"""

from __future__ import annotations

import pytest

from app.admissions.geo.address import (
    MAX_UNIT_LENGTH,
    ParsedAddress,
    cn_number,
    cn_to_int,
    normalize_text,
    parse_address,
    unit_token,
)
from app.admissions.geo.kaohsiung import (
    CODE_OF_DISTRICT,
    DISTRICTS,
    KAOHSIUNG_LAT_RANGE,
    KAOHSIUNG_LNG_RANGE,
    LEGACY_TOWNS,
    TOWN_CODES,
    fix_village_name,
    in_kaohsiung,
)


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
    # 「號」之後的樓層不被當成之號（樓、F、f、數字都擋）
    ("高雄市三民區義華路68號之1樓", YIHUA_68),
    ("高雄市三民區義華路68號之12樓", YIHUA_68),
    ("高雄市三民區義華路68號之3f", YIHUA_68),
    # 破折號：U+2212 MINUS SIGN 也算
    ("高雄市三民區義華路68\N{MINUS SIGN}1號", YIHUA_68_1),
    # 里名四個字（北美術館里）
    ("高雄市鼓山區北美術館里美術東二路100號", P("鼓山區", "美術東二路", number=100)),
    # 前導零（門牌號補零到 6 位）先去零再判斷長度
    ("高雄市三民區義華路000068號", YIHUA_68),
    ("高雄市三民區義華路000068-000001號", YIHUA_68_1),
    # 之號接中文數字：「二十之一號」是 20 之 1，不是 1 號
    ("高雄市三民區義華路二十之一號", P("三民區", "義華路", number=20, sub=1)),
    ("高雄市三民區義華路二十－一號", P("三民區", "義華路", number=20, sub=1)),
    ("高雄市三民區義華路六十八號之一", YIHUA_68_1),
    ("高雄市三民區義華路68號之一", YIHUA_68_1),
    ("高雄市三民區義華路六十八號之二十", P("三民區", "義華路", number=68, sub=20)),
    # 「號之N樓」的樓不是之號（中文數字也一樣，不能退成「之十」）
    ("高雄市三民區義華路六十八號之一樓", YIHUA_68),
    ("高雄市三民區義華路六十八號之十二樓", YIHUA_68),
    # 百、千、零：整段轉成數字，不只吃到後半
    ("高雄市三民區義華路一百二十號", P("三民區", "義華路", number=120)),
    ("高雄市三民區義華路一百零五號", P("三民區", "義華路", number=105)),
    ("高雄市三民區義華路一百號", P("三民區", "義華路", number=100)),
    ("高雄市三民區義華路兩百號", P("三民區", "義華路", number=200)),
    ("高雄市三民區義華路二千號", P("三民區", "義華路", number=2000)),
    ("高雄市三民區義華路一千零五號", P("三民區", "義華路", number=1005)),
    ("高雄市三民區義華路一百二十號之三", P("三民區", "義華路", number=120, sub=3)),
    # 中文數字巷弄轉成門牌表的數字字串（含百、零）
    ("高雄市三民區義華路一百零八巷5號", P("三民區", "義華路", lane="108", number=5)),
    ("高雄市三民區義華路一百零八巷二十號之三", P("三民區", "義華路", lane="108", number=20, sub=3)),
    ("高雄市三民區義華路十二巷三弄五號", P("三民區", "義華路", lane="12", alley="3", number=5)),
    ("高雄市三民區義華路一百二十巷", P("三民區", "義華路", lane="120")),
    # 巷弄超過欄寬（16 字）：放不進門牌表、也不可能比對到，不猜街路段，只留區
    ("高雄市三民區義華路" + "甲" * 17 + "巷5號", P("三民區")),
    ("高雄市三民區義華路12巷" + "乙" * 17 + "弄5號", P("三民區")),
    ("高雄市三民區義華路" + "1" * 17 + "巷5號", P("三民區")),
    ("高雄市三民區右昌" + "1" * 17 + "巷5號", P("三民區")),
    # 剛好 16 字、去掉前導零後才 16 字都收
    ("高雄市三民區義華路" + "甲" * 16 + "巷5號", P("三民區", "義華路", lane="甲" * 16, number=5)),
    ("高雄市三民區義華路" + "0" * 20 + "12巷5號", P("三民區", "義華路", lane="12", number=5)),
    # 兩個以上的之號：同門牌表只取第一個（2026-10-13：原本會從中間的「3之4號」開始比對）
    ("高雄市三民區建國路12之3之4號", P("三民區", "建國路", number=12, sub=3)),
    ("高雄市三民區建國路12-3-4號", P("三民區", "建國路", number=12, sub=3)),
    ("高雄市三民區建國路十二之三之四號", P("三民區", "建國路", number=12, sub=3)),
    # 巷弄和號之間夾了別的字：巷弄讀前面乾淨的編號，號不用（不能對到街上同號的別戶）
    ("高雄市三民區建國路100巷，5號", P("三民區", "建國路", lane="100")),
    ("高雄市三民區建國路100巷(近公園)5號", P("三民區", "建國路", lane="100")),
    ("高雄市三民區建國路100巷內5號", P("三民區", "建國路", lane="100")),
    ("高雄市三民區建國路100巷5弄(後棟)3號", P("三民區", "建國路", lane="100", alley="5")),
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


def test_malformed_chinese_numerals_are_none():
    assert cn_to_int("二三十") is None
    assert cn_to_int("十二三") is None


def test_malformed_chinese_house_number_does_not_raise():
    assert parse_address("高雄市三民區義華路二三十號").number is None


def test_house_number_bounds():
    assert parse_address("高雄市三民區義華路99999號").number == 99999
    assert parse_address("高雄市三民區義華路100000號").number is None
    assert parse_address("高雄市三民區義華路99999999999999號").number is None
    absurd_sub = parse_address("高雄市三民區義華路68-999999號")
    assert absurd_sub.number is None and absurd_sub.number_sub == 0


def test_huge_digit_runs_do_not_raise():
    assert parse_address("高雄市三民區義華路" + "1" * 5000 + "號").number is None
    assert parse_address("高雄市三民區義華路" + "一" * 5000 + "號").number is None
    # 巷超過欄寬，整段當成無法解析（只留區），不是把巷丟掉再拿號碼去比對沒有巷的門牌
    assert parse_address("高雄市三民區義華路" + "9" * 5000 + "巷1號") == P("三民區")


def test_chinese_numbers():
    assert [cn_number(n) for n in (1, 3, 10, 12, 20, 21)] == ["一", "三", "十", "十二", "二十", "二十一"]
    assert [cn_to_int(t) for t in ("三", "十", "十二", "二十", "六十八")] == [3, 10, 12, 20, 68]
    assert cn_to_int("博愛") is None
    assert cn_to_int("") is None


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("一", 1), ("九", 9), ("十", 10), ("十二", 12), ("二十", 20), ("二十一", 21), ("九十九", 99),
        ("一百", 100), ("一百零八", 108), ("一百〇八", 108), ("一百二十", 120), ("一百二十三", 123),
        ("一百十二", 112), ("兩百", 200), ("二百", 200), ("九百九十九", 999),
        ("一千", 1000), ("二千", 2000), ("三千零五", 3005), ("一千零二十", 1020), ("三千零五十", 3050),
        ("一千二百零五", 1205), ("一千二百三十四", 1234), ("九千九百九十九", 9999),
        # 沒有單位字（十百千）時是逐位數字
        ("一二", 12), ("一〇八", 108), ("零", 0), ("〇", 0),
    ],
)
def test_cn_to_int_values(text, expected):
    assert cn_to_int(text) == expected


@pytest.mark.parametrize(
    "text",
    [
        "", "百", "千", "百二", "十百", "百十", "一百一百", "二千一千", "二三十", "十二三", "二二十",
        "一百二",  # 「一百二」口語是 120、規範寫法是 102，有歧義就不猜
        "一千二", "二十零五", "一百零", "零一百", "一千零二百", "一百零十", "零百", "一百零零八x", "博愛", "二十號",
    ],
)
def test_cn_to_int_rejects_malformed_or_ambiguous(text):
    assert cn_to_int(text) is None


def test_normalize_text():
    assert normalize_text("臺北 １２３－４　號") == "台北123-4號"


@pytest.mark.parametrize(
    ("token", "expected"),
    [
        ("06", "6"), ("66", "66"), ("十二", "12"), ("博愛", "博愛"), ("光明10", "光明10"),
        ("一百零八", "108"), ("一百二十", "120"), ("000", "0"),
        ("甲" * MAX_UNIT_LENGTH, "甲" * MAX_UNIT_LENGTH),  # 剛好滿欄
        ("0" * 30 + "12", "12"),  # 去掉前導零才算長度
    ],
)
def test_unit_token(token, expected):
    assert unit_token(token) == expected


@pytest.mark.parametrize("token", ["甲" * (MAX_UNIT_LENGTH + 1), "1" * (MAX_UNIT_LENGTH + 1), "9" * 5000])
def test_unit_token_over_column_width_is_none(token):
    assert unit_token(token) is None


def test_unit_length_matches_doorplate_columns():
    from app.admissions.geo.models import GeoDoorplate

    assert MAX_UNIT_LENGTH == GeoDoorplate.__table__.c.lane.type.length == GeoDoorplate.__table__.c.alley.type.length


def test_kaohsiung_tables():
    assert len(TOWN_CODES) == 38 and len(DISTRICTS) == 38
    assert CODE_OF_DISTRICT["三民區"] == "6400500" and CODE_OF_DISTRICT["仁武區"] == "6401700"
    assert len(LEGACY_TOWNS) == 27
    assert set(LEGACY_TOWNS.values()) <= DISTRICTS
    assert LEGACY_TOWNS["三民鄉"] == "那瑪夏區"


def test_kaohsiung_box_contains_every_village_boundary():
    """外框是寬鬆的合理範圍，不能把任何一個里切掉：換版里界圖時這裡先紅。"""
    import json

    from app.admissions.geo.boundaries import BOUNDARY_PATH

    lats: list[float] = []
    lngs: list[float] = []

    def walk(coords):
        if isinstance(coords[0], (int, float)):
            lngs.append(coords[0])
            lats.append(coords[1])
        else:
            for item in coords:
                walk(item)

    for feature in json.loads(BOUNDARY_PATH.read_bytes())["features"]:
        walk(feature["geometry"]["coordinates"])
    assert KAOHSIUNG_LAT_RANGE[0] <= min(lats) and max(lats) <= KAOHSIUNG_LAT_RANGE[1]
    assert KAOHSIUNG_LNG_RANGE[0] <= min(lngs) and max(lngs) <= KAOHSIUNG_LNG_RANGE[1]


@pytest.mark.parametrize(
    ("lat", "lng", "expected"),
    [
        (22.6424556, 120.3437133, True),  # 義華
        (23.2, 120.9, True),  # 山區
        (0.0, 0.0, False), (22.6, 0.0, False), (0.0, 120.3, False),
        (120.3, 22.6, False),  # 經緯度對調
        (25.03, 121.56, False),  # 台北
        (float("nan"), 120.3, False), (22.6, float("inf"), False), (float("-inf"), float("nan"), False),
    ],
)
def test_in_kaohsiung(lat, lng, expected):
    assert in_kaohsiung(lat, lng) is expected


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("北美術館", "北美術館里"), ("南美術館", "南美術館里"), ("達卡努瓦", "達卡努瓦里"), ("鼎金里", "鼎金里"), (" 本揚里 ", "本揚里")],
)
def test_fix_village_name(raw, expected):
    assert fix_village_name(raw) == expected
