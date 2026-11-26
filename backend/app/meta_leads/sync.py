"""把各校粉專即時表單的新名單寫進收件匣、推 LINE 通知（docs/specs/2026-11-26-meta-lead-inbox-design.md §5）；
刪過期名單的 purge_expired 由 maintenance 每輪呼叫（§6，不看功能開關）。

網路請求都在交易外做完，寫入是一校一個短交易。同一筆名單（lead_id 唯一）再讀到就略過：不改狀態，
也不把轉案件時清掉的個資寫回去。兩個程序同時拉，也只是同一筆被略過一次，所以不加 advisory lock。"""

from __future__ import annotations

import logging
import uuid
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta

import httpx
from sqlalchemy import delete, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.campuses.models import Campus
from app.common.timezones import now_utc
from app.config import Settings
from app.facebook import graph
from app.meta_leads.models import MetaLead, MetaLeadSync
from app.meta_leads.service import contact_fields
from app.notifications.line import LineMessagingClient, LinePushError
from app.notifications.line_group_settings import targets_for

logger = logging.getLogger("app.meta_leads.sync")

# 下一輪從已讀到的最新名單時間往前重疊多久再讀（Meta 偶爾晚一點才看得到名單）；重複的靠 lead_id 略過。
OVERLAP = timedelta(minutes=10)
# 第一次拉（還沒有任何名單）往前看多久。
FIRST_WINDOW = timedelta(days=7)
# 一校一輪最多收幾筆；讀滿就不推進 cursor，下一輪再從原處讀。
MAX_LEADS_PER_CAMPUS = 500
# 只推這段時間內收到的名單；更舊的（例如剛開啟功能時拉到的）直接當已通知，不洗群組。
NOTIFY_WINDOW = timedelta(hours=24)


@dataclass
class LeadSyncResult:
    campus_key: str
    # 這輪新收進來幾筆（已經有的不算）。
    count: int = 0
    error: str | None = None


async def _record(
    db: AsyncSession, campus_key: str, page_id: str, now: datetime, *, count: int | None, error: str | None,
    cursor_at: datetime | None,
) -> None:
    values: dict = {"page_id": page_id, "last_attempt_at": now, "last_error": error}
    if error is None:
        values |= {"last_success_at": now, "last_count": count, "cursor_at": cursor_at}
    await db.execute(
        insert(MetaLeadSync)
        .values(campus_key=campus_key, **values)
        .on_conflict_do_update(index_elements=[MetaLeadSync.campus_key], set_=values)
    )


async def _write_leads(
    db: AsyncSession, campus_key: str, leads: list[graph.GraphLead], form_names: dict[str, str | None], now: datetime
) -> int:
    """新名單以欄位預設的 'new' 寫入；回傳新寫入幾筆。"""
    written = 0
    for lead in leads:
        parent_name, phone, answers = contact_fields(lead.fields)
        result = await db.execute(
            insert(MetaLead)
            .values(
                id=uuid.uuid4(),
                campus_key=campus_key,
                lead_id=lead.lead_id,
                form_id=lead.form_id,
                form_name=form_names.get(lead.form_id),
                ad_id=lead.ad_id,
                campaign_id=lead.campaign_id,
                platform=lead.platform,
                is_organic=lead.is_organic,
                created_at=lead.created_at,
                fetched_at=now,
                parent_name=parent_name,
                phone=phone,
                answers=answers,
            )
            .on_conflict_do_nothing(index_elements=[MetaLead.lead_id])
            .returning(MetaLead.id)
        )
        if result.first() is not None:
            written += 1
    return written


async def purge_expired(db: AsyncSession, settings: Settings, *, now: datetime | None = None) -> int:
    """刪掉收到超過保存天數、沒轉成案件的名單（新的、略過的）；轉過的名單個資早已清掉，留著當紀錄。"""
    cutoff = (now or now_utc()) - timedelta(days=settings.meta_leads_retention_days)
    result = await db.execute(
        delete(MetaLead).where(MetaLead.status.in_(("new", "dismissed")), MetaLead.created_at < cutoff)
    )
    return result.rowcount or 0


async def _fetch(
    client: httpx.AsyncClient, settings: Settings, page_id: str, since: datetime
) -> tuple[list[graph.GraphLead], dict[str, str | None]]:
    token = await graph.page_token(client, settings, page_id)
    forms = await graph.leadgen_forms(client, settings, page_id, token)
    leads: list[graph.GraphLead] = []
    names: dict[str, str | None] = {}
    for form in forms:
        names[form.form_id] = form.name
        remaining = MAX_LEADS_PER_CAMPUS - len(leads)
        if remaining <= 0:
            break
        leads += await graph.form_leads(client, settings, form.form_id, token, since=since, max_rows=remaining)
    return leads, names


async def sync_leads(
    session_factory: async_sessionmaker[AsyncSession],
    settings: Settings,
    *,
    campus_keys: list[str] | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[LeadSyncResult]:
    """拉設定裡各校粉專的新名單（campus_keys 有給就只拉那幾校）。
    一校失敗不影響其他校；設定裡不存在的校區代號略過並記警告。"""
    if not settings.meta_leads_sync_enabled:
        return []
    pages = settings.facebook_page_ids
    async with session_factory() as db:
        known = set(await db.scalars(select(Campus.key)))
        cursors = dict((await db.execute(select(MetaLeadSync.campus_key, MetaLeadSync.cursor_at))).all())
    targets = [key for key in (campus_keys if campus_keys is not None else pages) if key in pages]
    results: list[LeadSyncResult] = []
    async with graph.new_client(transport) as client:
        for campus_key in targets:
            if campus_key not in known:
                logger.warning("Meta 名單：WEBSITE_FACEBOOK_PAGES 裡的 %s 不是已知校區，略過", campus_key)
                continue
            page_id = pages[campus_key]
            result = LeadSyncResult(campus_key)
            cursor = cursors.get(campus_key)
            since = cursor - OVERLAP if cursor else now_utc() - FIRST_WINDOW
            leads: list[graph.GraphLead] = []
            names: dict[str, str | None] = {}
            try:
                leads, names = await _fetch(client, settings, page_id, since)
            except graph.GraphError as exc:
                result.error = str(exc)[:200]
            now = now_utc()
            async with session_factory() as db:
                new_cursor = cursor
                if result.error is None:
                    result.count = await _write_leads(db, campus_key, leads, names, now)
                    if len(leads) < MAX_LEADS_PER_CAMPUS:
                        newest = max((lead.created_at for lead in leads), default=None)
                        new_cursor = max((value for value in (cursor, newest) if value is not None), default=None)
                    else:
                        logger.warning("Meta 名單 %s 一輪讀滿 %s 筆，下一輪從原處再讀", campus_key, MAX_LEADS_PER_CAMPUS)
                await _record(
                    db, campus_key, page_id, now, count=result.count, error=result.error, cursor_at=new_cursor
                )
                await db.commit()
            if result.error:
                logger.warning("Meta 名單 %s 拉取失敗：%s", campus_key, result.error)
            results.append(result)
    return results


def notification_text(campus_name: str, count: int, admin_origin: str | None, campus_key: str) -> str:
    """推到群組的文字：只有校名與筆數，不放家長姓名與電話（群組成員不一定都該看到個資）。"""
    text = f"【{campus_name}】有 {count} 筆新的 Meta 廣告名單，請到後台「廣告名單」聯絡家長。"
    if admin_origin:
        text += f"\n{admin_origin.rstrip('/')}/admin/meta-leads?campus={campus_key}&openExternalBrowser=1"
    return text


async def notify_new_leads(
    db: AsyncSession, settings: Settings, *, line_client: LineMessagingClient | None
) -> int:
    """每校一則：把還沒通知過的新名單推到該校（與總部）群組，全部群組都推成功才記 notified_at；
    有群組失敗就整批下一輪再推（X-Line-Retry-Key 依名單與群組固定，LINE 會擋掉已收過的重送）。
    沒設 LINE、沒綁群組、名單已不是新的、或收到超過 NOTIFY_WINDOW 的，直接記已通知。回傳推出幾則。"""
    now = now_utc()
    rows = (await db.execute(
        select(MetaLead.id, MetaLead.campus_key, MetaLead.created_at, MetaLead.status)
        .where(MetaLead.notified_at.is_(None))
        .order_by(MetaLead.created_at)
    )).all()
    pending: dict[str, list[uuid.UUID]] = defaultdict(list)
    silent: list[uuid.UUID] = []
    for lead_id, campus_key, created_at, status in rows:
        if status == "new" and created_at >= now - NOTIFY_WINDOW and line_client is not None:
            pending[campus_key].append(lead_id)
        else:
            silent.append(lead_id)
    if silent:
        await db.execute(update(MetaLead).where(MetaLead.id.in_(silent)).values(notified_at=now))
        await db.commit()
    sent = 0
    for campus_key, lead_ids in pending.items():
        targets = await targets_for(db, campus_key)
        campus = await db.get(Campus, campus_key)
        text = notification_text(campus.name if campus else campus_key, len(lead_ids), settings.admin_origin, campus_key)
        batch = ",".join(sorted(str(lead_id) for lead_id in lead_ids))
        delivered = True
        for target in targets:
            key = uuid.uuid5(uuid.NAMESPACE_URL, f"meta-leads:{target.target_id}:{batch}")
            try:
                await line_client.push_text(target.target_id, text, key=key)  # type: ignore[union-attr]
            except (LinePushError, httpx.HTTPError):
                logger.warning("Meta 名單 LINE 通知失敗，下一輪再試：%s", campus_key, exc_info=True)
                delivered = False
                continue
            sent += 1
        if delivered:
            await db.execute(update(MetaLead).where(MetaLead.id.in_(lead_ids)).values(notified_at=now_utc()))
            await db.commit()
    return sent
