"""本機比對（2026-10-15 規格 §3.3–3.5）：清冊 → 去識別 JSON ＋ 命中報告。只讀資料庫（門牌、已發布校址）。
輸出只有班別、區、里、比對等級、原因、取整座標，依班別、區、里、座標排序（列序對不回清冊編號）；
沒有點的學生在報告裡只印到街路名。"""
from __future__ import annotations

import re
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions import academic
from app.admissions.enrolled.locate import PROBE_DISTRICT, canonical, locate_roster_address, rest_text
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
    """比對前提不成立（門牌沒匯入、本校沒座標）或某位比對失敗；訊息直接印給操作的人，不含地址。"""


@dataclass(frozen=True)
class UnplacedStudent:
    match_level: str
    unlocated_reason: str | None
    street: str  # masked_address() 的結果，切不出街路是 ""


@dataclass(frozen=True)
class MatchSummary:
    """命中報告的結構化內容：只有計數與遮罩後的街路名，沒有姓名、生日或完整地址。"""

    roster_date: date
    school_year: int
    doorplate_label: str
    total: int
    placed: int
    levels: dict[str, int]  # ENROLLED_LEVELS 順序，只放 > 0
    methods: dict[str, int]  # _METHOD_ORDER 順序，只放 > 0
    inferred: int
    grades: dict[str, int]  # ENROLLED_GRADES 順序，只放 > 0
    unplaced: tuple[UnplacedStudent, ...]  # 依 (match_level, unlocated_reason or "", street) 排序


@dataclass(frozen=True)
class MatchOutcome:
    payload: dict[str, Any]
    report: list[str]
    placed_ratio: float
    summary: MatchSummary


def round_coord(value: float) -> float:
    """取到小數 3 位（約 100 m），四捨五入；先轉字串再進 Decimal，避免二進位誤差。"""
    return float(Decimal(str(value)).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP))


def masked_address(raw: str) -> str:
    """報告用：只留純中文的街路名（巷、弄、號、樓、棟都不印）；外縣市、切不出街路、
    或「街路」其實是社區／大樓名（含數字、英文字母、樓棟號）都回空字串。"""
    raw = canonical(raw)
    parsed = parse_address(raw)
    if parsed is not None and parsed.district is None and not parsed.outside_kaohsiung:
        parsed = parse_address(f"{PROBE_DISTRICT}{rest_text(raw)}")
    if parsed is None or not parsed.street or _PLAIN_STREET.fullmatch(parsed.street) is None:
        return ""
    return f"{parsed.street}…"


def _ordered(counter: Counter, order: tuple[str, ...]) -> dict[str, int]:
    return {key: counter[key] for key in order if counter[key]}


def _joined(counts: dict[str, int]) -> str:
    return "、".join(f"{key} {count}" for key, count in counts.items())


def report_lines(summary: MatchSummary) -> list[str]:
    ratio = summary.placed / summary.total
    lines = [
        f"清冊 {summary.roster_date.isoformat()}・{summary.school_year} 學年・門牌 {summary.doorplate_label}・共 {summary.total} 位",
        f"有點 {summary.placed} 位（{ratio:.1%}）",
        f"比對等級：{_joined(summary.levels)}",
        f"補區方式：{_joined(summary.methods)}（推定 {summary.inferred} 位）",
        f"班別：{_joined(summary.grades)}",
    ]
    if summary.unplaced:
        unplaced_lines = [
            f"  {item.match_level}／{item.unlocated_reason or '-'}" + (f"　{item.street}" if item.street else "")
            for item in summary.unplaced
        ]
        lines += ["沒有點的學生（等級／原因　街路）：", *sorted(unplaced_lines)]
    return lines


async def match_students(
    db: AsyncSession, students: Sequence[tuple[str, str]], *, campus_key: str, roster_date: date
) -> MatchOutcome:
    """`students` 是（班別, 地址）；班別由呼叫端算好（清冊用 roster_grade，網頁在瀏覽器算），不在 ENROLLED_GRADES 就拒絕。"""
    if not students:
        raise MatchError("沒有學生資料")
    version = await matcher.active_doorplate_version(db)
    label = await matcher.doorplate_label(db)
    if version is None or label is None:
        raise MatchError("門牌資料尚未匯入，先跑 geo-sync --doorplates-file")
    campus = await matcher.campus_point(db, campus_key)
    if campus.lat is None or campus.lng is None:
        raise MatchError(f"本校沒有座標（{campus.locate_error}），無法比對")
    school_year = academic.current_term(roster_date)[0]

    points: list[dict[str, Any]] = []
    levels: Counter = Counter()
    methods: Counter = Counter()
    grades: Counter = Counter()
    unplaced: list[UnplacedStudent] = []
    for index, (grade, address) in enumerate(students, start=1):
        if grade not in ENROLLED_GRADES:
            raise MatchError(f"第 {index} 位的班別不對")
        try:
            result = await locate_roster_address(db, address, version=version, campus=campus)
        except Exception as error:
            # 原錯誤的訊息可能帶著 SQL 參數（含地址），所以只留位置與例外種類，也不串接原例外。
            raise MatchError(f"第 {index} 位比對失敗（{type(error).__name__}）") from None
        match = result.match
        placed = match.match_level in POINT_LEVELS and match.lat is not None and match.lng is not None
        points.append({
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
            unplaced.append(UnplacedStudent(match.match_level, match.unlocated_reason, masked_address(address)))

    points.sort(key=lambda item: (
        ENROLLED_GRADES.index(item["grade"]), item["district"] or "", item["village"] or "",
        item["lat"] if item["lat"] is not None else 0.0, item["lng"] if item["lng"] is not None else 0.0,
        item["match_level"], item["unlocated_reason"] or "",
    ))
    total = len(points)
    placed_count = sum(1 for item in points if item["lat"] is not None)
    summary = MatchSummary(
        roster_date=roster_date,
        school_year=school_year,
        doorplate_label=label,
        total=total,
        placed=placed_count,
        levels=_ordered(levels, ENROLLED_LEVELS),
        methods=_ordered(methods, _METHOD_ORDER),
        inferred=sum(methods[key] for key in _INFERRED),
        grades=_ordered(grades, ENROLLED_GRADES),
        unplaced=tuple(sorted(unplaced, key=lambda item: (item.match_level, item.unlocated_reason or "", item.street))),
    )
    payload = {
        "format": FORMAT,
        "campus_key": campus_key,
        "roster_date": roster_date.isoformat(),
        "school_year": school_year,
        "doorplate_version": label,
        "students": points,
    }
    return MatchOutcome(payload, report_lines(summary), placed_count / total, summary)


async def match_roster(db: AsyncSession, roster: Roster, *, campus_key: str, roster_date: date) -> MatchOutcome:
    school_year = academic.current_term(roster_date)[0]
    students = [(roster_grade(row.birthday, school_year), row.address) for row in roster.rows]
    return await match_students(db, students, campus_key=campus_key, roster_date=roster_date)
