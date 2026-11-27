"""缺額統計的純計算（2026-11-14 規格 §5、§6.3）。

不匯入 SQLAlchemy、不查資料庫：呼叫端（service）把每位幼生整理成 Facts 再交進來，
「今天」也由呼叫端用 app.common.timezones.today_local() 取好傳入。
回算只回算在籍與預繳狀態（state_on）；班級、年級、標記、下學年去向用現在的值。"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date
from typing import Literal

from app.admissions import academic
from app.admissions.constants import GRADES

GRADE_ORDER: tuple[str, ...] = ("大班", "中班", "小班", "幼幼班")  # 畫面與統計的欄位順序
assert set(GRADE_ORDER) == set(GRADES)

TierKey = Literal["base", "boost", "top"]


@dataclass(frozen=True)
class Facts:
    """一位幼生算統計要用到的事實。"""

    grade: str | None  # 排進班級的＝班級年級；沒編班的＝自己的年級
    status: str
    enrollment_date: date | None
    deposit_date: date | None
    left_date: date | None
    refunded_date: date | None
    target_school_year: int | None
    target_semester: int | None
    birthday: date | None
    underage_manual: bool
    is_new_manual: bool
    next_year: str


def underage_cutoff(school_year: int) -> date:
    """學年 Y 的不足齡界線：下一學年（Y+1）9/1 滿 3 歲＝生日在 (Y+1+1911-3)/9/1（含）以前。
    與 academic.grade_for_birthday 同一個 9/1（含）基準。"""
    return date(school_year + 1 + 1911 - 3, 9, 1)


def is_underage(f: Facts, school_year: int) -> bool:
    """只看生日與手動標記，不檢查年級（呼叫端只對學年內的幼幼班用）。
    有生日以生日為準，手動標記失效；沒生日看手動標記。"""
    if f.birthday is not None:
        return f.birthday > underage_cutoff(school_year)
    return f.underage_manual


def is_new(f: Facts, school_year: int) -> bool:
    """曾經是預繳進來的、入園日在本學年 8/1（含）之後的，或手動標記新生。"""
    return (
        f.deposit_date is not None
        or (f.enrollment_date is not None and f.enrollment_date >= date(school_year + 1911, 8, 1))
        or f.is_new_manual
    )


def state_on(f: Facts, day: date) -> Literal["enrolled", "pending"] | None:
    """這位幼生在 day 那天是在籍、預繳未入園，或都不算（規格 §6.3）。"""
    if f.status in ("enrolled", "left"):
        entered = f.enrollment_date is None or f.enrollment_date <= day
        still_here = f.left_date is None or f.left_date > day
        if entered and still_here:
            return "enrolled"
    if f.deposit_date is not None and f.deposit_date <= day:
        gone = (f.left_date is not None and f.left_date <= day) or (
            f.refunded_date is not None and f.refunded_date <= day
        )
        if not gone:
            return "pending"
    return None


def term_for_date(day: date) -> tuple[int, int]:
    """預定入園日 → （入學學年, 學期）。"""
    return academic.current_term(day)


def _zero() -> dict[str, int]:
    return {grade: 0 for grade in GRADE_ORDER}


@dataclass(frozen=True)
class Gap:
    enrolled: dict[str, int]
    pending_s1: dict[str, int]
    pending_s2: dict[str, int]
    estimate: dict[str, int]
    promoted: dict[str, int]
    leaving: dict[str, int]
    repeating: dict[str, int]
    pending_next: dict[str, int]
    estimate_next: dict[str, int]
    underage_enrolled: int
    underage_pending: int
    missing_birthday: int
    incomplete: int


def compute_gap(students: Iterable[Facts], *, school_year: int, as_of: date) -> Gap:
    enrolled, s1, s2, nxt = _zero(), _zero(), _zero(), _zero()
    leaving, repeating = _zero(), _zero()
    underage_enrolled = underage_pending = missing_birthday = incomplete = 0
    underage_total = 0

    for f in students:
        state = state_on(f, as_of)
        if state is None:
            continue
        if f.grade is None:
            incomplete += 1
            continue
        in_year = True  # 這位算進學年內的在籍或預繳（s1／s2）
        # 入學 (Y+1, 上) 的一定屬於下一學年（service 讓所屬學年跟著入學學年走），D 那天已在籍＝下學年
        # 開學前就提早進了下學年的班：對學年 Y 仍是下學年 8 月入園的新生，跟預繳一樣走下面算第 8 列。
        # 算成這一學年的在籍會被當舊生再升一次班；不算又會讓下學年預估少一人。
        next_intake = (f.target_school_year, f.target_semester) == (school_year + 1, 1)
        if state == "enrolled" and not next_intake:
            enrolled[f.grade] += 1
        else:
            if f.target_school_year is None or f.target_semester is None:
                incomplete += 1
                continue
            target = (f.target_school_year, f.target_semester)
            if target == (school_year, 1):
                s1[f.grade] += 1
            elif target == (school_year, 2):
                s2[f.grade] += 1
            elif target == (school_year + 1, 1):
                nxt[f.grade] += 1
                in_year = False
            else:
                continue
        if not in_year:
            continue

        underage = False
        if f.grade == "幼幼班":
            underage = is_underage(f, school_year)
            if f.birthday is None and not underage:
                missing_birthday += 1  # 手動標了不足齡的不算：他們不是「暫時算可以升小班」
            if underage:
                underage_total += 1
                if state == "enrolled":
                    underage_enrolled += 1
                else:
                    underage_pending += 1
        if f.next_year == "leave":
            column = {"中班": "大班", "小班": "中班", "幼幼班": "幼幼班" if underage else "小班"}.get(f.grade)
            if column is not None:
                leaving[column] += 1
        elif f.next_year == "repeat" and f.grade == "大班":
            repeating["大班"] += 1

    estimate = {g: enrolled[g] + s1[g] + s2[g] for g in GRADE_ORDER}
    promoted = {
        "大班": estimate["中班"],
        "中班": estimate["小班"],
        "小班": estimate["幼幼班"] - underage_total,
        "幼幼班": underage_total,
    }
    estimate_next = {g: promoted[g] - leaving[g] + repeating[g] + nxt[g] for g in GRADE_ORDER}
    return Gap(
        enrolled=enrolled,
        pending_s1=s1,
        pending_s2=s2,
        estimate=estimate,
        promoted=promoted,
        leaving=leaving,
        repeating=repeating,
        pending_next=nxt,
        estimate_next=estimate_next,
        underage_enrolled=underage_enrolled,
        underage_pending=underage_pending,
        missing_birthday=missing_birthday,
        incomplete=incomplete,
    )


def achievement(estimate: int, target: int | None) -> int | None:
    """達成率（四捨五入的整數百分比）；沒設定或目標 0 回 None。"""
    if not target:
        return None
    return int(estimate * 100 / target + 0.5)


def signed_gap(estimate: int, target: int | None) -> int | None:
    """預估－目標：負的是缺額，正的是超額；沒設定回 None。"""
    if target is None:
        return None
    return estimate - target


@dataclass(frozen=True)
class TierStatus:
    reached: TierKey | None
    next: TierKey | None
    short: int | None


def tier_status(total: int, base: int | None, boost: int | None, top: int | None) -> TierStatus:
    reached: TierKey | None = None
    for key, value in (("base", base), ("boost", boost), ("top", top)):
        if value is None:
            continue
        if total >= value:
            reached = key  # type: ignore[assignment]
        else:
            return TierStatus(reached, key, value - total)  # type: ignore[arg-type]
    return TierStatus(reached, None, None)
