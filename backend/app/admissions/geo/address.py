"""家長手填地址的正規化與解析（規格 §6.2）。純函式，不查資料庫。

解析結果的寫法對齊高雄市門牌坐標資料，matcher 直接拿來查表：
- 街路段：門牌表段號與路名序數都是中文（「建國路三段」「民族一路」），手寫的阿拉伯數字
  轉成中文；「臺」「台」一律用「台」（門牌表街名寫「台上路」「南台路」）。
- 巷、弄：數字轉成不帶前導零的阿拉伯數字字串（「６６巷」→"66"）；門牌表也有具名巷
  （「博愛巷」「南二巷」），照原字保留（"博愛"）。
- 號：主號與之號；「號」之後的樓層全部丟掉。
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
_ROAD = r"(?:大道|路|街)"
_DASHES = re.compile(r"[‐‑‒–—―ー−]")
_MAX_NUMBER = 99999
_POSTAL = re.compile(r"^[\[(]?\d{3}(?:\d{2,3})?[\])]?")
_DISTRICT = re.compile(
    "^(" + "|".join(sorted([*DISTRICTS, *LEGACY_TOWNS], key=len, reverse=True)) + ")"
)
_VILLAGE = re.compile(r"^([一-鿿]{1,4}[里村])(\d+鄰)?(.*)$")
_STARTS_WITH_ROAD = re.compile(r"^[一-鿿]{2,}?" + _ROAD)
_NUMBER = re.compile(r"臨?(\d+|[〇一二三四五六七八九十]+)(?:[-之](\d+))?號(?:之(\d+)(?![樓Ff\d]))?")
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
    """「十二」「二十」「三」「一二」→ 整數；含其他字回 None。"""
    if not text or any(char not in _CN_VALUE and char != "十" for char in text):
        return None
    if "十" not in text:
        digits = "".join(str(_CN_VALUE[char]) for char in text)
        return int(digits) if len(digits) <= 18 else None
    tens, _, ones = text.partition("十")
    if len(tens) > 1 or len(ones) > 1 or "十" in ones:
        return None
    return (_CN_VALUE[tens] if tens else 1) * 10 + (_CN_VALUE[ones] if ones else 0)


def normalize_text(raw: str) -> str:
    """NFKC（全形轉半形）、去所有空白、各種破折號統一成 -、「臺」統一成「台」。"""
    text = unicodedata.normalize("NFKC", raw)
    text = re.sub(r"\s+", "", text)
    text = _DASHES.sub("-", text)
    return text.replace("臺", "台")


def unit_token(token: str) -> str:
    """巷、弄的編號：阿拉伯或純中文數字 → 不帶前導零的數字字串；具名巷照原字。"""
    if token.isdigit():
        return token.lstrip("0") or "0"
    value = cn_to_int(token)
    return str(value) if value is not None else token


def _number_value(token: str) -> int | None:
    if len(token) > 5:
        return None
    return int(token) if token.isdigit() else cn_to_int(token)


def _bounded(token: str | None) -> int | None:
    """門牌號或之號：超過 99999 或無法解析都回 None（欄位是 int4，不能讓超大值進來）。"""
    if not token:
        return None
    value = _number_value(token)
    return value if value is not None and value <= _MAX_NUMBER else None


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
        number = _bounded(found.group(1))
        sub = found.group(2) or found.group(3)
        number_sub = _bounded(sub) if sub else 0
        if number is None or number_sub is None:
            number, number_sub = None, 0
        head = text[: found.start()]
    else:
        bare = _BARE_NUMBER.search(text)
        if bare and re.search(_ROAD + r"$|巷$|弄$", text[: bare.start()]):
            number = _bounded(bare.group(1))
            number_sub = _bounded(bare.group(2)) if bare.group(2) else 0
            if number is None or number_sub is None:
                number, number_sub = None, 0
            head = text[: bare.start()]

    head = _ROAD_ORDINAL.sub(lambda m: cn_number(int(m.group(1))), head)
    head = _SECTION_DIGITS.sub(lambda m: m.group(1) + cn_number(int(m.group(2))) + "段", head)
    lane: str | None = None
    alley: str | None = None
    street_match = _STREET.match(head)
    if street_match and len(street_match.group(1)) >= 2:
        street = street_match.group(1)
        # 街名與號之間若夾了巷弄以外的字（「115、117號」「121.123號」這種多門牌），
        # 巷弄當作沒寫，號仍照用。
        units = _LANE_ALLEY.match(street_match.group(2))
        if units is not None:
            lane = unit_token(units.group(1)) if units.group(1) else None
            alley = unit_token(units.group(2)) if units.group(2) else None
    else:
        area = _AREA.match(head)
        if area is None:
            return ParsedAddress(district, None, None, None, number, number_sub, False)
        street = area.group(1)
        lane = unit_token(area.group(2)) if area.group(2) else None
        alley = unit_token(area.group(3)) if area.group(3) else None
    return ParsedAddress(district, street or None, lane, alley, number, number_sub, False)
