"""後台 CSV 下載共用：公式注入防護、檔名清理、BOM、附件回應（2026-10-03 匯出擴充抽出）。

給園方用 Excel 直接開：開頭加 BOM，Excel 才認得是 UTF-8，不然中文整份亂碼。
中文欄名、代碼對照與台北時間由各模組先轉好；csv_attachment 讓每個儲存格都過
safe_cell，呼叫端不用（也不會忘了）自己包。串流匯出（參觀案件）自己組 chunk，
只共用 safe_cell 與 filename_part。後台前端 admin/src/utils/csv.ts 的 safeCell
是同一條規則，改一邊另一邊一起改。"""

from __future__ import annotations

import csv
import io
import re
from collections.abc import Iterable, Sequence

from fastapi import HTTPException, Response, status

# UTF-8 BOM：Excel 靠它認得 CSV 是 UTF-8。用跳脫寫，不放實體字元（看不見，diff 與編輯器都容易吃掉）。
BOM = "\ufeff"

# 一次在記憶體組檔的下載上限：超過就請使用者縮小篩選範圍，不默默截斷
# （截斷的名單會被當成完整的）。呼叫端一律寫 csv_export.EXPORT_ROW_LIMIT，
# 執行時才讀模組屬性，測試才能 monkeypatch。
EXPORT_ROW_LIMIT = 10_000

_SAFE_FILENAME_PART = re.compile(r"[a-z0-9_-]{1,32}")
# 民國年月「115.09」：年 1–3 位、月 1–2 位。和 admin/src/utils/csv.ts 的 ROC_MONTH 同一條，
# 用 [0-9] 與 fullmatch（\d 會吃全形數字，$ 會放過結尾換行，JS 版都不會）。
_ROC_MONTH = re.compile(r"([0-9]{1,3})\.([0-9]{1,2})")


def safe_cell(value: object) -> str:
    """CSV 公式注入防護：儲存格開頭若是 = + - @ 這些會被試算表當成公式執行的
    字元，前面補一個單引號讓它變成純文字。"""
    text = "" if value is None else str(value)
    # 試算表會略過開頭的空白與控制字元（TAB、CR、LF…）再判斷是不是公式，
    # 所以要看去掉這些字元後的第一個字，不能只看 text[0]。
    # 控制字元本身開頭也一併視為危險，一律補單引號。
    if text and (
        text[0].isspace()
        or not text[0].isprintable()
        or text.lstrip()[:1] in ("=", "+", "-", "@")
    ):
        return "'" + text
    return text


def filename_part(value: str | None, fallback: str = "all") -> str:
    """檔名只放安全字元，篩選值不直接進 header。"""
    return value if value and _SAFE_FILENAME_PART.fullmatch(value) else fallback


def roc_month_csv(value: str | None) -> str:
    """民國月份「115.09」在 CSV 寫成「115年09月」：Excel 開 CSV 會把 115.10 當數字轉成 115.1，
    月份就錯了。只改匯出，畫面仍是「115.09」；不是「年.月」格式的（例如「未填寫」）原樣不動。
    和 admin/src/utils/csv.ts 的 rocMonthCsv 同一條規則，改一邊另一邊一起改。"""
    text = value or ""
    match = _ROC_MONTH.fullmatch(text)
    return f"{match[1]}年{match[2].zfill(2)}月" if match else text


def too_many_rows() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail={
            "code": "EXPORT_TOO_LARGE",
            "message": f"符合條件的資料超過 {EXPORT_ROW_LIMIT:,} 筆，請縮小篩選範圍再匯出。",
        },
    )


def csv_attachment(header: Sequence[object], rows: Iterable[Sequence[object]], filename: str) -> Response:
    """一律當附件下載，且不進瀏覽器快取：共用櫃台電腦上，含家長姓名與手機的 CSV
    不能留在磁碟快取或上一頁紀錄裡（稽核 admin-booking-api-no-store-missing）。"""
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow([safe_cell(cell) for cell in header])
    for row in rows:
        writer.writerow([safe_cell(cell) for cell in row])
    return Response(
        content=BOM + buffer.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "private, no-store",
        },
    )
