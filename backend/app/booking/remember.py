"""這台裝置記住預約（2026-11-16，docs/specs/2026-11-16-cookie-features-design.md §3）。

Email 2026-11-13 起選填：沒留 Email 的家長關掉結果頁之後就拿不回修改連結。送單成立時把修改連結的 token
放進 HttpOnly cookie，回到預約頁時顯示「您已預約…」，按了用同一個 token 換家長 session。

- cookie 的值就是信裡那條修改連結的 token：園方重新產生連結、案件取消或完成時 token 撤銷，這個 cookie
  跟著失效（下次查詢就清掉），不必另外維護撤銷。
- 期限到 token 到期為止（至少 14 天；參觀日較遠時到參觀後 7 天，見 access_service.token_expiry）。
- 正式環境由 common/host_cookies.py 加 __Host- 前綴（子網域寫不進來、蓋不掉）。
- 這是家長自己的預約，屬網站運作必要的 cookie，不看 DNT／GPC。
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import Response

from app.config import Settings

REMEMBER_COOKIE = "ivy_visit_remember"


def set_cookie(response: Response, settings: Settings, raw_token: str, expires_at: datetime, now: datetime | None = None) -> None:
    max_age = int((expires_at - (now or datetime.now(timezone.utc))).total_seconds())
    if max_age <= 0:
        return
    response.set_cookie(
        key=REMEMBER_COOKIE,
        value=raw_token,
        max_age=max_age,
        httponly=True,
        secure=settings.environment == "production",
        samesite="lax",
        path="/",
    )


def clear_cookie(response: Response, settings: Settings) -> None:
    response.delete_cookie(
        REMEMBER_COOKIE, path="/", httponly=True, secure=settings.environment == "production", samesite="lax"
    )
