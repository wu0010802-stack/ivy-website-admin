"""群組結果卡的招生結果欄位按鈕（設計 §5.1）。

在群組按「已到場」→「確認」後，結果卡多出預繳結果、未預繳原因、來源分類、搭交通車的按鈕；每按一次只寫一個欄位：
已預繳走漏斗轉換（funnel.transition，寫 deposit_added），其餘走 records.update_visit（寫 details_updated）。
每次先鎖招生訪視列重讀，再驗群組授權（訪視校區在群組服務的校區內）、未匿名化、未退出、由官網預約建立。
回覆都用 reply（不計則數）；LINE API 用 httpx.MockTransport 模擬（沿用 test_line_group_attend 的工具）。"""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select, update

from app.ad_conversions.models import AdConversionJob
from app.admissions import constants, funnel, records
from app.admissions.models import RecruitmentEventLog, RecruitmentVisit
from app.notifications import line_group_actions as actions
from app.notifications.models import LineCampusTarget, LineGroup
from app.operations.audit_service import LINE_GROUP_ACTIONS, LINE_GROUP_PRIVATE_KEYS, LINE_GROUP_SEARCH_KEYS
from app.operations.models import AuditLogEntry
from tests.test_line_group_attend import (
    FREE_GROUP, HQ_GROUP, MEMBER, YIHUA_GROUP, _case, _groups, _last, _last_texts, _ok, _postback, _postback_datas, _press,
)
from tests.test_line_integrations_20261116 import FakeLine, _webhook, fake_line  # noqa: F401  (fixture)

pytestmark = pytest.mark.usefixtures("booking_consent")

MINGHUA_GROUP = "C" + "d" * 32
FIELD_ACTION = "line.group.recruitment_field"


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _all_groups(app) -> None:
    """test_line_group_attend 的三個群組（義華、總部、沒綁校）＋明華校區群組。"""
    await _groups(app)
    now = _now()
    async with app.state.session_factory() as db:
        db.add(LineGroup(target_id=MINGHUA_GROUP, source_type="group", first_seen_at=now, last_seen_at=now, verified_at=now))
        await db.flush()
        db.add(LineCampusTarget(campus_key="minghua", target_id=MINGHUA_GROUP, updated_at=now))
        await db.commit()


async def _attended(app, admin_client, public_client, fake_line: FakeLine, campus: str = "yihua", **case) -> tuple[str, str]:
    """跑一次 Task 9 的「已到場 → 確認」（總部群組按，哪一校都能按），回傳（案件 id, 招生訪視 id）。"""
    receipt = await _case(app, admin_client, public_client, campus, **case)
    await _press(app, _postback(_ok(app, actions.ATTEND_OK, receipt), HQ_GROUP))
    async with app.state.session_factory() as db:
        rv_id = await db.scalar(select(RecruitmentVisit.id).where(RecruitmentVisit.visit_request_id == uuid.UUID(receipt)))
    assert rv_id is not None
    # 結果卡上的按鈕就是這些動作。
    datas = _postback_datas(_last(fake_line))
    assert actions.encode(actions.RF_DEPOSIT, str(rv_id)) in datas
    return receipt, str(rv_id)


async def _visit(app, rv_id: str) -> RecruitmentVisit:
    async with app.state.session_factory() as db:
        return await db.get(RecruitmentVisit, uuid.UUID(rv_id))


async def _set(app, rv_id: str, **values) -> None:
    async with app.state.session_factory() as db:
        await db.execute(update(RecruitmentVisit).where(RecruitmentVisit.id == uuid.UUID(rv_id)).values(**values))
        await db.commit()


async def _field_audits(app) -> list[AuditLogEntry]:
    async with app.state.session_factory() as db:
        return list(
            (await db.execute(select(AuditLogEntry).where(AuditLogEntry.action == FIELD_ACTION).order_by(AuditLogEntry.created_at)))
            .scalars()
        )


async def _events(app, rv_id: str, event_type: str | None = None) -> list[RecruitmentEventLog]:
    stmt = select(RecruitmentEventLog).where(RecruitmentEventLog.recruitment_visit_id == uuid.UUID(rv_id))
    if event_type is not None:
        stmt = stmt.where(RecruitmentEventLog.event_type == event_type)
    async with app.state.session_factory() as db:
        return list((await db.execute(stmt.order_by(RecruitmentEventLog.created_at))).scalars())


def _texts(fake_line: FakeLine, n: int) -> list[str]:
    return [r["body"]["messages"][0]["text"] for r in fake_line.replies[-n:]]


def _rf(action: str, rv_id: str, *args: str) -> str:
    return actions.encode(action, rv_id, *args)


def _postback_labels(node) -> list[str]:
    """卡片上 postback 按鈕的文字（依出現順序）。"""
    found: list[str] = []
    if isinstance(node, dict):
        action = node.get("action")
        if isinstance(action, dict) and action.get("type") == "postback":
            found.append(action["label"])
        for value in node.values():
            found += _postback_labels(value)
    elif isinstance(node, list):
        for item in node:
            found += _postback_labels(item)
    return found


def _deposit_ok(app, rv_id: str, *, now: datetime | None = None) -> str:
    """「已預繳」確認卡上「確認」按鈕的 data（帶有效 token）。"""
    token = actions.make_token(app.state.settings.session_secret, actions.RF_DEPOSIT_OK, rv_id, now=now or _now())
    return actions.encode(actions.RF_DEPOSIT_OK, rv_id, token)


async def _deposit_jobs(app, receipt: str) -> int:
    async with app.state.session_factory() as db:
        return await db.scalar(
            select(func.count()).select_from(AdConversionJob).where(
                AdConversionJob.visit_request_id == uuid.UUID(receipt), AdConversionJob.event == "deposit_paid"
            )
        )


# ---- 已預繳（二次確認：轉換會排廣告轉換回傳，送出就收不回）---------------------------------------------------


async def test_deposit_button_moves_funnel_and_logs_deposit_added(app, fake_line, admin_client, public_client):
    await _all_groups(app)
    receipt, rv_id = await _attended(app, admin_client, public_client, fake_line)
    before = await _visit(app, rv_id)
    assert before.has_deposit is False and before.version == 1

    # 按「已預繳」：只回確認卡，不寫入、不排廣告回傳。
    await _press(app, _postback(_rf(actions.RF_DEPOSIT, rv_id)))
    card = _last(fake_line)
    assert card["type"] == "flex"
    assert card["altText"] == "請確認已預繳" and "陳媽媽" not in card["altText"]
    assert "確認陳媽媽已預繳？" in _last_texts(fake_line)
    [ok_data] = [d for d in _postback_datas(card) if d.startswith(f"ivy:{actions.RF_DEPOSIT_OK}:{rv_id}:")]
    assert actions.encode(actions.CANCEL) in _postback_datas(card)
    visit = await _visit(app, rv_id)
    assert visit.has_deposit is False and visit.version == 1
    assert await _deposit_jobs(app, receipt) == 0
    assert await _events(app, rv_id, "deposit_added") == [] and await _field_audits(app) == []

    # 按確認卡上的「確認」：走漏斗轉換寫入。
    await _press(app, _postback(ok_data))
    assert _last(fake_line) == {"type": "text", "text": "已記錄：預繳結果 已預繳"}
    visit = await _visit(app, rv_id)
    assert visit.has_deposit is True and visit.version == 2
    # 走漏斗轉換（同後台「標記預繳」）：deposit_added 一筆、操作者為空。
    [event] = await _events(app, rv_id, "deposit_added")
    assert event.actor_user_id is None and (event.from_stage, event.to_stage) == ("visited", "deposited")
    # 轉換的其他副作用照舊：預繳廣告回傳排入一筆。
    assert await _deposit_jobs(app, receipt) == 1
    [audit] = await _field_audits(app)
    assert audit.actor_user_id is None and audit.target_type == "recruitment_visit" and audit.target_id == rv_id
    assert audit.campus_key == "yihua"
    assert audit.metadata_json == {"field": "has_deposit", "value": True, "group_id": YIHUA_GROUP, "line_user_id": MEMBER}

    # 同一個確認重放兩次（token 還沒過期）、再按「已預繳」：都回已是預繳狀態，不再寫、不多排回傳。
    await _press(app, _postback(ok_data, user=None), _postback(ok_data), _postback(_rf(actions.RF_DEPOSIT, rv_id)))
    assert _texts(fake_line, 3) == [actions.ALREADY_DEPOSITED_REPLY] * 3
    assert actions.ALREADY_DEPOSITED_REPLY == "已是預繳狀態"
    assert (await _visit(app, rv_id)).version == 2
    assert len(await _events(app, rv_id, "deposit_added")) == 1
    assert len(await _field_audits(app)) == 1
    assert await _deposit_jobs(app, receipt) == 1


async def test_deposit_confirm_with_expired_or_forged_token_does_not_write(app, fake_line, admin_client, public_client):
    await _all_groups(app)
    receipt, rv_id = await _attended(app, admin_client, public_client, fake_line)
    secret = app.state.settings.session_secret
    other_rv = str(uuid.uuid4())
    exp = int(_now().timestamp()) + 200
    bad = [
        _deposit_ok(app, rv_id, now=_now() - timedelta(seconds=301)),  # 過期
        actions.encode(actions.RF_DEPOSIT_OK, rv_id, f"{exp}.{'0' * 16}"),  # 簽章偽造
        actions.encode(actions.RF_DEPOSIT_OK, rv_id, "garbage"),
        actions.encode(actions.RF_DEPOSIT_OK, rv_id, ""),
        # 別的動作（已到場）的 token、綁別筆招生訪視的 token 都不能拿來確認預繳。
        actions.encode(actions.RF_DEPOSIT_OK, rv_id, actions.make_token(secret, actions.ATTEND_OK, rv_id, now=_now())),
        actions.encode(actions.RF_DEPOSIT_OK, rv_id, actions.make_token(secret, actions.RF_DEPOSIT_OK, other_rv, now=_now())),
    ]
    await _press(app, *[_postback(data) for data in bad])
    assert _texts(fake_line, len(bad)) == [actions.EXPIRED_REPLY] * len(bad)
    # 參數個數不對、id 不是 UUID（即使 token 對得上）：不是我們編的，不回應。
    replies = len(fake_line.replies)
    await _press(
        app,
        _postback(f"ivy:{actions.RF_DEPOSIT_OK}:{rv_id}"),
        _postback(_deposit_ok(app, "not-a-uuid")),
    )
    assert len(fake_line.replies) == replies
    visit = await _visit(app, rv_id)
    assert visit.has_deposit is False and visit.version == 1
    assert await _deposit_jobs(app, receipt) == 0
    assert await _field_audits(app) == [] and await _events(app, rv_id, "deposit_added") == []


async def test_deposit_confirm_from_other_campus_group_is_refused(app, fake_line, admin_client, public_client):
    await _all_groups(app)
    receipt, rv_id = await _attended(app, admin_client, public_client, fake_line)
    # 明華群組拿到（例如被轉貼的）有效確認也不能寫：鎖列後重驗授權。
    await _press(app, _postback(_deposit_ok(app, rv_id), MINGHUA_GROUP), _postback(_rf(actions.RF_DEPOSIT, rv_id), MINGHUA_GROUP))
    assert _texts(fake_line, 2) == [actions.NO_PERMISSION_REPLY] * 2
    assert (await _visit(app, rv_id)).has_deposit is False
    assert await _deposit_jobs(app, receipt) == 0 and await _field_audits(app) == []
    # 總部群組可以。
    await _press(app, _postback(_deposit_ok(app, rv_id), HQ_GROUP))
    assert (await _visit(app, rv_id)).has_deposit is True
    assert await _deposit_jobs(app, receipt) == 1
    [audit] = await _field_audits(app)
    assert audit.metadata_json["group_id"] == HQ_GROUP


# ---- 未預繳原因 --------------------------------------------------------------------------------------------


async def test_no_deposit_reason_written_by_index_and_card_covers_all_reasons(app, fake_line, admin_client, public_client):
    await _all_groups(app)
    _, rv_id = await _attended(app, admin_client, public_client, fake_line)

    # 按「未預繳」只回原因卡、不寫入；八個原因照 NO_DEPOSIT_REASONS 的順序與字面，data 帶索引。
    await _press(app, _postback(_rf(actions.RF_NODEP_ASK, rv_id)))
    card = _last(fake_line)
    assert card["type"] == "flex"
    assert _postback_datas(card) == [_rf(actions.RF_NODEP, rv_id, str(i)) for i in range(len(constants.NO_DEPOSIT_REASONS))]
    assert _postback_labels(card) == list(constants.NO_DEPOSIT_REASONS)
    assert "未預繳原因" in " ".join(_last_texts(fake_line))
    assert (await _visit(app, rv_id)).version == 1
    assert await _field_audits(app) == []

    await _press(app, _postback(_rf(actions.RF_NODEP, rv_id, "3")))
    visit = await _visit(app, rv_id)
    assert visit.no_deposit_reason == constants.NO_DEPOSIT_REASONS[3] == "距離／地點因素"
    assert visit.has_deposit is False and visit.version == 2
    assert _last(fake_line)["text"] == "已記錄：未預繳原因 距離／地點因素"
    [event] = await _events(app, rv_id, "details_updated")
    assert event.actor_user_id is None and event.metadata_json == {"fields": ["no_deposit_reason"]}
    # 稽核只記索引，不記原因文字。
    [audit] = await _field_audits(app)
    assert audit.metadata_json == {"field": "no_deposit_reason", "value": 3, "group_id": YIHUA_GROUP, "line_user_id": MEMBER}

    # 同一個原因再按一次：值沒變，不加版本、不寫歷程與稽核，照樣回已記錄。
    await _press(app, _postback(_rf(actions.RF_NODEP, rv_id, "3")))
    assert _last(fake_line)["text"] == "已記錄：未預繳原因 距離／地點因素"
    assert (await _visit(app, rv_id)).version == 2
    assert len(await _events(app, rv_id, "details_updated")) == 1 and len(await _field_audits(app)) == 1
    # 換一個原因可以更正。
    await _press(app, _postback(_rf(actions.RF_NODEP, rv_id, "7")))
    visit = await _visit(app, rv_id)
    assert visit.no_deposit_reason == "費用考量" and visit.version == 3
    assert [a.metadata_json["value"] for a in await _field_audits(app)] == [3, 7]


# ---- 來源分類、交通車 ----------------------------------------------------------------------------------------


async def test_source_category_and_bus_written(app, fake_line, admin_client, public_client):
    await _all_groups(app)
    _, rv_id = await _attended(app, admin_client, public_client, fake_line)
    # 分類卡同後台表單只列六項短標籤（2026-10-06 裁定），索引對這六項，不是九類。
    six = ["在校生弟妹", "畢業生弟妹", "家長介紹／社區招生", "自報生（廣告、鄰居、網路、活動）", "邀約來園", "舊生復學"]

    await _press(app, _postback(_rf(actions.RF_SOURCE_ASK, rv_id)))
    assert _postback_datas(_last(fake_line)) == [_rf(actions.RF_SOURCE, rv_id, str(i)) for i in range(6)]
    assert _postback_labels(_last(fake_line)) == six
    assert (await _visit(app, rv_id)).version == 1

    await _press(app, _postback(_rf(actions.RF_SOURCE, rv_id, "3")))
    assert (await _visit(app, rv_id)).source_category == "self_report"
    assert _last(fake_line)["text"] == "已記錄：來源分類 自報生（廣告、鄰居、網路、活動）"
    # 索引 2 在六項是「家長介紹」（九類的第 3 個是畢業生弟妹）。
    await _press(app, _postback(_rf(actions.RF_SOURCE, rv_id, "2")))
    assert (await _visit(app, rv_id)).source_category == "referral"
    assert _last(fake_line)["text"] == "已記錄：來源分類 家長介紹／社區招生"

    await _press(app, _postback(_rf(actions.RF_BUS, rv_id, "1")))
    visit = await _visit(app, rv_id)
    assert visit.rides_bus is True
    assert _last(fake_line)["text"] == "已記錄：搭交通車 搭"
    await _press(app, _postback(_rf(actions.RF_BUS, rv_id, "0"), user=None))
    visit = await _visit(app, rv_id)
    assert visit.rides_bus is False and visit.version == 5
    assert _last(fake_line)["text"] == "已記錄：搭交通車 不搭"

    assert [a.metadata_json for a in await _field_audits(app)] == [
        {"field": "source_category", "value": "self_report", "group_id": YIHUA_GROUP, "line_user_id": MEMBER},
        {"field": "source_category", "value": "referral", "group_id": YIHUA_GROUP, "line_user_id": MEMBER},
        {"field": "rides_bus", "value": True, "group_id": YIHUA_GROUP, "line_user_id": MEMBER},
        {"field": "rides_bus", "value": False, "group_id": YIHUA_GROUP},
    ]
    assert [e.metadata_json for e in await _events(app, rv_id, "details_updated")] == [
        {"fields": ["source_category"]}, {"fields": ["source_category"]}, {"fields": ["rides_bus"]}, {"fields": ["rides_bus"]},
    ]


async def test_not_deposit_after_deposit_is_refused(app, fake_line, admin_client, public_client):
    await _all_groups(app)
    _, rv_id = await _attended(app, admin_client, public_client, fake_line)
    await _press(app, _postback(_deposit_ok(app, rv_id)))
    assert (await _visit(app, rv_id)).has_deposit is True

    # 按「未預繳」或舊原因卡上的原因：LINE 不提供取消預繳。
    await _press(app, _postback(_rf(actions.RF_NODEP_ASK, rv_id)), _postback(_rf(actions.RF_NODEP, rv_id, "0")))
    assert _texts(fake_line, 2) == [actions.DEPOSITED_FIX_IN_ADMIN_REPLY] * 2
    assert actions.DEPOSITED_FIX_IN_ADMIN_REPLY == "已是預繳狀態，要更正請到後台"
    visit = await _visit(app, rv_id)
    assert visit.has_deposit is True and visit.no_deposit_reason is None and visit.version == 2
    assert [a.metadata_json["field"] for a in await _field_audits(app)] == ["has_deposit"]
    assert await _events(app, rv_id, "deposit_removed") == []


# ---- 偽造的資料 ------------------------------------------------------------------------------------------


async def test_forged_index_and_nonint_are_rejected_without_write(app, fake_line, admin_client, public_client):
    await _all_groups(app)
    _, rv_id = await _attended(app, admin_client, public_client, fake_line)
    replies_before = len(fake_line.replies)
    bad = [
        _rf(actions.RF_NODEP, rv_id, "99"),
        _rf(actions.RF_NODEP, rv_id, "-1"),
        _rf(actions.RF_NODEP, rv_id, "abc"),
        _rf(actions.RF_NODEP, rv_id, str(len(constants.NO_DEPOSIT_REASONS))),
        _rf(actions.RF_NODEP, rv_id, "03"),
        _rf(actions.RF_NODEP, rv_id, "３"),  # 全形數字 int() 吃得下，不能當成 3
        _rf(actions.RF_NODEP, rv_id, ""),
        _rf(actions.RF_SOURCE, rv_id, "99"),
        _rf(actions.RF_SOURCE, rv_id, "-1"),
        _rf(actions.RF_SOURCE, rv_id, "abc"),
        _rf(actions.RF_SOURCE, rv_id, "6"),  # 六項之外（九類時代的索引 6～8 也不再有效）
        _rf(actions.RF_SOURCE, rv_id, "8"),
        _rf(actions.RF_BUS, rv_id, "2"),
        _rf(actions.RF_BUS, rv_id, "yes"),
        _rf(actions.RF_BUS, rv_id, "true"),
        _rf(actions.RF_BUS, rv_id, ""),
    ]
    await _press(app, *[_postback(data) for data in bad])
    assert _texts(fake_line, len(bad)) == [actions.INVALID_CHOICE_REPLY] * len(bad)
    assert actions.INVALID_CHOICE_REPLY == "這個選項已失效，請重新選擇"
    assert len(fake_line.replies) == replies_before + len(bad)

    # 招生訪視 id 不是 UUID、參數個數不對：當作不是我們編的，不回應。找不到這筆：回不能填。
    missing = str(uuid.uuid4())
    await _press(
        app,
        _postback(f"ivy:{actions.RF_NODEP}:not-a-uuid:1"),
        _postback(f"ivy:{actions.RF_DEPOSIT}:not-a-uuid"),
        _postback(f"ivy:{actions.RF_NODEP}:{rv_id}"),
        _postback(f"ivy:{actions.RF_DEPOSIT}:{rv_id}:1"),
        _postback(f"ivy:{actions.RF_BUS}:{rv_id}"),
        _postback(f"ivy:{actions.RF_SOURCE_ASK}"),
        _postback(_rf(actions.RF_BUS, missing, "1")),
    )
    assert len(fake_line.replies) == replies_before + len(bad) + 1
    assert _last(fake_line)["text"] == actions.CANNOT_FILL_REPLY == "這筆已不能在群組填寫"

    visit = await _visit(app, rv_id)
    assert visit.version == 1 and visit.no_deposit_reason is None and visit.source_category is None
    assert visit.rides_bus is False and visit.has_deposit is False
    assert await _field_audits(app) == []
    assert [e.event_type for e in await _events(app, rv_id)] == ["created"]


# ---- 授權與不能填的訪視 ----------------------------------------------------------------------------------


async def test_other_campus_and_anonymized_and_withdrawn_are_refused(app, fake_line, admin_client, public_client):
    await _all_groups(app)
    _, rv_id = await _attended(app, admin_client, public_client, fake_line)
    every = [
        _rf(actions.RF_DEPOSIT, rv_id),
        _deposit_ok(app, rv_id),
        _rf(actions.RF_NODEP_ASK, rv_id),
        _rf(actions.RF_NODEP, rv_id, "0"),
        _rf(actions.RF_SOURCE_ASK, rv_id),
        _rf(actions.RF_SOURCE, rv_id, "0"),
        _rf(actions.RF_BUS, rv_id, "1"),
    ]
    # 明華群組按義華的訪視：沒有權限（連原因卡、分類卡都不給）。
    await _press(app, *[_postback(data, MINGHUA_GROUP) for data in every])
    assert _texts(fake_line, len(every)) == [actions.NO_PERMISSION_REPLY] * len(every)
    replies = len(fake_line.replies)
    # 沒綁任何校區的群組：不回應。
    await _press(app, *[_postback(data, FREE_GROUP) for data in every])
    assert len(fake_line.replies) == replies
    visit = await _visit(app, rv_id)
    assert visit.version == 1 and visit.has_deposit is False and visit.rides_bus is False
    assert await _field_audits(app) == []

    # 總部群組服務所有校區：可以填。
    await _press(app, _postback(_rf(actions.RF_BUS, rv_id, "1"), HQ_GROUP))
    assert (await _visit(app, rv_id)).rides_bus is True
    [audit] = await _field_audits(app)
    assert audit.metadata_json["group_id"] == HQ_GROUP and audit.campus_key == "yihua"

    # 已退出：不能在群組填（別校群組仍只看到沒有權限，不透露狀態）。
    await _set(app, rv_id, withdrawn_at=_now(), withdrawn_from="deposited", follow_up_at=None)
    await _press(app, *[_postback(data) for data in every])
    assert _texts(fake_line, len(every)) == [actions.CANNOT_FILL_REPLY] * len(every)
    await _press(app, _postback(_rf(actions.RF_BUS, rv_id, "0"), MINGHUA_GROUP))
    assert _last(fake_line)["text"] == actions.NO_PERMISSION_REPLY

    # 已匿名化。
    await _set(app, rv_id, withdrawn_at=None, withdrawn_from=None, anonymized_at=_now())
    await _press(app, *[_postback(data) for data in every])
    assert _texts(fake_line, len(every)) == [actions.CANNOT_FILL_REPLY] * len(every)

    # 不是由官網預約建立（visit_request_id 為空，例如手動新增或預約被刪）。
    await _set(app, rv_id, anonymized_at=None, visit_request_id=None)
    await _press(app, *[_postback(data) for data in every])
    assert _texts(fake_line, len(every)) == [actions.CANNOT_FILL_REPLY] * len(every)

    visit = await _visit(app, rv_id)
    assert visit.version == 2 and visit.rides_bus is True and visit.has_deposit is False
    assert visit.no_deposit_reason is None and visit.source_category is None
    assert len(await _field_audits(app)) == 1


async def test_admissions_disabled_refuses_field_buttons(app, fake_line, admin_client, public_client):
    """招生入學關閉時後台的招生 API 是 404；舊卡片上的按鈕也不能繞過開關寫入。"""
    await _all_groups(app)
    _, rv_id = await _attended(app, admin_client, public_client, fake_line)
    app.state.settings.admissions_enabled = False
    await _press(
        app,
        _postback(_rf(actions.RF_DEPOSIT, rv_id)),
        _postback(_deposit_ok(app, rv_id)),
        _postback(_rf(actions.RF_SOURCE_ASK, rv_id)),
    )
    assert _texts(fake_line, 3) == [actions.CANNOT_FILL_REPLY] * 3
    visit = await _visit(app, rv_id)
    assert visit.has_deposit is False and visit.version == 1
    assert await _field_audits(app) == []


# ---- 版本衝突 --------------------------------------------------------------------------------------------


def _bumping(real, *, times: int):
    """包住 records.update_visit／funnel.transition：前 times 次呼叫前，先把資料庫的 version 加一並讀回訪視，
    模擬「讀到訪視之後、寫入之前，別人剛好改了這筆」。

    這裡不能真的開另一個 session 去改：處理器已用 SELECT … FOR UPDATE 鎖住這列，另一個 session 的 UPDATE
    會一直等到處理器的交易結束（處理器又在等這個呼叫回來，等於自己卡死）。所以在處理器自己的交易裡改，
    效果相同：真正的 update_visit／transition 比對 version 時看到不一致，丟 VersionConflict。"""
    calls = {"n": 0}

    async def wrapper(db, visit, **kwargs):
        calls["n"] += 1
        if calls["n"] <= times:
            await db.execute(
                update(RecruitmentVisit).where(RecruitmentVisit.id == visit.id).values(version=RecruitmentVisit.version + 1)
            )
            await db.refresh(visit, attribute_names=["version"])
        return await real(db, visit, **kwargs)

    return wrapper, calls


async def test_version_conflict_retries_once(app, fake_line, admin_client, public_client, monkeypatch):
    await _all_groups(app)
    _, rv_id = await _attended(app, admin_client, public_client, fake_line)
    real_update, real_transition = records.update_visit, funnel.transition

    # 第一次衝突：重讀一次再寫，成功。
    wrapper, calls = _bumping(real_update, times=1)
    monkeypatch.setattr(records, "update_visit", wrapper)
    await _press(app, _postback(_rf(actions.RF_BUS, rv_id, "1")))
    assert calls["n"] == 2
    assert _last(fake_line)["text"] == "已記錄：搭交通車 搭"
    visit = await _visit(app, rv_id)
    assert visit.rides_bus is True and visit.version == 3  # 別人加的 1＋這次寫入的 1
    assert len(await _field_audits(app)) == 1

    # 重讀後仍衝突：不再試，回請再按一次，什麼都沒寫（連模擬的版本變動一起回滾）。
    wrapper, calls = _bumping(real_update, times=99)
    monkeypatch.setattr(records, "update_visit", wrapper)
    await _press(app, _postback(_rf(actions.RF_SOURCE, rv_id, "0")))
    assert calls["n"] == 2
    assert _last(fake_line)["text"] == actions.VERSION_CONFLICT_REPLY == "資料剛被更新，請再按一次"
    visit = await _visit(app, rv_id)
    assert visit.source_category is None and visit.version == 3
    assert len(await _field_audits(app)) == 1

    # 已預繳的確認（漏斗轉換）也一樣重試一次；按「已預繳」本身只回確認卡，不呼叫轉換。
    wrapper, calls = _bumping(real_transition, times=1)
    monkeypatch.setattr(funnel, "transition", wrapper)
    await _press(app, _postback(_rf(actions.RF_DEPOSIT, rv_id)))
    assert calls["n"] == 0 and _last(fake_line)["type"] == "flex"
    await _press(app, _postback(_deposit_ok(app, rv_id)))
    assert calls["n"] == 2
    assert _last(fake_line)["text"] == "已記錄：預繳結果 已預繳"
    visit = await _visit(app, rv_id)
    assert visit.has_deposit is True and visit.version == 5
    assert len(await _events(app, rv_id, "deposit_added")) == 1


async def test_two_presses_at_once_are_serialized_by_row_lock(app, fake_line, admin_client, public_client):
    """兩個人同時按不同欄位：列鎖讓第二個等第一個 commit，重讀到新版本後再寫，兩個欄位都寫進去。"""
    await _all_groups(app)
    _, rv_id = await _attended(app, admin_client, public_client, fake_line)
    first, second = await asyncio.gather(
        _webhook(app, [_postback(_rf(actions.RF_BUS, rv_id, "1"))], account="main"),
        _webhook(app, [_postback(_rf(actions.RF_SOURCE, rv_id, "0"), HQ_GROUP)], account="main"),
    )
    assert first.status_code == 200 and second.status_code == 200
    visit = await _visit(app, rv_id)
    assert visit.rides_bus is True and visit.source_category == "sibling_current" and visit.version == 3
    assert sorted(_texts(fake_line, 2)) == sorted(["已記錄：搭交通車 搭", "已記錄：來源分類 在校生弟妹"])
    assert len(await _field_audits(app)) == 2


# ---- 稽核與招生歷程不含自由文字 ----------------------------------------------------------------------------


async def test_audit_and_event_metadata_contain_no_free_text(app, fake_line, admin_client, public_client):
    await _all_groups(app)
    _, rv_id = await _attended(app, admin_client, public_client, fake_line)
    notes = "家長備註：想了解才藝課 0912000111"
    response = "電訪回應：下週再聯絡"
    await _set(app, rv_id, notes=notes, parent_response=response)

    await _press(
        app,
        _postback(_rf(actions.RF_NODEP, rv_id, "2")),
        _postback(_rf(actions.RF_SOURCE, rv_id, "0")),
        _postback(_rf(actions.RF_BUS, rv_id, "1")),
        _postback(_deposit_ok(app, rv_id), user=None),
    )
    audits = await _field_audits(app)
    assert len(audits) == 4
    allowed_values = {"has_deposit": (bool,), "no_deposit_reason": (int,), "source_category": (str,), "rides_bus": (bool,)}
    for audit in audits:
        meta = audit.metadata_json
        assert set(meta) <= {"field", "value", "group_id", "line_user_id"}
        # 操作紀錄給分校帳號看時拿掉群組 ID 與 userId、其餘鍵要搜得到（operations/audit_service）。
        assert audit.action in LINE_GROUP_ACTIONS
        assert set(meta) <= set(LINE_GROUP_SEARCH_KEYS) | LINE_GROUP_PRIVATE_KEYS
        assert {"field", "value", "group_id"} <= set(meta)
        assert isinstance(meta["value"], allowed_values[meta["field"]])
        if meta["field"] == "source_category":
            assert meta["value"] in constants.SOURCE_CATEGORIES  # 代碼，不是按鈕文字
        dumped = json.dumps(meta, ensure_ascii=False)
        assert notes not in dumped and response not in dumped
        # 原因只記索引，原因文字不進稽核。
        assert not any(reason in dumped for reason in constants.NO_DEPOSIT_REASONS)
    assert [a.metadata_json["value"] for a in audits if a.metadata_json["field"] == "no_deposit_reason"] == [2]

    events = await _events(app, rv_id)
    assert [e.event_type for e in events] == ["created", "details_updated", "details_updated", "details_updated", "deposit_added"]
    for event in events[1:]:
        assert event.actor_user_id is None and event.reason is None
        dumped = json.dumps(event.metadata_json, ensure_ascii=False)
        assert notes not in dumped and response not in dumped
        assert "家長" not in dumped and "0912" not in dumped
        assert not any(reason in dumped for reason in constants.NO_DEPOSIT_REASONS)
    assert [e.metadata_json for e in events[1:4]] == [
        {"fields": ["no_deposit_reason"]}, {"fields": ["source_category"]}, {"fields": ["rides_bus"]},
    ]
    visit = await _visit(app, rv_id)
    assert visit.notes == notes and visit.parent_response == response
