"""幼兒園裁罰明細（kiang 整理的全國教保資訊網裁罰；docs/specs/2026-10-20-peer-penalties-evaluations-design.md §2、C1–C4）。

這裡只管解析、與園所比對、寫入與 CSV 往返；下載、排程與換版門檻在 sync.py。

來源（高雄 238 檔、571 筆，2018-10 起）：
- 檔名清單：GitHub API `contents/docs/data/punish/高雄市`（Pages 沒有目錄清單）；一次請求就夠。
- 每檔 `https://kiang.github.io/ap.ece.moe.edu.tw/data/punish/高雄市/<園所名稱>.json`，是陣列的陣列：
  [0] 日期 YYYY/MM/DD、[1] 裁處文號、[2] 法條（含修正日）、[3] 違規條文＋事由（有時只有條號）、
  **[4] `負責人：姓名`／`行為人：姓名`（個資）**、[5] 處分（`罰鍰：N元`／`停止招生：起~迄`／`減少招收人數：起~迄`／`停辦：起~迄`）、
  [6] 選填的裁處當時園所全名。

**姓名不進任何資料結構**：[4] 只取冒號前面的標籤轉成對象類別（operator＝負責人、staff＝行為人），標籤之後的字從不讀進 PenaltyRow；
其他會存的文字欄位（文號、法條、違規內容、其他處分、園所名稱）再保險一次，從「負責人」「行為人」起的字一律截掉——
真檔裡有一筆的裁處文號是「高市教幼字第負責人＋姓名＋號」（來源欄位錯置，沒有冒號），所以文號、法條、其他處分、園所名稱不要求冒號；
違規內容可能正常提到「負責人」這個詞，只截「負責人：…」或結尾接 2–4 個字的樣子。
`punish_all.json`（以人名為鍵）不讀（2026-10-08 規格已排除）。"""

from __future__ import annotations

import csv
import hashlib
import io
import re
from dataclasses import dataclass
from datetime import date, datetime
from urllib.parse import quote

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions.geo.models import PENALTY_KINDS, PENALTY_SUBJECTS, GeoKindergarten, GeoKindergartenPenalty

CITY = "高雄市"
LISTING_URL = f"https://api.github.com/repos/kiang/ap.ece.moe.edu.tw/contents/docs/data/punish/{quote(CITY)}"
FILE_ROOT = f"https://kiang.github.io/ap.ece.moe.edu.tw/data/punish/{quote(CITY)}"
SOURCE_NOTE = "資料來源：全國教保資訊網（kiang 整理）"
INT4_MAX = 2_147_483_647
# 文字欄位上限，以資料表欄寬為準（規格 C1：違規內容最多 300 字）。
_WIDTHS = {
    name: GeoKindergartenPenalty.__table__.c[name].type.length
    for name in ("school_name", "doc_no", "law", "content", "punishment_text")
}
_DATE = re.compile(r"^\s*([0-9]{4})/([0-9]{1,2})/([0-9]{1,2})\s*$")
_SPACES = re.compile(r"\s+")
# 負責人／行為人標籤：只取標籤，姓名在標籤後面，不讀。
_SUBJECT_LABEL = re.compile(r"^\s*(負責人|行為人)\s*[：:]")
_SUBJECT_BY_LABEL = {"負責人": "operator", "行為人": "staff"}
# 其他文字欄位的再保險：標籤後面的字（姓名）一律截掉。識別用的短欄位（文號、法條、其他處分、園所名稱）從標籤起整段截掉，
# 不要求冒號；違規內容只截有冒號的，或標籤緊接 2–4 個字就結束的（「…負責人王小明」）。
_PERSON_MARK_STRICT = re.compile(r"(?:負責人|行為人).*$")
_PERSON_MARK = re.compile(r"(?:負責人|行為人)\s*(?:[：:].*|[\u4e00-\u9fff]{2,4})$")
_PUNISHMENT = re.compile(r"^\s*(罰鍰|停止招生|減少招收人數|停辦)\s*[：:]\s*(.*?)\s*$")
_KIND_BY_LABEL = {"罰鍰": "fine", "停止招生": "stop_enrollment", "減少招收人數": "reduce_enrollment", "停辦": "closure"}
_AMOUNT = re.compile(r"^([0-9][0-9,]*)\s*元")
_PERIOD = re.compile(r"^([0-9]{4}/[0-9]{1,2}/[0-9]{1,2})\s*[~～－—-]\s*([0-9]{4}/[0-9]{1,2}/[0-9]{1,2})")
CSV_COLUMNS = (
    "school_name", "alt_name", "occurred_on", "doc_no", "law", "content", "kind", "amount",
    "period_start", "period_end", "punishment_text", "subject", "punishment_hash",
)


class PenaltyFormatError(ValueError):
    """裁罰檔名清單、裁罰檔或打包的 CSV 不是預期的格式；訊息會寫進 geo_dataset_status.last_error，不含檔案內容。"""


@dataclass(frozen=True)
class PenaltyRow:
    """一筆處分。沒有姓名欄位：對象只有類別（operator／staff）。alt_name 是來源 [6] 的園所全名，只用來比對園所，不寫進資料庫。"""

    school_name: str
    alt_name: str | None
    occurred_on: date
    doc_no: str
    law: str
    content: str
    kind: str
    amount: int | None
    period_start: date | None
    period_end: date | None
    punishment_text: str | None
    subject: str | None
    punishment_hash: str


@dataclass
class PenaltyFile:
    """一個裁罰檔的解析結果。skipped 是欄位不夠、日期壞掉而略過的筆數。"""

    rows: list[PenaltyRow]
    skipped: int = 0


def punish_url(name: str) -> str:
    """園名整段編碼（括號、斜線以外的符號都要編）。"""
    return f"{FILE_ROOT}/{quote(name, safe='')}.json"


def listing_names(data: object) -> list[str]:
    """GitHub API 的目錄回應 → 裁罰檔的園所名稱（去掉 .json），依名稱排序、去重。只收 type 是 file 的 .json。"""
    if not isinstance(data, list):
        raise PenaltyFormatError("裁罰檔名清單不是預期的格式")
    names: set[str] = set()
    for entry in data:
        if not isinstance(entry, dict) or entry.get("type") != "file":
            continue
        name = entry.get("name")
        if isinstance(name, str) and name.endswith(".json") and name[: -len(".json")].strip():
            names.add(name[: -len(".json")])
    return sorted(names)


def _clean(value: object, width: int, *, strict: bool = True) -> str:
    """文字欄位：空白收成一個、去頭尾、截掉人名標籤之後的字、截到欄寬。strict（預設）從標籤起整段截掉；
    違規內容傳 strict=False，只截有冒號的或標籤緊接 2–4 個字結尾的（正常內容可能提到「負責人」這個詞）。"""
    text = _SPACES.sub(" ", str(value if value is not None else "")).strip()
    return (_PERSON_MARK_STRICT if strict else _PERSON_MARK).sub("", text).strip()[:width]


def _to_date(value: object) -> date | None:
    matched = _DATE.fullmatch(str(value if value is not None else ""))
    if matched is None:
        return None
    try:
        return date(int(matched.group(1)), int(matched.group(2)), int(matched.group(3)))
    except ValueError:
        return None


def subject_of(value: object) -> str | None:
    """來源 [4]「負責人：姓名」→ operator、「行為人：姓名」→ staff；其他（沒有標籤）→ None。只看標籤，姓名不讀。"""
    matched = _SUBJECT_LABEL.match(str(value if value is not None else ""))
    return _SUBJECT_BY_LABEL[matched.group(1)] if matched else None


def punishment_hash(text: str) -> str:
    """處分原文（空白收成一個）的雜湊，唯一鍵用：同一件有幾筆處分時分得開。"""
    return hashlib.sha1(_SPACES.sub(" ", text).strip().encode("utf-8")).hexdigest()[:16]


def parse_punishment(
    text: object,
) -> tuple[str, int | None, date | None, date | None, str | None]:
    """來源 [5] → (種類, 金額, 期間起, 期間迄, 其他處分原文)。罰鍰只收金額；三種期間處分只收起迄日；
    格式對不上的歸 other 並保留原文（截到欄寬）。期間的迄日早於起日當作壞資料，兩個日期都不收。"""
    raw = str(text if text is not None else "")
    matched = _PUNISHMENT.match(raw)
    if matched is not None:
        kind, rest = _KIND_BY_LABEL[matched.group(1)], matched.group(2)
        if kind == "fine":
            amount = _AMOUNT.match(rest)
            if amount is not None:
                number = int(amount.group(1).replace(",", ""))
                if number <= INT4_MAX:
                    return kind, number, None, None, None
        else:
            period = _PERIOD.match(rest)
            if period is not None:
                start, end = _to_date(period.group(1)), _to_date(period.group(2))
                if start is not None and end is not None and start <= end:
                    return kind, None, start, end, None
    return "other", None, None, None, _clean(raw, _WIDTHS["punishment_text"]) or None


def parse_penalty_file(data: object, school_name: str) -> PenaltyFile:
    """一個裁罰檔（陣列的陣列）→ PenaltyFile。school_name 是檔名去掉 .json。不是陣列丟 PenaltyFormatError；
    單筆欄位不夠（少於 6 欄）、日期壞掉略過並計入 skipped。"""
    name = _clean(school_name, _WIDTHS["school_name"] + 1)
    if not name or len(name) > _WIDTHS["school_name"]:
        raise PenaltyFormatError("裁罰檔的園所名稱不合格")
    if not isinstance(data, list):
        raise PenaltyFormatError("裁罰檔不是預期的格式")
    result = PenaltyFile(rows=[])
    for record in data:
        if not isinstance(record, list) or len(record) < 6:
            result.skipped += 1
            continue
        occurred_on = _to_date(record[0])
        if occurred_on is None:
            result.skipped += 1
            continue
        kind, amount, start, end, other = parse_punishment(record[5])
        alt = _clean(record[6], _WIDTHS["school_name"]) if len(record) > 6 else ""
        result.rows.append(
            PenaltyRow(
                school_name=name,
                alt_name=alt or None,
                occurred_on=occurred_on,
                doc_no=_clean(record[1], _WIDTHS["doc_no"]),
                law=_clean(record[2], _WIDTHS["law"]),
                content=_clean(record[3], _WIDTHS["content"], strict=False),
                kind=kind,
                amount=amount,
                period_start=start,
                period_end=end,
                punishment_text=other,
                subject=subject_of(record[4]),
                punishment_hash=punishment_hash(str(record[5] if record[5] is not None else "")),
            )
        )
    return result


# ---- CSV 往返（本機打包用，規格 C10）----


def rows_to_csv(rows: list[PenaltyRow]) -> str:
    """寫成我們自己的 CSV（打包退路用）：欄位只有 CSV_COLUMNS，**沒有人名欄**。"""
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(CSV_COLUMNS)
    for row in rows:
        writer.writerow(
            [
                row.school_name, row.alt_name or "", row.occurred_on.isoformat(), row.doc_no, row.law, row.content,
                row.kind, "" if row.amount is None else row.amount,
                row.period_start.isoformat() if row.period_start else "",
                row.period_end.isoformat() if row.period_end else "",
                row.punishment_text or "", row.subject or "", row.punishment_hash,
            ]
        )
    return buffer.getvalue()


def _iso_date(value: str | None) -> date | None:
    text = (value or "").strip()
    if not text:
        return None
    try:
        return date.fromisoformat(text)
    except ValueError as exc:
        raise PenaltyFormatError("裁罰檔的日期格式不對") from exc


def parse_csv(text: str) -> list[PenaltyRow]:
    """rows_to_csv 的反向（呼叫端已用 utf-8-sig 解碼）。缺欄位、種類或對象類別不是約定的值、日期壞掉都丟 PenaltyFormatError；
    文字欄位照樣過 _clean（手改過的檔案也不會帶進人名標籤之後的字）。"""
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames or not set(CSV_COLUMNS) <= set(reader.fieldnames):
        raise PenaltyFormatError("裁罰檔不是預期的格式")
    rows: list[PenaltyRow] = []
    for record in reader:
        kind, subject = (record.get("kind") or "").strip(), (record.get("subject") or "").strip() or None
        occurred_on = _iso_date(record.get("occurred_on"))
        name = _clean(record.get("school_name"), _WIDTHS["school_name"])
        if occurred_on is None or not name or kind not in PENALTY_KINDS or (subject is not None and subject not in PENALTY_SUBJECTS):
            raise PenaltyFormatError("裁罰檔的內容不對")
        amount_text = (record.get("amount") or "").strip()
        if amount_text and not amount_text.isdigit():
            raise PenaltyFormatError("裁罰檔的金額不對")
        rows.append(
            PenaltyRow(
                school_name=name,
                alt_name=_clean(record.get("alt_name"), _WIDTHS["school_name"]) or None,
                occurred_on=occurred_on,
                doc_no=_clean(record.get("doc_no"), _WIDTHS["doc_no"]),
                law=_clean(record.get("law"), _WIDTHS["law"]),
                content=_clean(record.get("content"), _WIDTHS["content"], strict=False),
                kind=kind,
                amount=int(amount_text) if amount_text and int(amount_text) <= INT4_MAX else None,
                period_start=_iso_date(record.get("period_start")),
                period_end=_iso_date(record.get("period_end")),
                punishment_text=_clean(record.get("punishment_text"), _WIDTHS["punishment_text"]) or None,
                subject=subject,
                punishment_hash=_clean(record.get("punishment_hash"), 16) or punishment_hash(""),
            )
        )
    return rows


# ---- 比對園所與寫入 ----


async def resolve_source_ids(db: AsyncSession, rows: list[PenaltyRow]) -> dict[str, str | None]:
    """園所名稱 → source_id（規格 C2）：檔名與 geo_kindergartens.name 精確比對；對不到再用來源 [6] 的園所全名；
    營業中的優先，其次 source_id 小的。對不到是 None（已停辦或改名，列照樣存）。以 school_name 為鍵：同一個檔的各筆
    共用一個結果（來源 [6] 的全名在同一檔裡通常相同，有不同時取第一個對得到的）。"""
    names = {row.school_name for row in rows} | {row.alt_name for row in rows if row.alt_name}
    found: dict[str, list[tuple[bool, str]]] = {}
    if names:
        for start in range(0, len(names), 500):
            chunk = list(names)[start : start + 500]
            result = await db.execute(
                select(GeoKindergarten.name, GeoKindergarten.source_id, GeoKindergarten.is_active).where(
                    GeoKindergarten.name.in_(chunk)
                )
            )
            for name, source_id, active in result.all():
                found.setdefault(name, []).append((not active, source_id))

    def pick(name: str | None) -> str | None:
        options = found.get(name or "")
        return min(options)[1] if options else None

    resolved: dict[str, str | None] = {}
    for row in rows:
        if row.school_name in resolved and resolved[row.school_name] is not None:
            continue
        resolved[row.school_name] = pick(row.school_name) or pick(row.alt_name)
    return resolved


INSERT_CHUNK = 1000  # 一列 14 個參數；asyncpg 單一語句上限 32,767 個


async def replace_penalties(
    db: AsyncSession, rows: list[PenaltyRow], *, keep_names: set[str] | frozenset[str] = frozenset(), now: datetime
) -> int:
    """換上新資料（不 commit）：刪掉表裡 school_name 不在 keep_names 的列（這一輪沒抓成功的檔保留舊列），再寫入 rows。
    唯一鍵（園所名稱、日期、文號、法條、處分雜湊）重複的只留第一筆。回傳寫入的列數。"""
    fresh = [row for row in rows if row.school_name not in keep_names]
    resolved = await resolve_source_ids(db, fresh)
    stmt = delete(GeoKindergartenPenalty)
    if keep_names:
        stmt = stmt.where(GeoKindergartenPenalty.school_name.not_in(keep_names))
    await db.execute(stmt)
    seen: set[tuple] = set()
    values = []
    for row in fresh:
        key = (row.school_name, row.occurred_on, row.doc_no, row.law, row.punishment_hash)
        if key in seen:
            continue
        seen.add(key)
        values.append(
            {
                "source_id": resolved.get(row.school_name), "school_name": row.school_name, "occurred_on": row.occurred_on,
                "doc_no": row.doc_no, "law": row.law, "content": row.content, "kind": row.kind, "amount": row.amount,
                "period_start": row.period_start, "period_end": row.period_end, "punishment_text": row.punishment_text,
                "subject": row.subject, "punishment_hash": row.punishment_hash, "synced_at": now,
            }
        )
    for start in range(0, len(values), INSERT_CHUNK):
        await db.execute(pg_insert(GeoKindergartenPenalty).values(values[start : start + INSERT_CHUNK]).on_conflict_do_nothing())
    return len(values)
