"""民國月份與日期、學年學期、年級換算（規格 6.4）。

- 學期同園務 utils/academic.py：上學期 8/1～隔年 1/31，下學期 2/1～7/31。
- 年級同園務 ivy-frontend gradeForBirthday：學年 N 以西元 (N+1911)/9/1（含）為
  足歲基準，2 歲幼幼班、3 歲小班、4 歲中班、5 歲大班，其餘回 None。與官網
  web/app/utils/admission-classes.ts 的屆別規則等價（共用案例
  contracts/ivy-recruitment/grade-cases.json）。

這裡只收 date，不碰時區：呼叫端一律先用 app.common.timezones.today_local()
取台北日期，不能用 date.today() 或 UTC 日期。"""

from __future__ import annotations

import re
from datetime import date

ROC_MONTH_RE = re.compile(r"^(\d{3})\.(0[1-9]|1[0-2])$")

_GRADE_BY_AGE = {2: "幼幼班", 3: "小班", 4: "中班", 5: "大班"}


def roc_month(day: date) -> str:
    """date(2026, 9, 8) → "115.09"（recruitment_visits.month）。"""
    return f"{day.year - 1911}.{day.month:02d}"


def roc_date(day: date) -> str:
    """date(2026, 9, 8) → "115.09.08"（匯出給園務的 visit_date 字串）。"""
    return f"{day.year - 1911}.{day.month:02d}.{day.day:02d}"


def current_term(today: date) -> tuple[int, int]:
    """台北日期所在的（民國學年, 學期）。8/1–12/31 → (Y-1911, 1)；
    1/1–1/31 → (Y-1912, 1)；2/1–7/31 → (Y-1912, 2)。"""
    if today.month >= 8:
        return today.year - 1911, 1
    if today.month >= 2:
        return today.year - 1912, 2
    return today.year - 1912, 1


def term_bounds(school_year: int, semester: int) -> tuple[date, date]:
    """學期的第一天與最後一天（含）。"""
    base = school_year + 1911
    if semester == 1:
        return date(base, 8, 1), date(base + 1, 1, 31)
    if semester == 2:
        return date(base + 1, 2, 1), date(base + 1, 7, 31)
    raise ValueError(f"學期只能是 1 或 2：{semester}")


def grade_for_birthday(birthday: date, school_year: int) -> str | None:
    """依生日與入學學年換算適讀班級；不在幼幼班～大班範圍回 None（不強帶）。"""
    age = school_year + 1911 - birthday.year
    if birthday.month > 9 or (birthday.month == 9 and birthday.day > 1):
        age -= 1
    return _GRADE_BY_AGE.get(age)


def shift_roc_month(month: str, delta: int) -> str:
    """"115.01", -1 → "114.12"。格式不是「民國年.兩位數月」丟 ValueError。"""
    match = ROC_MONTH_RE.match(month)
    if match is None:
        raise ValueError(f"月份格式應為 民國年.月，如 115.03：{month}")
    total = int(match.group(1)) * 12 + int(match.group(2)) - 1 + delta
    return f"{total // 12}.{total % 12 + 1:02d}"
