"""預約各組路由（routes.py、config_routes.py、slot_routes.py、admin_visit_routes.py）共用的小工具。"""

from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.permissions import ScopeDenied
from app.common import ratelimit
from app.booking.schemas import has_control_chars
from app.campuses.models import Campus


def _rate_limited(exc: ratelimit.RateLimited, code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail={"code": code, "message": message},
        headers={"Retry-After": str(exc.retry_after_seconds)},
    )


async def _campus_or_404(db: AsyncSession, campus_key: str) -> None:
    """總管理者的 require_scope 對任何校區代號都放行；不存在的校區要回 404，不能
    一路寫到外鍵才變 500。含控制字元（例如網址上的 %00）的 key 不可能是校區，
    不擋的話 PostgreSQL 拒收 NUL，同樣變成 500，與不存在的校區一樣回 404。"""
    if has_control_chars(campus_key) or await db.get(Campus, campus_key) is None:
        raise ScopeDenied()
