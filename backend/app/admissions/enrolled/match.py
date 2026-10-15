"""本機比對（2026-10-15 規格 §3.3–3.5）：清冊 → 去識別 JSON ＋ 命中報告。只讀資料庫（門牌、已發布校址）。
輸出只有班別、區、里、比對等級、原因、取整座標，依班別、區、里、座標排序（列序對不回清冊編號）；
沒有點的學生在報告裡只印到街路名。"""
from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions import academic
from app.admissions.enrolled.locate import PROBE_DISTRICT, locate_roster_address, rest_text
from app.admissions.enrolled.models import ENROLLED_GRADES, ENROLLED_LEVELS, POINT_LEVELS
from app.admissions.enrolled.roster import Roster, roster_grade
from app.admissions.geo import matcher
from app.admissions.geo.address import parse_address

FORMAT = "ivy-enrolled-points/1"
MIN_PLACED_RATIO = 0.9
_METHOD_ORDER = ("written", "village_unique", "village_nearest", "village_mismatch", "street_unique", "street_nearest", "none")
_INFERRED = ("village_nearest", "village_mismatch", "street_nearest")
# 報告只印純中文的路／街／大道名（可接段）；沒有路名時 parse_address 會把整段社區、棟、樓當 street，不能印。
_PLAIN_STREET = re.compile(r"[\u4e00-\u9fff]+(?:大道|路|街)(?:[\u4e00-\u9fff]{1,2}段)?")


class MatchError(RuntimeError):
    """比對前提不成立（門牌沒匯入、本校沒座標）；訊息直接印給操作的人。"""


@dataclass(frozen=True)
class MatchOutcome:
    payload: dict[str, Any]
    report: list[str]
    placed_ratio: float


def round_coord(value: float) -> float:
    """取到小數 3 位（約 100 m），四捨五入；先轉字串再進 Decimal，避免二進位誤差。"""
    return float(Decimal(str(value)).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP))


def masked_address(raw: str) -> str:
    """報告用：只留純中文的街路名（巷、弄、號、樓、棟都不印）；外縣市、切不出街路、
    或「街路」其實是社區／大樓名（含數字、英文字母、樓棟號）都回空字串。"""
    parsed = parse_address(raw)
    if parsed is not None and parsed.district is None and not parsed.outside_kaohsiung:
        parsed = parse_address(f"{PROBE_DISTRICT}{rest_text(raw)}")
    if parsed is None or not parsed.street or _PLAIN_STREET.fullmatch(parsed.street) is None:
        return ""
    return f"{parsed.street}…"


def _joined(counter: Counter, order: tuple[str, ...]) -> str:
    return "、".join(f"{key} {counter[key]}" for key in order if counter[key])


async def match_roster(db: AsyncSession, roster: Roster, *, campus_key: str, roster_date: date) -> MatchOutcome:
    version = await matcher.active_doorplate_version(db)
    label = await matcher.doorplate_label(db)
    if version is None or label is None:
        raise MatchError("門牌資料尚未匯入，先跑 geo-sync --doorplates-file")
    campus = await matcher.campus_point(db, campus_key)
    if campus.lat is None or campus.lng is None:
        raise MatchError(f"本校沒有座標（{campus.locate_error}），無法比對")
    school_year = academic.current_term(roster_date)[0]

    students: list[dict[str, Any]] = []
    levels: Counter = Counter()
    methods: Counter = Counter()
    grades: Counter = Counter()
    unplaced_lines: list[str] = []
    for row in roster.rows:
        result = await locate_roster_address(db, row.address, version=version, campus=campus)
        match = result.match
        grade = roster_grade(row.birthday, school_year)
        placed = match.match_level in POINT_LEVELS and match.lat is not None and match.lng is not None
        students.append({
            "grade": grade,
            "district": match.district,
            "village": match.village,
            "match_level": match.match_level,
            "unlocated_reason": match.unlocated_reason,
            "lat": round_coord(match.lat) if placed else None,
            "lng": round_coord(match.lng) if placed else None,
        })
        levels[match.match_level] += 1
        methods[result.method] += 1
        grades[grade] += 1
        if not placed:
            street = masked_address(row.address)
            unplaced_lines.append(f"  {match.match_level}／{match.unlocated_reason or '-'}" + (f"　{street}" if street else ""))

    students.sort(key=lambda item: (
        ENROLLED_GRADES.index(item["grade"]), item["district"] or "", item["village"] or "",
        item["lat"] if item["lat"] is not None else 0.0, item["lng"] if item["lng"] is not None else 0.0,
        item["match_level"], item["unlocated_reason"] or "",
    ))
    total = len(students)
    placed_count = sum(1 for item in students if item["lat"] is not None)
    ratio = placed_count / total
    inferred = sum(methods[key] for key in _INFERRED)
    report = [
        f"清冊 {roster_date.isoformat()}・{school_year} 學年・門牌 {label}・共 {total} 位",
        f"有點 {placed_count} 位（{ratio:.1%}）",
        f"比對等級：{_joined(levels, ENROLLED_LEVELS)}",
        f"補區方式：{_joined(methods, _METHOD_ORDER)}（推定 {inferred} 位）",
        f"班別：{_joined(grades, ENROLLED_GRADES)}",
    ]
    if unplaced_lines:
        report += ["沒有點的學生（等級／原因　街路）：", *sorted(unplaced_lines)]
    payload = {
        "format": FORMAT,
        "campus_key": campus_key,
        "roster_date": roster_date.isoformat(),
        "school_year": school_year,
        "doorplate_version": label,
        "students": students,
    }
    return MatchOutcome(payload, report, ratio)
