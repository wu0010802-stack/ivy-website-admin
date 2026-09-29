"""正式啟動（uvicorn app.main:app）時的 logging 設定。

uvicorn 只設定自己的 logger，root 沒有 handler：app.* 的 INFO／WARNING（定期
工作摘要、通知寄送失敗）原本全部被丟掉，只有 ERROR 經 lastResort 印出。
INFO 走 stdout、WARNING 以上走 stderr（和原本 lastResort 一樣），平台 log 的
嚴重度分類才不會把每一行 INFO 都當成錯誤。

uvicorn 的存取紀錄會把完整網址連同查詢字串寫進 Railway log，後台案件搜尋的
`?q=0912345678`、匯出的篩選條件就這樣留在平台日誌裡，個資保存政策清不到。
存取紀錄改成只記路徑，查詢字串一律拿掉（路徑本身 uvicorn 已經 percent-encode，
塞不進換行偽造 log 行）。存取紀錄只有 uvicorn 這一份，API 不另外記。"""

from __future__ import annotations

import logging
import sys

_FORMAT = "%(asctime)s %(levelname)s %(name)s %(message)s"


class StripQueryString(logging.Filter):
    """uvicorn.access 的 record.args 是 (client, method, full_path, http_version, status)。"""

    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        if isinstance(args, tuple) and len(args) >= 3 and isinstance(args[2], str) and "?" in args[2]:
            record.args = (*args[:2], args[2].split("?", 1)[0], *args[3:])
        return True


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
    access = logging.getLogger("uvicorn.access")
    if not any(isinstance(f, StripQueryString) for f in access.filters):
        access.addFilter(StripQueryString())
