"""清冊地址 → 門牌比對（2026-10-15 規格 §3.2）。教保資訊網的通訊地址多半沒寫縣市區（「〇〇里〇鄰〇〇路…」
或直接從路名開始），parse_address 要地址先寫區；這裡先用里名或街路名在門牌表找出候選區，逐區比對再挑一個：
有點的候選（exact、nearby）優先；其中精確門牌只有在不比最近的候選遠超過 1 公里時才優先，否則取離本校較近的；
都沒座標時取本校所在區，最後依區名（結果才穩定）。清冊常見的異體字（徳→德）只在清冊比對裡轉成門牌表用字，
不動訪視共用的 normalize_text。"""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import distinct, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute

from app.admissions.geo.address import leading_village, normalize_text, parse_address, strip_county
from app.admissions.geo.matcher import CampusPoint, GeoMatch, locate_parsed
from app.admissions.geo.models import GeoDoorplate
from app.admissions.geo.projection import haversine_m

# 只用來從沒寫區的地址切出街路名：parse_address 要先看到區才會往下切，區名本身不影響街路。
PROBE_DISTRICT = "三民區"
_LEVEL_RANK = {"exact": 0, "nearby": 1, "street": 2, "district": 3, "pending": 4, "unlocated": 5}
# 精確門牌只有在不比最近的有點候選遠超過這個距離（公尺）時才優先：幼兒園學生多住在附近，
# 同名路遠處的精確門牌不如近處的鄰近門牌可信，但相差不大時精確門牌的位置更準。
EXACT_PREFERENCE_M = 1000
# 有點（exact、nearby）算同一層；其餘依原本的等級順序往後排。
_TIER = {"exact": 0, "nearby": 0, "street": 1, "district": 2, "pending": 3, "unlocated": 4}
# 清冊常見的異體字 → 門牌表用字（NFKC 不會轉）。只用在清冊比對，不動訪視共用的 normalize_text。
_VARIANTS = str.maketrans({"徳": "德"})


@dataclass(frozen=True)
class RosterMatch:
    match: GeoMatch
    # written｜village_unique｜village_nearest｜village_mismatch｜street_unique｜street_nearest｜none
    method: str


def _unlocated(reason: str) -> GeoMatch:
    return GeoMatch(None, None, "unlocated", reason, None, None)


def canonical(raw: str) -> str:
    """清冊地址先把異體字換成門牌表用字；比對與報告都要先過這一步，兩邊才一致。"""
    return raw.translate(_VARIANTS)


def rest_text(raw: str) -> str:
    """拿掉郵遞區號、國名與「高雄市」字首，剩下從里或街路開始的文字（已正規化、已換異體字）。"""
    return strip_county(normalize_text(canonical(raw)))[0]


def _distance(match: GeoMatch, campus: CampusPoint) -> float:
    if match.lat is None or match.lng is None or campus.lat is None or campus.lng is None:
        return float("inf")
    return haversine_m(campus.lat, campus.lng, match.lat, match.lng)


def _best(results: list[tuple[str, GeoMatch]], campus: CampusPoint) -> GeoMatch:
    """先挑最好的層級（有點的 exact／nearby > street > district > pending > unlocated），只在那一層裡選。
    有點那一層：先找出離本校最近的距離 d0，只留距離 ≤ d0 + EXACT_PREFERENCE_M 的候選——精確門牌只有在
    不比最近的候選遠超過 1 公里時才優先。留下的候選依（exact 先於 nearby、距離、本校所在區優先、區名）挑；
    其他層同一層的等級相同，所以等於依（距離、本校所在區優先、區名）挑。沒座標的距離算無限大。"""
    top = min(_TIER[match.match_level] for _, match in results)
    pool = [item for item in results if _TIER[item[1].match_level] == top]
    if top == 0:
        nearest = min(_distance(match, campus) for _, match in pool)
        pool = [item for item in pool if _distance(item[1], campus) <= nearest + EXACT_PREFERENCE_M]
    _, match = min(
        pool,
        key=lambda item: (
            _LEVEL_RANK[item[1].match_level], _distance(item[1], campus), item[0] != campus.district, item[0],
        ),
    )
    return match


async def _districts_with(db: AsyncSession, version: str, column: InstrumentedAttribute, value: str) -> list[str]:
    rows = await db.execute(
        select(distinct(GeoDoorplate.district)).where(GeoDoorplate.dataset_version == version, column == value)
    )
    return sorted(rows.scalars().all())


async def _try_districts(db: AsyncSession, districts: list[str], text: str, version: str) -> list[tuple[str, GeoMatch]]:
    results: list[tuple[str, GeoMatch]] = []
    for district in districts:
        parsed = parse_address(f"{district}{text}")
        if parsed is None or parsed.district is None:
            continue
        results.append((district, await locate_parsed(db, parsed, version=version)))
    return results


async def locate_roster_address(db: AsyncSession, raw: str, *, version: str, campus: CampusPoint) -> RosterMatch:
    raw = canonical(raw)
    parsed = parse_address(raw)
    if parsed is None:
        return RosterMatch(_unlocated("no_address"), "none")
    if parsed.outside_kaohsiung:
        return RosterMatch(_unlocated("outside_kaohsiung"), "written")
    if parsed.district is not None:
        return RosterMatch(await locate_parsed(db, parsed, version=version), "written")

    text = rest_text(raw)
    village = leading_village(text)
    if village is not None:
        name, rest = village
        districts = await _districts_with(db, version, GeoDoorplate.village, name)
        results = await _try_districts(db, districts, text, version)
        if results:
            consistent = [item for item in results if item[1].village == name]
            if consistent:
                return RosterMatch(_best(consistent, campus), "village_unique" if len(districts) == 1 else "village_nearest")
            return RosterMatch(_best(results, campus), "village_mismatch")
        # 門牌表沒有這個里名：拿掉里鄰，改用街路找。
        text = rest

    probe = parse_address(f"{PROBE_DISTRICT}{text}")
    street = probe.street if probe is not None else None
    if not street:
        return RosterMatch(_unlocated("no_doorplate"), "none")
    districts = await _districts_with(db, version, GeoDoorplate.street, street)
    results = await _try_districts(db, districts, text, version)
    if not results:
        return RosterMatch(_unlocated("no_doorplate"), "none")
    return RosterMatch(_best(results, campus), "street_unique" if len(districts) == 1 else "street_nearest")
