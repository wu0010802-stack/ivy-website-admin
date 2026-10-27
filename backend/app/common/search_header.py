"""後台的搜尋字改走 header，不放網址（2026-10-22 資安稽核）。

案件與招生訪視的搜尋字常是家長電話、孩子或介紹人的姓名。網址上的查詢字串會被
後端的存取紀錄去掉（logging_config.StripQueryString），但瀏覽器先打的是官網
web 服務，Railway 那一層的 HTTP 紀錄在程式碼管不到的地方，可能連查詢字串一起留著。
header 不進那份紀錄。

後台送 `X-Ivy-Search: <encodeURIComponent(JSON.stringify({q, referrer, …}))>`；
header 只能放 Latin-1，中文要先百分比編碼。header 的值優先於同名的查詢參數，
查詢參數照收（部署當下還開著舊版後台的人、測試與 CLI）。"""

from __future__ import annotations

import json
import re
from urllib.parse import unquote

from fastapi import HTTPException, status

SEARCH_HEADER = "X-Ivy-Search"
SEARCH_HEADER_DESCRIPTION = "搜尋字（JSON 物件、百分比編碼），優先於同名的查詢參數；後台用它把個資移出網址"
# 同 booking.schemas 的控制字元：%00 之類一路送到 PostgreSQL 會被拒收成 500，在這裡就回 422。
_CONTROL_CHARS_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def _invalid() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail={"code": "INVALID_SEARCH_HEADER", "message": "搜尋條件格式不正確"},
    )


def search_fields(raw: str | None, allowed: dict[str, int]) -> dict[str, str]:
    """解開 X-Ivy-Search。allowed 是這支端點收的鍵與長度上限；多帶別的鍵、型別或長度不對回 422。
    值為 null 或空字串的鍵當作沒帶。"""
    if not raw:
        return {}
    try:
        data = json.loads(unquote(raw, errors="strict"))
    except (ValueError, UnicodeDecodeError, RecursionError):
        # RecursionError：很深的巢狀陣列（約 1 萬層）會讓 json.loads 爆堆疊，原本是 500。
        raise _invalid() from None
    if not isinstance(data, dict) or not set(data) <= set(allowed):
        raise _invalid()
    fields: dict[str, str] = {}
    for key, value in data.items():
        if value is None or value == "":
            continue
        if not isinstance(value, str) or len(value) > allowed[key] or _CONTROL_CHARS_RE.search(value):
            raise _invalid()
        fields[key] = value
    return fields


def search_term_list(raw: str | None, key: str, *, max_items: int, max_length: int) -> list[str] | None:
    """X-Ivy-Search 裡值為字串陣列的鍵（操作紀錄一次送多個搜尋詞，2026-10-27 資安稽核）。
    沒帶 header 或沒有這個鍵回 None（呼叫端退回查詢參數）；其他鍵、型別、個數或長度不對回 422。"""
    if not raw:
        return None
    try:
        data = json.loads(unquote(raw, errors="strict"))
    except (ValueError, UnicodeDecodeError, RecursionError):
        # RecursionError：很深的巢狀陣列（約 1 萬層）會讓 json.loads 爆堆疊，原本是 500。
        raise _invalid() from None
    if not isinstance(data, dict) or not set(data) <= {key}:
        raise _invalid()
    values = data.get(key)
    if values is None:
        return None
    if not isinstance(values, list) or len(values) > max_items:
        raise _invalid()
    for value in values:
        if not isinstance(value, str) or len(value) > max_length or _CONTROL_CHARS_RE.search(value):
            raise _invalid()
    return values
