"""網站出現新的錯誤時，推到總管理者的手機（2026-11-05，接 operations/error_reports.py）。

錯誤回報寫入時如果是「第一次出現的一組」或「已處理後又發生」，error_reports 呼叫 schedule()，在背景
排一個任務：自己開 session、自己建 httpx client、例外全部吞掉並記 log，不拖慢也不影響錯誤回報的寫入
與 API 回應。推播沒啟用（沒設 VAPID 金鑰）時什麼都不做。

節流是**全站**的：任何一組的 alerted_at 在 15 分鐘內就不再推（部署壞掉時一次冒出幾十種新錯誤，
手機只會響一次）。被節流擋掉的那一組不會補推，它仍在系統狀態頁的錯誤區塊。判斷與「把這一組的
alerted_at 設成現在」在同一把 advisory lock 與同一個交易裡完成並先 commit，再送出——多個程序
同時偵測到新錯誤也只會有一個送出。

推播內容：API 的錯誤（伺服器自己產生）是來源、錯誤類型與訊息前 60 字（入庫前已遮蔽 Email、電話、token 等），
不放堆疊與網址。官網／後台前端回報的錯誤任何訪客都能偽造，推播只帶來源與「長得像錯誤類別名稱」的類型，
不帶訊息——否則匿名訪客可以把自訂文字（例如「請到某網址重新登入」）推到總管理者手機（2026-11-11 資安稽核）。"""

from __future__ import annotations

import asyncio
import logging
import re
from datetime import timedelta
from typing import Any

import httpx
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.auth.models import User
from app.auth.permissions import roles_with
from app.common.timezones import now_utc
from app.config import Settings
from app.notifications import web_push
from app.operations.models import ErrorGroup

logger = logging.getLogger("app.notifications.error_alerts")

ALERT_THROTTLE = timedelta(minutes=15)
MESSAGE_PREVIEW_CHARS = 60
SOURCE_LABELS = {"web": "官網", "admin": "後台", "api": "API"}
ALERT_URL = "/admin/system-status#errors"
_LOCK_KEY = "ivy-website:error-alert"

# 背景任務要留著參照，不然排程後沒人拿著的 task 可能被 GC 回收、半途消失。
_tasks: set[asyncio.Task] = set()


# 前端回報的錯誤類型只在長得像識別字（TypeError、ChunkLoadError…）時才放進推播。
_CLIENT_KIND = re.compile(r"[A-Za-z_$][A-Za-z0-9_$]{0,39}")
CLIENT_DETAIL_HINT = "詳情請到系統狀態頁查看"


def alert_payload(group: ErrorGroup) -> dict[str, str]:
    message = re.sub(r"\s+", " ", group.message or "").strip()[:MESSAGE_PREVIEW_CHARS]
    kind = re.sub(r"\s+", " ", group.kind or "").strip()
    source = SOURCE_LABELS.get(group.source, group.source)
    if group.source == "api":
        body = f"{source}：{kind} {message}".strip()
    else:
        safe_kind = kind if _CLIENT_KIND.fullmatch(kind) else "前端錯誤"
        body = f"{source}：{safe_kind}（{CLIENT_DETAIL_HINT}）"
    return {
        "title": "網站出現新的錯誤",
        "body": body,
        "url": ALERT_URL,
        "tag": "site-error",
    }


async def claim(db: AsyncSession, group_id: int) -> ErrorGroup | None:
    """全站節流：沒有任何一組在 15 分鐘內推過，才把這一組標成剛推過並 commit。回傳該組，不送就回 None。
    不推的情況：組不存在、已標為處理、節流中。"""
    # 同一把鎖序列化「檢查＋標記」，commit 時自動釋放（交易層級）。
    await db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": _LOCK_KEY})
    now = now_utc()
    group = await db.get(ErrorGroup, group_id, populate_existing=True)
    if group is None or group.resolved_at is not None:
        await db.rollback()
        return None
    latest = await db.scalar(select(func.max(ErrorGroup.alerted_at)))
    if latest is not None and now - latest < ALERT_THROTTLE:
        await db.rollback()
        return None
    group.alerted_at = now
    await db.commit()
    return group


async def alert(
    session_factory: async_sessionmaker[AsyncSession],
    settings: Settings,
    transport: httpx.AsyncBaseTransport | None,
    group_id: int,
) -> bool:
    """送出這一組的錯誤通知給啟用中的總管理者。回傳有沒有送（至少一台裝置收到）。"""
    if not settings.web_push_enabled:
        return False
    async with session_factory() as db:
        group = await claim(db, group_id)
        if group is None:
            return False
        # 收件人＝看得到系統狀態錯誤列表的人（目前只有總管理者），跟權限表同一個定義、不寫死角色
        # （test_permission_table 禁止在權限表以外比對角色）。
        admins = list(
            (
                await db.execute(
                    select(User)
                    .where(User.role.in_(roles_with("system.status")), User.is_active.is_(True))
                    .order_by(User.email)
                )
            ).scalars()
        )
        if not admins:
            return False
        payload = alert_payload(group)
        await db.commit()  # 查詢用的交易先結束，不握著連線等推播服務
        async with web_push.new_client(transport) as client:
            delivered = await web_push.send_to_users(db, admins, payload, settings=settings, client=client)
        await db.commit()
        return any(delivered.values())


async def _run(session_factory: Any, settings: Settings, transport: Any, group_id: int) -> None:
    try:
        await alert(session_factory, settings, transport, group_id)
    except Exception as exc:  # noqa: BLE001 —— 通知壞了不能影響任何事，也不再回報成錯誤（會繞圈）
        logger.warning("網站錯誤的手機推播失敗（略過）：error=%s", type(exc).__name__)


def schedule(app: Any, group_id: int) -> None:
    """排一個背景任務（呼叫端不等它）。必須在執行中的 event loop 內呼叫；永遠不丟例外。"""
    try:
        settings: Settings = app.state.settings
        if not settings.web_push_enabled:
            return
        task = asyncio.get_running_loop().create_task(
            _run(app.state.session_factory, settings, getattr(app.state, "push_transport", None), group_id)
        )
        _tasks.add(task)
        task.add_done_callback(_tasks.discard)
    except Exception as exc:  # noqa: BLE001
        logger.warning("網站錯誤的手機推播排程失敗（略過）：error=%s", type(exc).__name__)


async def wait_idle() -> None:
    """等目前排著的背景任務跑完（測試與關機用）。"""
    while _tasks:
        await asyncio.gather(*list(_tasks), return_exceptions=True)
