"""分頁游標：base64url 的 JSON，編「段別＋上一筆的 created_at＋id」。

段別 vr＝官網預約（visit_requests），rv＝沒有預約的招生訪視（手動建立或原預約已刪除）。
游標只是位置，不帶校區（校區由 query 與金鑰決定），拿別校的游標只會從那個時間點之後取本校的資料。"""

from __future__ import annotations

import base64
import binascii
import json
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Literal

Segment = Literal["vr", "rv"]
SEGMENTS: tuple[str, ...] = ("vr", "rv")
MAX_CURSOR_LENGTH = 200


class InvalidCursor(ValueError):
    pass


@dataclass(frozen=True)
class Cursor:
    segment: Segment
    created_at: datetime
    row_id: uuid.UUID

    def encode(self) -> str:
        payload = {"s": self.segment, "t": self.created_at.astimezone(timezone.utc).isoformat(), "i": str(self.row_id)}
        raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")

    @classmethod
    def decode(cls, value: str) -> "Cursor":
        if not value or len(value) > MAX_CURSOR_LENGTH:
            raise InvalidCursor
        try:
            raw = base64.b64decode(value.encode("ascii") + b"=" * (-len(value) % 4), altchars=b"-_", validate=True)
            payload = json.loads(raw)
            segment, stamp, row_id = payload["s"], payload["t"], payload["i"]
            if segment not in SEGMENTS or not isinstance(stamp, str) or not isinstance(row_id, str):
                raise InvalidCursor
            created_at = datetime.fromisoformat(stamp)
            parsed_id = uuid.UUID(row_id)
        except InvalidCursor:
            raise
        except (ValueError, TypeError, KeyError, OverflowError, binascii.Error, UnicodeError):
            raise InvalidCursor from None
        if created_at.tzinfo is None:
            raise InvalidCursor
        return cls(segment, created_at, parsed_id)
