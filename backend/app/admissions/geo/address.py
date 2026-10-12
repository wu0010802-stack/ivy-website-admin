"""家長手填地址的正規化與解析（規格 §6.2）。純函式，不查資料庫。

解析結果的寫法對齊高雄市門牌坐標資料，matcher 直接拿來查表：
- 街路段：門牌表段號與路名序數都是中文（「建國路三段」「民族一路」），手寫的阿拉伯數字
  轉成中文；「臺」「台」一律用「台」（門牌表街名寫「台上路」「南台路」）。
- 巷、弄：數字轉成不帶前導零的阿拉伯數字字串（「６６巷」→"66"、「一百零八巷」→"108"）；
  門牌表也有具名巷（「博愛巷」「南二巷」），照原字保留（"博愛"）。巷弄超過門牌表欄寬
  （MAX_UNIT_LENGTH）就不可能比對到，整段當成無法解析，只留區。
- 號：主號與之號（阿拉伯或中文數字，「二十之一號」「六十八號之一」）；「號」之後的樓層全部丟掉。
沒有路／街／大道的地址（門牌表「地區」欄，例「右昌一巷」「合群新村」）整段當街路段。"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

from app.admissions.geo.kaohsiung import DISTRICTS, LEGACY_TOWNS, OTHER_COUNTIES


@dataclass(frozen=True)
class ParsedAddress:
    district: str | None
    street: str | None
    lane: str | None
    alley: str | None
    number: int | None
    number_sub: int
    outside_kaohsiung: bool


_CN_DIGITS = "〇一二三四五六七八九"
_CN_VALUE = {char: value for value, char in enumerate(_CN_DIGITS)} | {"零": 0, "兩": 2}
_CN_UNITS = {"十": 10, "百": 100, "千": 1000}
_CN_CHARS = "".join(_CN_VALUE) + "".join(_CN_UNITS)
_CN_NUMBER = f"[{_CN_CHARS}]+"
_ROAD = r"(?:大道|路|街)"
_DASHES = re.compile(r"[‐‑‒–—―ー\N{MINUS SIGN}]")
MAX_NUMBER = 99999
# 門牌表 geo_doorplates.lane／alley 的欄寬（tests/test_geo_address.py 核對）。
MAX_UNIT_LENGTH = 16
_POSTAL = re.compile(r"^[\[(]?\d{3}(?:\d{2,3})?[\])]?")
_DISTRICT = re.compile(
    "^(" + "|".join(sorted([*DISTRICTS, *LEGACY_TOWNS], key=len, reverse=True)) + ")"
)
_VILLAGE = re.compile(r"^([一-鿿]{1,4}[里村])(\d+鄰)?(.*)$")
_STARTS_WITH_ROAD = re.compile(r"^[一-鿿]{2,}?" + _ROAD)
# 號碼文字：阿拉伯或中文數字（含零、百、千，「一百零五號」整段才是 105；只吃一部分會變成別的門牌）。
# 「號」之後的之號不能緊接樓層字或數字，否則「號之十二樓」會退成「之十」。
_NUMBER = re.compile(
    rf"臨?(\d+|{_CN_NUMBER})(?:[-之](\d+|{_CN_NUMBER}))?號(?:之(\d+|{_CN_NUMBER})(?![樓Ff\d{_CN_CHARS}]))?"
)
_BARE_NUMBER = re.compile(r"(\d+)(?:-(\d+))?$")
_ROAD_ORDINAL = re.compile(r"(?<=[一-鿿])(\d{1,2})(?=" + _ROAD + ")")
_SECTION_DIGITS = re.compile("(" + _ROAD + r")(\d{1,2})段")
_STREET = re.compile(r"^(.*?" + _ROAD + r"(?:[一-鿿]{1,2}段)?)(.*)$")
_LANE_ALLEY = re.compile(r"^(?:(.+?)巷)?(?:(.+?)弄)?$")
_AREA = re.compile(r"^(.+?)(?:(\d+)巷)?(?:(\d+)弄)?$")


def cn_number(value: int) -> str:
    """1–99 的中文數字（10→十、21→二十一），用在路名序數與段號。"""
    if value < 10:
        return _CN_DIGITS[value]
    tens, ones = divmod(value, 10)
    return ("" if tens == 1 else _CN_DIGITS[tens]) + "十" + (_CN_DIGITS[ones] if ones else "")


def cn_to_int(text: str) -> int | None:
    """中文數字 → 整數（0–9999）；含其他字、寫法有歧義或不合規範回 None。

    - 沒有十、百、千：逐位數字（「一二」→12、「一〇八」→108）；
    - 有單位：「二十一」21、「一百零八」108、「一百二十」120、「三千零五」3005、「十二」12、
      「一百十二」112。單位要由大到小；零只能夾在百或千之後（「一百零八」「三千零五十」），
      零之後只能接個位數或「N十」；百、千前一定要有數字；「一百二」「一千二」口語是 120、1200，
      規範寫法是 102、1002，有歧義就不猜。"""
    if not text or any(char not in _CN_VALUE and char not in _CN_UNITS for char in text):
        return None
    if not any(char in _CN_UNITS for char in text):
        digits = "".join(str(_CN_VALUE[char]) for char in text)
        return int(digits) if len(digits) <= 18 else None
    total = 0
    digit: int | None = None  # 還沒配上單位的數字
    zero = False  # 剛遇到零，後面只能接個位數或「N十」
    last_unit = 10_000  # 單位要由大到小
    for char in text:
        unit = _CN_UNITS.get(char)
        if unit is None:
            value = _CN_VALUE[char]
            if value == 0:
                if digit is not None or last_unit not in (100, 1000):
                    return None
                zero = True
            elif digit is not None:
                return None
            else:
                digit = value
            continue
        if unit >= last_unit or (zero and unit != 10):
            return None
        if digit is None:
            if unit != 10 or zero:  # 只有「十」能省略前面的一
                return None
            digit = 1
        total += digit * unit
        digit, zero, last_unit = None, False, unit
    if digit is None:
        return None if zero else total
    return total + digit if last_unit == 10 or zero else None


def normalize_text(raw: str) -> str:
    """NFKC（全形轉半形）、去所有空白、各種破折號統一成 -、「臺」統一成「台」。"""
    text = unicodedata.normalize("NFKC", raw)
    text = re.sub(r"\s+", "", text)
    text = _DASHES.sub("-", text)
    return text.replace("臺", "台")


def unit_token(token: str) -> str | None:
    """巷、弄的編號：阿拉伯或中文數字 → 不帶前導零的數字字串（「一百零八」→"108"）；具名巷照原字。
    超過 MAX_UNIT_LENGTH 個字回 None（門牌表放不下，也不可能比對到）。"""
    if token.isdigit():
        result = token.lstrip("0") or "0"
    else:
        value = cn_to_int(token)
        result = str(value) if value is not None else token
    return result if len(result) <= MAX_UNIT_LENGTH else None


def _number_value(token: str) -> int | None:
    if token.isdigit():
        digits = token.lstrip("0") or "0"  # 「000068」是 68；先去零再判長度，也避免對超長數字串做 int()
        return int(digits) if len(digits) <= len(str(MAX_NUMBER)) else None
    return cn_to_int(token)


def bounded_number(token: str | None) -> int | None:
    """門牌號或之號：超過 99999 或無法解析都回 None（欄位是 int4，不能讓超大值進來）。"""
    if not token:
        return None
    value = _number_value(token)
    return value if value is not None and value <= MAX_NUMBER else None


def parse_address(raw: str | None) -> ParsedAddress | None:
    if raw is None:
        return None
    text = normalize_text(raw)
    if not text:
        return None
    text = _POSTAL.sub("", text)
    text = re.sub(r"^(?:中華民國)?(?:台灣省?)?", "", text)
    if text.startswith(("高雄市", "高雄縣")):
        text = text[3:]
    elif text.startswith("高雄"):
        text = text[2:]
    elif text.startswith(OTHER_COUNTIES):
        return ParsedAddress(None, None, None, None, None, 0, True)

    matched = _DISTRICT.match(text)
    if matched is None:
        return ParsedAddress(None, None, None, None, None, 0, False)
    district = LEGACY_TOWNS.get(matched.group(1), matched.group(1))
    text = text[matched.end():]

    # 使用者寫的里鄰不採信（里以門牌表為準），只是要拿掉。「五里路」「大里街」這種
    # 街名本身帶里字的不能誤刪：拿掉之後剩下的必須還是「兩個字以上＋路／街／大道」。
    village = _VILLAGE.match(text)
    if village and (village.group(2) or _STARTS_WITH_ROAD.match(village.group(3))):
        text = village.group(3)
    text = re.sub(r"^\d+鄰", "", text)

    number: int | None = None
    number_sub = 0
    head = text
    found = _NUMBER.search(text)
    if found:
        number = bounded_number(found.group(1))
        sub = found.group(2) or found.group(3)
        number_sub = bounded_number(sub) if sub else 0
        if number is None or number_sub is None:
            number, number_sub = None, 0
        head = text[: found.start()]
    else:
        bare = _BARE_NUMBER.search(text)
        if bare and re.search(_ROAD + r"$|巷$|弄$", text[: bare.start()]):
            number = bounded_number(bare.group(1))
            number_sub = bounded_number(bare.group(2)) if bare.group(2) else 0
            if number is None or number_sub is None:
                number, number_sub = None, 0
            head = text[: bare.start()]

    head = _ROAD_ORDINAL.sub(lambda m: cn_number(int(m.group(1))), head)
    head = _SECTION_DIGITS.sub(lambda m: m.group(1) + cn_number(int(m.group(2))) + "段", head)
    lane_text: str | None = None
    alley_text: str | None = None
    street_match = _STREET.match(head)
    if street_match and len(street_match.group(1)) >= 2:
        street = street_match.group(1)
        # 街名與號之間若夾了巷弄以外的字（「115、117號」「121.123號」這種多門牌），
        # 巷弄當作沒寫，號仍照用。
        units = _LANE_ALLEY.match(street_match.group(2))
        if units is not None:
            lane_text, alley_text = units.group(1), units.group(2)
    else:
        area = _AREA.match(head)
        if area is None:
            return ParsedAddress(district, None, None, None, number, number_sub, False)
        street = area.group(1)
        lane_text, alley_text = area.group(2), area.group(3)
    lane = unit_token(lane_text) if lane_text else None
    alley = unit_token(alley_text) if alley_text else None
    if (lane_text and lane is None) or (alley_text and alley is None):
        # 巷弄長到不可能是門牌表裡的巷弄：不能當成沒寫巷弄（會去比對同一條街上沒有巷弄的同號門牌，
        # 對到別戶），也沒有可信的街路，只留區。
        return ParsedAddress(district, None, None, None, None, 0, False)
    return ParsedAddress(district, street or None, lane, alley, number, number_sub, False)
