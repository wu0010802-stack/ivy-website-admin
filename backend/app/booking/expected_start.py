"""預約表單「預計入學時間」（2026-10-15 規格 docs/specs/2026-10-15-visit-expected-start-design.md）。

值是 asap（盡快）、unsure（還不確定），或「民國學年-學期」（例 115-2）；資料庫 CHECK
ck_visit_requests_expected_start 用同一個格式。學期規則沿用 admissions.academic.current_term
（8/1 起上學期、2/1 起下學期，1 月仍屬上學期）。官網選項由 web/app/utils/visit-form.ts 的
expectedStartOptions、後台顯示由 admin/src/api/labels.ts 的 expectedStartLabel 照同一規則產生，
三邊讀同一份案例 contracts/expected-start-cases.json。"""

from __future__ import annotations

import re
from datetime import date

from app.admissions import academic

ASAP = "asap"
UNSURE = "unsure"
# fullmatch ＋ [0-9]（計畫 W3-8）：match ＋ `$` 會放過結尾換行，`\d` 會放過全形數字。
TERM_RE = re.compile(r"(1[0-9]{2})-([12])")
# 官網列出「盡快」之後的幾個學期（規格 X2）。
PUBLIC_CHOICE_TERMS = 4
# 公開端接受今天所在學期到之後第 5 個學期（含）：比官網列的多一學期，跨學期還開著的舊頁面送得出去（規格 X7）。
PUBLIC_TERMS_AHEAD = 5

Term = tuple[int, int]


def parse(value: str) -> str | Term:
    """asap／unsure 原樣回傳，學期回 (學年, 學期)；格式不對丟 ValueError（Pydantic 轉成 422）。
    學年只收 100–199（規格 X8）。"""
    if value in (ASAP, UNSURE):
        return value
    match = TERM_RE.fullmatch(value)
    if match is None:
        raise ValueError("預計入學時間的格式不對")
    return int(match.group(1)), int(match.group(2))


def _index(term: Term) -> int:
    return term[0] * 2 + term[1] - 1


def _term(index: int) -> Term:
    return index // 2, index % 2 + 1


def format_term(term: Term) -> str:
    return f"{term[0]}-{term[1]}"


def term_start_month(term: Term) -> tuple[int, int]:
    """學期開學的西元年與月：上學期 9 月、下學期隔年 2 月。"""
    school_year, semester = term
    return (school_year + 1911, 9) if semester == 1 else (school_year + 1912, 2)


def _term_text(term: Term) -> str:
    return f"{term[0]} 學年{'上' if term[1] == 1 else '下'}學期"


def public_choices(today: date) -> list[dict[str, str]]:
    """官網表單的選項（順序即顯示順序）。today 是台北日期。"""
    current = _index(academic.current_term(today))
    choices = [{"value": ASAP, "label": "盡快（這學期）"}]
    for offset in range(1, PUBLIC_CHOICE_TERMS + 1):
        term = _term(current + offset)
        year, month = term_start_month(term)
        choices.append({"value": format_term(term), "label": f"{year} 年 {month} 月"})
    choices.append({"value": UNSURE, "label": "還不確定"})
    return choices


def validate_public(value: str, today: date) -> None:
    """官網送單與家長管理頁（計畫裁定 P4）：學期要在今天所在學期到之後第 PUBLIC_TERMS_AHEAD 個學期之間。"""
    parsed = parse(value)
    if isinstance(parsed, str):
        return
    current = _index(academic.current_term(today))
    if not current <= _index(parsed) <= current + PUBLIC_TERMS_AHEAD:
        raise ValueError("這個入學時間已過期，請重新選擇")


def display_label(value: str, submitted_on: date) -> str:
    """後台明細與 CSV 的文字（計畫裁定 P3）；submitted_on 是送單的台北日期，「盡快」換算當時的學期。"""
    if value == UNSURE:
        return "還不確定"
    if value == ASAP:
        return f"盡快（送單時是 {_term_text(academic.current_term(submitted_on))}）"
    parsed = parse(value)
    assert not isinstance(parsed, str)
    year, month = term_start_month(parsed)
    return f"{year} 年 {month} 月（{_term_text(parsed)}）"


def resolve_term(value: str | None, *, visit_date: date, today: date) -> Term:
    """到場建立招生訪視時的入學學期（規格 X4）：

    - 選了學期 → 那個學期；比參觀日所在學期還早（家長很晚才來）→ 參觀日所在學期。
    - 盡快 → 參觀日所在學期。
    - 沒填、還不確定、或認不得的值 → today 所在學期（改版前的做法）。認不得的值不丟例外
      （計畫裁定 P5）：建立訪視要在「標記已到場」同一個交易完成，資料庫 CHECK 已擋掉不合法的值。"""
    if value is None or value == UNSURE:
        return academic.current_term(today)
    try:
        parsed = parse(value)
    except ValueError:
        return academic.current_term(today)
    visit_term = academic.current_term(visit_date)
    if isinstance(parsed, str):  # asap
        return visit_term
    return parsed if _index(parsed) >= _index(visit_term) else visit_term
