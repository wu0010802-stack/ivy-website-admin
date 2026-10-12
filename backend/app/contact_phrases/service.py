"""聯絡片語（2026-10-12 規格 4.2）：全站一份，固定一列 key='default'。

資料庫裡沒有這一列時（測試會清空資料表、或被人手動刪掉）讀取回程式內建的預設
6 句、version 1；寫入時自己建立這一列。migration 插入的預設列用同一份文字，但
migration 把字面值寫死在自己檔案裡（不 import 應用程式，日後改這份常數不會悄悄
改到已經跑過的 migration），tests/test_contact_phrases.py 比對兩邊沒有漂移。"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.contact_phrases.models import ContactPhraseSet

KEY = "default"
DEFAULT_PHRASES: tuple[str, ...] = (
    "已致電，家長沒接",
    "已致電，轉語音信箱",
    "已加 LINE，等家長回覆",
    "家長考慮中，約好再聯絡",
    "家長已決定就讀",
    "家長暫不考慮",
)
DEFAULT_VERSION = 1


class PhrasesVersionConflict(Exception):
    """對應 API 錯誤碼 CONTACT_PHRASES_VERSION_CONFLICT：expected_version 與目前不符。"""

    def __init__(self, current_version: int) -> None:
        super().__init__(f"片語版本不符，目前是第 {current_version} 版")
        self.current_version = current_version


@dataclass(frozen=True)
class PhraseSetView:
    phrases: list[str]
    version: int
    updated_at: datetime | None
    updated_by_name: str | None


async def _editor_name(db: AsyncSession, row: ContactPhraseSet) -> str | None:
    if row.updated_by is None:
        return None
    editor = await db.get(User, row.updated_by)
    return (editor.display_name or editor.email) if editor else None


async def _view(db: AsyncSession, row: ContactPhraseSet) -> PhraseSetView:
    return PhraseSetView(
        phrases=list(row.phrases),
        version=row.version,
        updated_at=row.updated_at,
        updated_by_name=await _editor_name(db, row),
    )


async def read(db: AsyncSession) -> PhraseSetView:
    """目前的片語。讀取不寫庫：沒有這一列就回內建預設。"""
    row = (await db.execute(select(ContactPhraseSet).where(ContactPhraseSet.key == KEY))).scalar_one_or_none()
    if row is None:
        return PhraseSetView(
            phrases=list(DEFAULT_PHRASES), version=DEFAULT_VERSION, updated_at=None, updated_by_name=None
        )
    return await _view(db, row)


async def _locked_row(db: AsyncSession) -> ContactPhraseSet:
    """鎖住這一列再回傳；還沒有就先建預設列。兩個請求同時建立時，後到的一方撞主鍵，
    ON CONFLICT 讓它安靜地改去鎖同一列，之後的版本比對就是排隊後的結果。"""
    stmt = (
        select(ContactPhraseSet)
        .where(ContactPhraseSet.key == KEY)
        .with_for_update()
        # 同一個 session 先前讀過時，鎖列後要用資料庫的最新值蓋掉記憶體裡的舊值。
        .execution_options(populate_existing=True)
    )
    row = (await db.execute(stmt)).scalar_one_or_none()
    if row is None:
        await db.execute(
            insert(ContactPhraseSet)
            .values(key=KEY, phrases=list(DEFAULT_PHRASES), version=DEFAULT_VERSION)
            .on_conflict_do_nothing(index_elements=[ContactPhraseSet.key])
        )
        row = (await db.execute(stmt)).scalar_one()
    return row


async def replace(
    db: AsyncSession, phrases: list[str], *, expected_version: int, updated_by
) -> PhraseSetView:
    """整組換掉。呼叫端負責 commit（要在同一個交易寫稽核）；版本不符丟
    PhrasesVersionConflict，呼叫端要 rollback。"""
    row = await _locked_row(db)
    if row.version != expected_version:
        raise PhrasesVersionConflict(row.version)
    row.phrases = list(phrases)
    row.version += 1
    row.updated_at = datetime.now(timezone.utc)
    row.updated_by = updated_by
    await db.flush()
    return await _view(db, row)
