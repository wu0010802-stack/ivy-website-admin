"""歷年註冊人數（2026-10-20 招生潛力與市佔率規格 docs/specs/2026-10-20-admissions-potential-share-design.md §3.1）。

一列＝校區 × 學年 × 學期 × 年級，存園方「歷年註冊表」每個年級的數字與表上的截止日；「總人數」列不存，由各年級加總。
只有數字，沒有學生姓名、備註或任何個資。約束字串與 migration 76c4bf84b907 逐字相同（tests/test_potential_schema.py 檢查）。"""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import CheckConstraint, Date, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.admissions.geo.models import _in
from app.db import Base

HISTORY_GRADES: tuple[str, ...] = ("大班", "中班", "小班", "幼幼班")


class CampusTermEnrollment(Base):
    """某校某學年某學期某年級的註冊數字（上學期 9/15、下學期 3/15 的表）。

    - registered：表上「日期欄」的註冊人數，市佔率的分子（上學期四個年級相加，不含重讀保留生）。
    - as_of：表上的截止日；imported_at：匯入時間。
    - 其餘可空整數對應表上的欄位：target＝目標人數；returning_*＝舊生在籍、預繳、註冊；new_*＝新生目標、參觀、預繳、註冊；
      repeat_*＝大班重讀生與保留生的預繳、註冊。早年的表沒有的欄位存 NULL，不當 0。
    同校整批取代。"""

    __tablename__ = "campus_term_enrollment"
    __table_args__ = (
        CheckConstraint(_in("grade", HISTORY_GRADES), name="ck_campus_term_enrollment_grade"),
        CheckConstraint("semester IN (1, 2)", name="ck_campus_term_enrollment_semester"),
    )

    campus_key: Mapped[str] = mapped_column(String(16), primary_key=True)
    school_year: Mapped[int] = mapped_column(Integer, primary_key=True)
    semester: Mapped[int] = mapped_column(Integer, primary_key=True)
    grade: Mapped[str] = mapped_column(String(4), primary_key=True)
    as_of: Mapped[date] = mapped_column(Date, nullable=False)
    registered: Mapped[int] = mapped_column(Integer, nullable=False)
    imported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    target: Mapped[int | None] = mapped_column(Integer, nullable=True)
    returning_enrolled: Mapped[int | None] = mapped_column(Integer, nullable=True)
    returning_deposit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    returning_registered: Mapped[int | None] = mapped_column(Integer, nullable=True)
    new_target: Mapped[int | None] = mapped_column(Integer, nullable=True)
    new_visits: Mapped[int | None] = mapped_column(Integer, nullable=True)
    new_deposits: Mapped[int | None] = mapped_column(Integer, nullable=True)
    new_registered: Mapped[int | None] = mapped_column(Integer, nullable=True)
    repeat_deposit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    repeat_registered: Mapped[int | None] = mapped_column(Integer, nullable=True)
