"""正式啟動（uvicorn app.main:app）時的 logging 設定。

uvicorn 只設定自己的 logger，root 沒有 handler：app.* 的 INFO／WARNING（定期
工作摘要、通知寄送失敗）原本全部被丟掉，只有 ERROR 經 lastResort 印出。
INFO 走 stdout、WARNING 以上走 stderr（和原本 lastResort 一樣），平台 log 的
嚴重度分類才不會把每一行 INFO 都當成錯誤。

uvicorn 的存取紀錄會把完整網址連同查詢字串寫進 Railway log，後台案件搜尋的
`?q=0912345678`、匯出的篩選條件就這樣留在平台日誌裡，個資保存政策清不到。
存取紀錄改成只記路徑，查詢字串一律拿掉（路徑本身 uvicorn 已經 percent-encode，
塞不進換行偽造 log 行）。存取紀錄只有 uvicorn 這一份，API 不另外記。

資料庫錯誤的堆疊也會帶出個資：見 RedactDatabaseErrorDetail。"""

from __future__ import annotations

import logging
import re
import sys

_FORMAT = "%(asctime)s %(levelname)s %(name)s %(message)s"


class StripQueryString(logging.Filter):
    """uvicorn.access 的 record.args 是 (client, method, full_path, http_version, status)。"""

    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        if isinstance(args, tuple) and len(args) >= 3 and isinstance(args[2], str) and "?" in args[2]:
            record.args = (*args[:2], args[2].split("?", 1)[0], *args[3:])
        return True


_REDACTED = "[內容已隱藏]"
# asyncpg 送出前編碼參數失敗時的訊息：「invalid input for query argument $2: '0912…'
# (…)」，參數值與括號裡的說明都可能帶原值。repr 不會跨行，整行後半段換掉。
_ARGUMENT_ERROR = re.compile(r"(invalid input for query argument \$\d+:)[^\n]*")


def _exception_chain(exc: BaseException):
    seen: set[int] = set()
    stack: list[object] = [exc]
    while stack:
        current = stack.pop()
        if not isinstance(current, BaseException) or id(current) in seen:
            continue
        seen.add(id(current))
        yield current
        # SQLAlchemy 的 DBAPIError 把 driver 例外放在 .orig。
        stack.extend((current.__cause__, current.__context__, getattr(current, "orig", None)))


def _database_details(exc: BaseException) -> list[str]:
    details: set[str] = set()
    for current in _exception_chain(exc):
        detail = getattr(current, "detail", None)
        if type(current).__module__.startswith("asyncpg") and isinstance(detail, str) and detail:
            details.add(detail)
    # 長的先換：一段 DETAIL 可能包含另一段。
    return sorted(details, key=len, reverse=True)


class RedactDatabaseErrorDetail(logging.Filter):
    """資料庫錯誤堆疊裡的資料值不進平台日誌。

    hide_parameters（app/db.py）只藏 SQLAlchemy 附上的綁定參數。PostgreSQL 的
    DETAIL——違反 NOT NULL／CHECK 時的整列內容（家長姓名、手機、提問…）、唯一鍵
    衝突的鍵值——在 asyncpg 例外字串裡，SQLAlchemy 又把它包進自己的訊息，
    logger.exception 照樣整段寫出去，個資保存政策清不到。這裡在格式化堆疊時把
    DETAIL 與參數編碼錯誤裡的值換成固定字樣；堆疊、例外類別、錯誤訊息本文、
    約束與資料表名稱照留，除錯仍查得到哪裡出事。

    掛在 handler 上（configure_logging）：任何 logger 傳上來的紀錄都會經過。
    堆疊文字存回 record.exc_text，之後的 handler 與 formatter 沿用遮過的版本。"""

    def filter(self, record: logging.LogRecord) -> bool:
        if not record.exc_info or record.exc_info[1] is None:
            return True
        text = record.exc_text or logging.Formatter().formatException(record.exc_info)
        for detail in _database_details(record.exc_info[1]):
            text = text.replace(detail, _REDACTED)
        record.exc_text = _ARGUMENT_ERROR.sub(rf"\1 {_REDACTED}", text)
        return True


def _install_redaction(logger: logging.Logger) -> None:
    for handler in logger.handlers:
        if not any(isinstance(f, RedactDatabaseErrorDetail) for f in handler.filters):
            handler.addFilter(RedactDatabaseErrorDetail())


def _below_warning(record: logging.LogRecord) -> bool:
    return record.levelno < logging.WARNING


def configure_logging() -> None:
    root = logging.getLogger()
    if not root.handlers:
        formatter = logging.Formatter(_FORMAT)
        info = logging.StreamHandler(sys.stdout)
        info.setLevel(logging.INFO)
        info.addFilter(_below_warning)
        problems = logging.StreamHandler(sys.stderr)
        problems.setLevel(logging.WARNING)
        for handler in (info, problems):
            handler.setFormatter(formatter)
            root.addHandler(handler)
        root.setLevel(logging.INFO)
    # root 的 handler 收 app.* 與定期工作；uvicorn 自己的 handler 收 uvicorn.error
    # （ASGI 未處理例外的完整堆疊），它不往 root 傳。
    _install_redaction(root)
    _install_redaction(logging.getLogger("uvicorn"))
    access = logging.getLogger("uvicorn.access")
    if not any(isinstance(f, StripQueryString) for f in access.filters):
        access.addFilter(StripQueryString())
