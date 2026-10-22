from __future__ import annotations

import asyncio
import logging
import re
import uuid
from datetime import date, datetime, timedelta, timezone

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.models import User
from app.auth.permissions import covers_campus, roles_with
from app.booking import access_service, exclusion
from app.booking.models import OutboxMessage, OutboxStatus, VisitRequest, VisitRequestStatus, VisitSlot
from app.booking.outbox import (
    PARENT_EMAIL_CHANGED,
    PARENT_KINDS,
    PARENT_VISIT_BOOKED,
    PARENT_VISIT_CANCELLED,
    PARENT_VISIT_CHANGED,
    PARENT_VISIT_DAY_CLOSED,
    PARENT_VISIT_REMINDER,
    day_closed_dedupe_key,
    without_old_email,
)
from app.booking.parent_policy import change_deadline_hours, day_closed, parent_change_deadline, parent_change_open
from app.campuses.models import Campus
from app.common.timezones import slot_start_utc, today_local
from app.content import service as content_service
from app.notifications import line as line_api
from app.notifications import reminders
from app.notifications.email_adapter import EmailAdapter
from app.notifications.parent_email import ParentEmail, build_email_changed_notice, build_parent_email
from app.notifications.models import LineCampusTarget, LineGroup, NotificationDelivery, NotificationInboxItem

logger = logging.getLogger("app.notifications")

_KIND_LABELS = {
    # 官網送單即預約成立（排了場次的才叫預約，未排的才叫「參觀需求」，和後台用語一致）。
    "visit_request_created": "新的參觀預約",
    # 後台補登排入場次。
    "visit_request_confirmed": "參觀預約已確認",
    "visit_request_cancelled": "參觀預約已取消",
    "visit_request_rescheduled": "參觀預約已改期",
    "parent_visit_booked": "家長確認信（預約成功）",
    "parent_visit_changed": "家長確認信（預約已變更）",
    "parent_visit_cancelled": "家長確認信（預約已取消）",
    # 停班停課（2026-10-14）：請家長用修改連結改約或取消。
    "parent_visit_day_closed": "家長停課通知（請改約）",
    # 參觀前 24 小時提醒家長（2026-10-15）。
    "parent_visit_reminder": "參觀提醒（家長）",
    # 家長自己改 Email 時寄到舊信箱（2026-10-22 資安稽核）。
    "parent_email_changed": "家長 Email 變更通知（寄舊信箱）",
    # 舊流程（家長送出改期申請、等園方核准，2026-10-08 刪除）留下的通知，
    # 站內通知列與寄送失敗清單重寄時仍要有標題。
    "visit_reschedule_requested": "家長申請改期（待園方核准）",
    # 規格 L268：定期工作產生的提醒（notifications/reminders.py）。
    reminders.UPCOMING_VISIT_KIND: f"即將參觀（{reminders.whole_hours(reminders.UPCOMING_VISIT_LEAD)} 小時內）",
    # 舊流程（2026-10-06 拿掉）留下的通知，寄送失敗清單重寄時仍要有標題。
    "visit_request_hold_expired": "時段占位已逾期，名額已釋放",
    "visit_request_overdue": "案件逾期未處理",
}


def notification_label(kind: str, payload: dict | None = None) -> str:
    """通知的中文標題。"""
    return _KIND_LABELS.get(kind, kind)

_HEADER_UNSAFE_RE = re.compile(r"[\r\n]")

# 超過這個時間還沒送出的訊息只寫站內通知、不再推播或寄信。正常重試（5 次、
# 最長間隔 15 分鐘）遠短於此，這條只會擋到積壓的舊訊息——例如定期工作第一次
# 上線、或寄信設定修好時，不該把幾天前的通知一次寄給所有人。
EXTERNAL_DELIVERY_STALE_AFTER = timedelta(hours=24)


def _header_safe(value: str) -> str:
    """收件者與主旨進 SMTP header 之前先把換行拿掉——含換行的值可以在
    header 區段插入額外欄位（header injection）。目前的 sink adapter 不會
    真的組 header，但這個函式是給之後接真實 SMTP 用的防線。"""
    return _HEADER_UNSAFE_RE.sub(" ", value)


async def get_notification_recipients(db: AsyncSession, campus_key: str) -> list[User]:
    """依校區通知：只給目前真的還有這個校區權限、且帳號啟用中的人員。
    這裡每次都即時查詢目前的 scope，不在建立通知時就把收件人清單寫死，
    帳號被停權或改 scope 後自然收不到後續通知，不需要額外清理。

    收件人＝能處理這個校區案件的人（booking.handle，含接待人員——真正接
    新案的是櫃台），跟權限表同一個定義，不另外寫死角色。"""
    result = await db.execute(
        select(User)
        .options(selectinload(User.campus_scopes))
        .where(User.is_active.is_(True), User.role.in_(roles_with("booking.handle")))
        .order_by(User.email)
    )
    return [user for user in result.scalars() if covers_campus(user, campus_key)]


async def _already_delivered(
    db: AsyncSession, outbox_message_id: uuid.UUID, channel: str, recipient_key: str
) -> bool:
    result = await db.execute(
        select(NotificationDelivery.id).where(
            NotificationDelivery.outbox_message_id == outbox_message_id,
            NotificationDelivery.channel == channel,
            NotificationDelivery.recipient_key == recipient_key,
        )
    )
    return result.scalars().first() is not None


def _record_delivery(
    db: AsyncSession, outbox_message_id: uuid.UUID, channel: str, recipient_key: str
) -> None:
    db.add(
        NotificationDelivery(
            id=uuid.uuid4(),
            outbox_message_id=outbox_message_id,
            channel=channel,
            recipient_key=recipient_key,
            created_at=datetime.now(timezone.utc),
        )
    )


async def campus_line_target(db: AsyncSession, campus_key: str) -> str | None:
    """這個校區目前要推播的 LINE 群組；bot 已被移出的群組不算。"""
    result = await db.execute(
        select(LineGroup.target_id)
        .join(LineCampusTarget, LineCampusTarget.target_id == LineGroup.target_id)
        .where(LineCampusTarget.campus_key == campus_key, LineGroup.left_at.is_(None))
    )
    return result.scalar_one_or_none()


async def _campus_name(db: AsyncSession, campus_key: str) -> str:
    name = (await db.execute(select(Campus.name).where(Campus.key == campus_key))).scalar_one_or_none()
    return name or campus_key


async def _campus_active(db: AsyncSession, campus_key: str) -> bool:
    """分校是否仍開放公開預約；查不到校區列時維持原行為（當作開放）。"""
    active = (await db.execute(select(Campus.active).where(Campus.key == campus_key))).scalar_one_or_none()
    return active is not False


def admin_visit_url(
    admin_origin: str | None, receipt_id: str | None, *, external_browser: bool = False
) -> str | None:
    if not admin_origin or not receipt_id:
        return None
    url = f"{admin_origin.rstrip('/')}/admin/visit-requests/{receipt_id}"
    # LINE 內建瀏覽器擋 Google 登入：openExternalBrowser=1 是 LINE 官方參數，點開改用手機預設瀏覽器。
    return f"{url}?openExternalBrowser=1" if external_browser else url


# 家長稱呼是公開表單的自由文字（最長 64 字）。LINE 會把網址變成可點的連結，緊貼在真正
# 的後台連結旁邊推到各校員工群組（2026-10-06 稽核：可以拿來釣魚），所以推播前拿掉
# 網址與網域樣式的字串、只留前 20 字。
_URLISH_RE = re.compile(r"(?i)(?:[a-z][a-z0-9+.-]*://|www\.)\S*|[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}(?:/\S*)?")
LINE_PARENT_NAME_MAX = 20


def line_parent_name(parent_name: str | None) -> str:
    cleaned = " ".join(_URLISH_RE.sub(" ", parent_name or "").split())
    return cleaned[:LINE_PARENT_NAME_MAX].strip()


def line_text(
    label: str,
    campus_name: str,
    receipt_id: str | None,
    admin_origin: str | None,
    parent_name: str | None = None,
) -> str:
    """類型、校區、家長稱呼、案件編號與後台連結。家長稱呼是 2026-10-05 業主裁定
    加上的（原本群組推播不帶任何家長資料）；電話、Email、孩子資料照舊不放，
    明細要點連結登入後台看。"""
    lines = [f"[常春藤官網] {label}", f"校區：{campus_name}"]
    if shown := line_parent_name(parent_name):
        lines.append(f"家長：{shown}")
    if receipt_id:
        lines.append(f"案件編號：{receipt_id}")
        if url := admin_visit_url(admin_origin, receipt_id, external_browser=True):
            lines.append(url)
    return "\n".join(lines)


# 信件稱呼用。表單沒有性別欄位，只有家長自己寫了稱謂（王媽媽、林先生）
# 才換成「先生／小姐」，其他一律稱「家長」，不猜。
_MALE_TITLES = ("先生", "爸爸", "爸比", "把拔", "爹地")
_FEMALE_TITLES = ("小姐", "女士", "太太", "媽媽", "媽咪", "馬麻")
_COMPOUND_SURNAMES = (
    "歐陽", "司馬", "諸葛", "上官", "張簡", "范姜", "東方", "皇甫", "司徒",
    "端木", "公孫", "夏侯", "慕容", "令狐", "長孫", "宇文", "尉遲",
)
_WEEKDAYS = "一二三四五六日"


def parent_salutation(parent_name: str | None) -> str:
    """信件裡的家長稱呼：只用姓氏加「先生／小姐」，判斷不出來就稱「家長」。
    不放全名——信可能被轉寄或留在共用信箱，完整資料要登入後台看。"""
    name = (parent_name or "").strip()
    title = None
    for suffixes, label in ((_MALE_TITLES, "先生"), (_FEMALE_TITLES, "小姐")):
        suffix = next((s for s in suffixes if name.endswith(s)), None)
        if suffix:
            name, title = name[: -len(suffix)].strip(), label
            break
    if title is None or not name or not "\u4e00" <= name[0] <= "\u9fff":
        return "家長"
    surname = next((s for s in _COMPOUND_SURNAMES if name.startswith(s)), name[0])
    return f"{surname}{title}"


def slot_text(slot: VisitSlot) -> str:
    """2026/09/26（週六）10:00–11:00，和後台案件頁的寫法一致。"""
    day = slot.slot_date
    return (
        f"{day:%Y/%m/%d}（週{_WEEKDAYS[day.weekday()]}）"
        f"{slot.start_time:%H:%M}–{slot.end_time:%H:%M}"
    )


async def _load_visit_request(
    db: AsyncSession, receipt_id: str | None, *, share_lock: bool = False
) -> VisitRequest | None:
    """share_lock：以 FOR SHARE 讀案件列並覆蓋已載入的值。後台更正 Email、換發連結都先拿同一列的
    FOR UPDATE，所以持有共享鎖期間讀到的 Email 與「目前有效連結」是同一個世代。"""
    try:
        visit_id = uuid.UUID(str(receipt_id))
    except ValueError:
        return None
    query = select(VisitRequest).options(selectinload(VisitRequest.slot)).where(VisitRequest.id == visit_id)
    if share_lock:
        query = query.with_for_update(read=True).execution_options(populate_existing=True)
    result = await db.execute(query)
    return result.scalar_one_or_none()


async def email_content(
    db: AsyncSession,
    *,
    label: str,
    campus_key: str,
    receipt_id: str | None,
    admin_origin: str | None,
) -> tuple[str, str]:
    """(主旨, 內文)。收件人都是有這校案件權限的園方人員，但信件仍只放校名、
    家長稱呼、參觀時段與後台連結，不放手機、Email 或孩子資料。內容在寄出
    當下讀案件，時段是寄信時的最新狀態。"""
    campus_name = await _campus_name(db, campus_key)
    visit_request = await _load_visit_request(db, receipt_id)
    anonymized = visit_request is not None and visit_request.anonymized_at is not None
    lines = [
        f"[常春藤官網] {label}",
        "",
        f"校區：{campus_name}",
        f"家長：{parent_salutation(None if visit_request is None or anonymized else visit_request.parent_name)}",
    ]
    if visit_request is not None and visit_request.slot is not None:
        lines.append(f"參觀時段：{slot_text(visit_request.slot)}")
    if url := admin_visit_url(admin_origin, receipt_id):
        lines.append(f"案件：{url}")
    elif receipt_id:
        lines.append(f"案件編號：{receipt_id}")
    lines += ["", "家長的聯絡方式與孩子資料請登入後台查看，信件不附個資。"]
    return f"[常春藤官網] {campus_name}｜{label}", "\n".join(lines)


def _day_word(slot_date: date) -> str | None:
    """參觀提醒的「明天／今天」依寄出當下的台北日期（規格 R8）；其他天數不寫。"""
    return {0: "今天", 1: "明天"}.get((slot_date - today_local()).days)


async def _superseded_by_day_closed_notice(
    db: AsyncSession, outbox_message_id: uuid.UUID, visit_request_id: uuid.UUID, slot_date: date
) -> bool:
    """這封信排入之後，同一案件同一天另外排了停課通知（還沒放棄的）。"""
    own_created_at = select(OutboxMessage.created_at).where(OutboxMessage.id == outbox_message_id).scalar_subquery()
    found = await db.scalar(
        select(OutboxMessage.id)
        .where(
            OutboxMessage.dedupe_key == day_closed_dedupe_key(visit_request_id, slot_date),
            OutboxMessage.status.in_(
                (OutboxStatus.PENDING.value, OutboxStatus.LEASED.value, OutboxStatus.SENT.value)
            ),
            OutboxMessage.created_at > own_created_at,
        )
        .limit(1)
    )
    return found is not None


async def _dispatch_parent_email(
    db: AsyncSession,
    *,
    outbox_message_id: uuid.UUID,
    kind: str,
    payload: dict,
    adapter: EmailAdapter | None,
    created_at: datetime | None,
    admin_origin: str | None,
    access_secret: str | None,
) -> bool:
    """寄給家長的確認信：只寄 Email。回傳 False 代表不適用（沒設定寄信、太舊、
    沒有 Email、已匿名化、預約成功／變更信寄出前案件已不是預約成立、參觀提醒寄出前
    場次已換、那天停課或案件已標記排除），runner 會標成 skipped、不重試。"""
    if adapter is None:
        return False
    if created_at is not None and datetime.now(timezone.utc) - created_at > EXTERNAL_DELIVERY_STALE_AFTER:
        return False
    # 收件人與管理連結要是同一個世代（2026-10-13 審查）：先讀 Email、之後才另查「目前有效連結」，
    # 後台剛好在中間更正 Email 並換發連結時，新連結會寄回舊信箱。所以讀案件時就拿共享鎖，讀完 Email 與
    # 連結、組好信之後才放鎖再寄；寄的是舊世代的信也沒關係，更正時舊連結已一併撤銷。
    # 取消通知不含連結，不需要鎖。
    visit_request = await _load_visit_request(
        db, payload.get("receipt_id"), share_lock=kind != PARENT_VISIT_CANCELLED
    )
    if visit_request is None or visit_request.anonymized_at is not None or not visit_request.email:
        return False
    # 排隊中的「預約成功／已變更」還沒寄，案件就取消了：不能再寄一封說預約成立的信，
    # 家長只該收到「已取消」。
    if kind != PARENT_VISIT_CANCELLED and visit_request.status != VisitRequestStatus.CONFIRMED.value:
        return False
    # 寄送失敗後補寄（requeue）時場次可能早就過了：不寄一封說「預約成功／已變更」的過期信。
    slot = visit_request.slot
    started = slot is not None and slot_start_utc(slot.slot_date, slot.start_time) <= datetime.now(timezone.utc)
    if kind != PARENT_VISIT_CANCELLED and started:
        return False
    # 寄件當下那天是否停課（取消信用不到）。預約成功／已變更信在停課日改寫成停課內容（2026-10-20 稽核）：
    # 停課後家長改資料、園方重寄確認信或重新產生連結都會排這兩種信，照原文寄等於說那天照常參觀。
    closed = kind != PARENT_VISIT_CANCELLED and await day_closed(db, visit_request)
    # 停課通知寄出前：家長已經改約到別天、或園方取消了那天的休假，就不寄。
    if kind == PARENT_VISIT_DAY_CLOSED and (
        slot is None or slot.slot_date.isoformat() != payload.get("closure_date") or not closed
    ):
        return False
    # 參觀提醒（2026-10-15 規格 R6）：場次換了（改期）或那天停課（另有停課信）就不寄。
    if kind == PARENT_VISIT_REMINDER and (slot is None or str(slot.id) != str(payload.get("slot_id")) or closed):
        return False
    # 停課前就排著的預約成功／已變更信：這天有比它新的停課通知（排著或已寄），家長收那一封就好，
    # 不再多一封同樣是停課內容的信。停課之後才排的（家長改資料、重寄確認信、重新產生連結）照寄。
    if closed and kind in (PARENT_VISIT_BOOKED, PARENT_VISIT_CHANGED) and slot is not None:
        if await _superseded_by_day_closed_notice(db, outbox_message_id, visit_request.id, slot.slot_date):
            return False
    # 排除的測試／重複案件不寄參觀提醒（2026-10-15 排除規格 E8）；排入之後才排除的在這裡擋下。
    if kind == PARENT_VISIT_REMINDER and exclusion.is_excluded(visit_request):
        return False
    recipient_key = f"parent:{visit_request.id}"
    if await _already_delivered(db, outbox_message_id, "email", recipient_key):
        return True
    origin = admin_origin.rstrip("/") if admin_origin else None
    deadline_hours = await change_deadline_hours(db, visit_request.campus_key)
    # 線上修改期限還沒過才附連結（提醒信 R7；2026-10-20 稽核起預約成功／已變更信也一樣：最短提前時間
    # 可以短於修改期限，送出當下期限就過了，連結點開也改不了）。停課日沒有期限。取消信不附。
    change_deadline = parent_change_deadline(visit_request, deadline_hours, day_closed=closed)
    change_open = parent_change_open(visit_request, deadline_hours, day_closed=closed)
    link_allowed = kind != PARENT_VISIT_CANCELLED and change_open
    manage_url = None
    if link_allowed and origin and access_secret:
        path = await access_service.current_manage_path(db, visit_request.id, secret=access_secret)
        manage_url = f"{origin}{path}" if path else None
    profile = await content_service.published_payload(db, "campus_profile", visit_request.campus_key) or {}
    # 分校停用後 /visit/<校> 不再開放預約：取消信不附重新預約網址，信件模板會改請家長來電。
    rebook_open = bool(origin) and await _campus_active(db, visit_request.campus_key)
    subject, body = build_parent_email(
        ParentEmail(
            kind=kind,
            campus_name=await _campus_name(db, visit_request.campus_key),
            salutation=parent_salutation(visit_request.parent_name),
            slot_date=slot.slot_date if slot else None,
            start_time=slot.start_time if slot else None,
            end_time=slot.end_time if slot else None,
            party_size=visit_request.party_size,
            campus_address=str(profile.get("address") or "").strip() or None,
            campus_phone=str(profile.get("phone") or "").strip() or None,
            manage_url=manage_url,
            change_deadline=change_deadline,
            change_window_passed=not change_open,
            day_closed=closed,
            cancel_reason=visit_request.cancel_reason,
            rebook_url=f"{origin}/visit/{visit_request.campus_key}" if rebook_open else None,
            closure_reason=str(payload.get("reason") or "").strip() or None if kind == PARENT_VISIT_DAY_CLOSED else None,
            day_word=_day_word(slot.slot_date) if kind == PARENT_VISIT_REMINDER and slot else None,
        )
    )
    recipient = _header_safe(visit_request.email)
    # 信組好了：放掉共享鎖再寄，不握著案件列鎖等 SMTP。
    await db.commit()
    await asyncio.to_thread(adapter.send, to=recipient, subject=_header_safe(subject), body=body)
    _record_delivery(db, outbox_message_id, "email", recipient_key)
    await db.commit()
    return True


async def _forget_old_email(db: AsyncSession, outbox_message_id: uuid.UUID, payload: dict) -> None:
    await db.execute(
        update(OutboxMessage)
        .where(OutboxMessage.id == outbox_message_id)
        .values(payload=without_old_email(payload))
        .execution_options(synchronize_session="fetch")
    )


async def _dispatch_email_changed_notice(
    db: AsyncSession,
    *,
    outbox_message_id: uuid.UUID,
    payload: dict,
    adapter: EmailAdapter | None,
    created_at: datetime | None,
) -> bool:
    """家長改了 Email，寄一封通知到舊信箱（2026-10-22 資安稽核）。不適用（沒設定寄信、太舊、
    案件已匿名化或不在）回傳 False；寄出或略過都把舊信箱從 payload 拿掉，失敗重試才需要它。"""
    recipient_key = f"parent_old_email:{outbox_message_id}"
    # 先看寄過沒：寄出後 ack 前程序中斷、租約過期被重新認領時，payload 已經沒有舊信箱，
    # 要回 True（標 sent），不能落到下面當成不適用標 skipped。
    if await _already_delivered(db, outbox_message_id, "email", recipient_key):
        await _forget_old_email(db, outbox_message_id, payload)
        await db.commit()
        return True
    old_email = payload.get("old_email")
    visit_request = await _load_visit_request(db, payload.get("receipt_id"))
    stale = created_at is not None and datetime.now(timezone.utc) - created_at > EXTERNAL_DELIVERY_STALE_AFTER
    if (
        adapter is None
        or stale
        or not isinstance(old_email, str)
        or not old_email
        or visit_request is None
        or visit_request.anonymized_at is not None
    ):
        await _forget_old_email(db, outbox_message_id, payload)
        return False
    slot = visit_request.slot
    profile = await content_service.published_payload(db, "campus_profile", visit_request.campus_key) or {}
    subject, body = build_email_changed_notice(
        campus_name=await _campus_name(db, visit_request.campus_key),
        slot_date=slot.slot_date if slot else None,
        start_time=slot.start_time if slot else None,
        campus_phone=str(profile.get("phone") or "").strip() or None,
    )
    await db.commit()
    await asyncio.to_thread(adapter.send, to=_header_safe(old_email), subject=_header_safe(subject), body=body)
    _record_delivery(db, outbox_message_id, "email", recipient_key)
    await _forget_old_email(db, outbox_message_id, payload)
    await db.commit()
    return True


async def dispatch_outbox_message(
    db: AsyncSession,
    *,
    outbox_message_id: uuid.UUID,
    campus_key: str,
    kind: str,
    payload: dict,
    adapter: EmailAdapter | None,
    created_at: datetime | None = None,
    line: line_api.LineMessagingClient | None = None,
    admin_origin: str | None = None,
    access_secret: str | None = None,
) -> bool:
    """處理一筆 outbox 訊息：寫站內通知 → 推播校區的 LINE 群組 → 寄信。
    任何一個管道或收件人失敗都讓整筆工作視為失敗，交給 worker 的重試機制
    處理，不會靜默丟失、也不假裝已送出。`line` 為 None 或這校沒有指定
    群組時略過 LINE。

    `adapter` 為 None 代表部署環境沒有設定寄信：站內通知照寫、email 這個
    管道整個略過。原本「未配置」會讓整批 outbox 停著不處理，結果後台連
    站內通知都收不到；等日後設好 SMTP，又會把累積幾個月的舊通知一次寄出。

    重試時以 notification_deliveries 逐一去重：已經成功寄出的收件人不會
    再收到第二封，站內通知也只會寫一筆——原本整筆重試會讓每一輪都多一
    則站內通知、且已收到信的人重複收信。

    `created_at` 是判斷「太舊不再推播寄信」的基準，人工重新排入的訊息由呼叫端
    傳重新排入的時間。定期工作產生的提醒在這裡先重新判斷是否仍然成立（改期、
    取消、已處理），不成立就什麼都不送並回傳 False，其他情況回傳 True。"""
    if kind == PARENT_EMAIL_CHANGED:
        return await _dispatch_email_changed_notice(
            db, outbox_message_id=outbox_message_id, payload=payload, adapter=adapter, created_at=created_at
        )
    if kind in PARENT_KINDS:
        return await _dispatch_parent_email(
            db,
            outbox_message_id=outbox_message_id,
            kind=kind,
            payload=payload,
            adapter=adapter,
            created_at=created_at,
            admin_origin=admin_origin,
            access_secret=access_secret,
        )
    if kind in reminders.REMINDER_KINDS and not await reminders.still_applies(db, kind, payload):
        return False
    label = notification_label(kind, payload)

    if not await _already_delivered(db, outbox_message_id, "inbox", campus_key):
        db.add(
            NotificationInboxItem(
                id=uuid.uuid4(),
                campus_key=campus_key,
                kind=kind,
                payload=payload,
                created_at=datetime.now(timezone.utc),
            )
        )
        _record_delivery(db, outbox_message_id, "inbox", campus_key)
        # 立刻 commit：這是「已經發生的事實」。如果留到整筆結束才提交，
        # 後面任一收件人寄失敗導致 rollback，這則站內通知就會在下一輪
        # 重試時再寫一次。
        await db.commit()

    if created_at is not None and datetime.now(timezone.utc) - created_at > EXTERNAL_DELIVERY_STALE_AFTER:
        return True

    line_error: Exception | None = None
    if line is not None:
        target = await campus_line_target(db, campus_key)
        if target and not await _already_delivered(db, outbox_message_id, "line", target):
            receipt_id = payload.get("receipt_id")
            # 推播當下讀案件：家長改過稱呼就用新的，已匿名化的不帶。
            visit_request = await _load_visit_request(db, receipt_id)
            parent_name = (
                visit_request.parent_name
                if visit_request is not None and visit_request.anonymized_at is None
                else None
            )
            try:
                await line.push_text(
                    target,
                    line_text(label, await _campus_name(db, campus_key), receipt_id, admin_origin, parent_name),
                    key=line_api.retry_key(outbox_message_id, target),
                )
            except (line_api.LinePushError, httpx.HTTPError) as exc:
                # LINE 失敗（月額度用完 429、token 失效 401、bot 被移出群組 400、
                # 逾時）不能擋住 email：先把信寄完，最後再拋出讓整筆重試。重試時
                # 已寄出的收件人由 notification_deliveries 去重，只會補推 LINE。
                logger.warning(
                    "LINE 推播失敗，仍繼續寄信：outbox=%s campus=%s error=%s",
                    outbox_message_id, campus_key, exc,
                )
                line_error = exc
            else:
                _record_delivery(db, outbox_message_id, "line", target)
                await db.commit()

    if adapter is not None:
        await _send_pending_emails(
            db,
            adapter,
            outbox_message_id=outbox_message_id,
            campus_key=campus_key,
            label=label,
            payload=payload,
            admin_origin=admin_origin,
        )
    if line_error is not None:
        raise line_error
    return True


async def _send_pending_emails(
    db: AsyncSession,
    adapter: EmailAdapter,
    *,
    outbox_message_id: uuid.UUID,
    campus_key: str,
    label: str,
    payload: dict,
    admin_origin: str | None,
) -> None:
    recipients = await get_notification_recipients(db, campus_key)
    pending = [
        user for user in recipients
        if not await _already_delivered(db, outbox_message_id, "email", user.email)
    ]
    if not pending:
        return
    subject, body = await email_content(
        db,
        label=label,
        campus_key=campus_key,
        receipt_id=payload.get("receipt_id"),
        admin_origin=admin_origin,
    )
    for user in pending:
        # SMTP 是阻塞 I/O（連線逾時 20 秒）。定期工作跑在 API 的 event loop
        # 上，直接呼叫會讓這段期間所有請求一起卡住。
        await asyncio.to_thread(
            adapter.send,
            to=_header_safe(user.email),
            subject=_header_safe(subject),
            body=body,
        )
        # 寄成功才記，而且立刻 commit——信已經寄出去了，這個事實不能被
        # 後面其他收件人的失敗回滾掉，否則這個人下一輪會再收一封。
        _record_delivery(db, outbox_message_id, "email", user.email)
        await db.commit()
