"""招生訪視明細與未預繳名單的 CSV 匯出（2026-10-03 匯出擴充，10-06 對 main 修訂）。

含孩子姓名、電話、地址：要 admissions.read＋校區範圍＋「匯出個資」授權（booking.export），
每次寫稽核，metadata 只記套用了哪些篩選。開關關閉時 404（test_admissions_booking_link.py）。
欄位和畫面一致（37 欄，含來源分類、帶參觀老師、娃娃車、追蹤與負責人）；只有地址分析同意不進 CSV。"""

from __future__ import annotations

import csv
import io
import uuid
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import event, select, update

from app.admissions import constants, download
from app.admissions.constants import ANONYMIZED_TEXT
from app.admissions.models import RecruitmentVisit
from app.auth.models import User
from app.common import csv_export
from app.common.timezones import today_local
from app.operations.models import AuditLogEntry
from tests.admissions_helpers import (  # noqa: F401
    ADMISSIONS,
    API,
    campus_admin_yihua_client,
    complete,
    create_record,
    reception_yihua_client,
    record_at_stage,
    started_booking,
)

RECORDS_EXPORT = f"{ADMISSIONS}/records/export"

# 欄位順序是對園方的承諾（Excel 欄位、樞紐分析），測試寫死一份，不引用實作的常數。
EXPECTED_HEADERS = [
    "校區", "月份", "序號", "參觀日期", "幼生姓名", "英文名字", "生日", "班別", "入學學年", "入學學期",
    "階段", "預繳", "已註冊", "聯絡人", "電話", "地址", "父親職業", "母親職業", "來源", "來源分類",
    "家長介紹", "帶參觀老師", "搭娃娃車", "收預繳人員", "未預繳原因", "未預繳說明", "保留座位", "註冊日期",
    "轉學期", "退出原因", "下次聯絡", "負責人", "最近聯絡", "官網預約", "電訪回應", "備註", "建檔時間",
]


def _csv(resp) -> tuple[list[str], list[dict]]:
    assert resp.status_code == 200, resp.text
    assert resp.content.startswith(csv_export.BOM.encode())
    assert resp.headers["content-type"] == "text/csv; charset=utf-8"
    assert resp.headers["cache-control"] == "private, no-store"
    text = resp.content.decode("utf-8-sig")
    return next(csv.reader(io.StringIO(text))), list(csv.DictReader(io.StringIO(text)))


def _names(rows: list[dict]) -> list[str]:
    return [row["幼生姓名"] for row in rows]


async def _set(db_session, record: dict, **values) -> None:
    """直接改資料庫欄位（API 不收的欄位：district、追蹤時間、建檔時間…）。"""
    await db_session.execute(
        update(RecruitmentVisit).where(RecruitmentVisit.id == uuid.UUID(record["id"])).values(**values)
    )
    await db_session.commit()


def test_headers_are_the_37_screen_columns_in_order():
    assert list(download.RECORD_HEADERS) == EXPECTED_HEADERS
    assert len(EXPECTED_HEADERS) == 37
    assert len(set(EXPECTED_HEADERS)) == 37


@pytest.mark.asyncio
async def test_records_export_follows_list_filters(admin_client):
    await create_record(admin_client, child_name="王小明", phone="0912345601", contact_name="王媽媽")
    await create_record(admin_client, child_name="李小華", grade="中班")
    await record_at_stage(admin_client, "deposited", child_name="陳小美")

    resp = await admin_client.get(f"{RECORDS_EXPORT}?campus_key=yihua")
    header, rows = _csv(resp)
    assert header == EXPECTED_HEADERS
    assert all(len(row) == 37 for row in csv.reader(io.StringIO(resp.content.decode("utf-8-sig"))))
    assert f'filename="admissions-records-yihua-{today_local():%Y%m%d}.csv"' in resp.headers["content-disposition"]
    assert set(_names(rows)) == {"王小明", "李小華", "陳小美"}

    # 和明細列表同一組篩選：畫面上篩好什麼，匯出的就是那一批。
    _, middle = _csv(await admin_client.get(f"{RECORDS_EXPORT}?campus_key=yihua&grade=中班"))
    assert _names(middle) == ["李小華"]
    _, deposited = _csv(await admin_client.get(f"{RECORDS_EXPORT}?campus_key=yihua&stage=deposited"))
    assert _names(deposited) == ["陳小美"]
    _, no_deposit = _csv(await admin_client.get(f"{RECORDS_EXPORT}?campus_key=yihua&has_deposit=false"))
    assert sorted(_names(no_deposit)) == ["李小華", "王小明"]
    # 0 筆是只有表頭的檔案，不是錯誤。
    header_only, none = _csv(await admin_client.get(f"{RECORDS_EXPORT}?campus_key=yihua&grade=大班"))
    assert header_only == EXPECTED_HEADERS
    assert none == []


@pytest.mark.asyncio
async def test_records_export_follows_list_order(admin_client):
    await create_record(admin_client, child_name="較早的", visit_date="2026-09-01")
    await create_record(admin_client, child_name="較晚的", visit_date="2026-09-20")
    await create_record(admin_client, child_name="同日先建", visit_date="2026-09-10")
    await create_record(admin_client, child_name="同日後建", visit_date="2026-09-10")
    _, rows = _csv(await admin_client.get(f"{RECORDS_EXPORT}?campus_key=yihua"))
    listing = await admin_client.get(f"{ADMISSIONS}/records?campus_key=yihua&page_size=100")
    # 參觀日期新到舊、同日依建立時間新到舊（同明細列表的排序）。
    assert _names(rows) == [item["child_name"] for item in listing.json()] == ["較晚的", "同日後建", "同日先建", "較早的"]


@pytest.mark.asyncio
async def test_records_export_values_match_the_screen(admin_client, db_session):
    full = await create_record(
        admin_client,
        child_name="王小明",
        english_name="Ming",
        grade="小班",
        phone="0912345601",
        contact_name="王媽媽",
        father_occupation="工程師",
        mother_occupation="教師",
        address="高雄市三民區大昌路1號",
        source="親友介紹",
        source_category="sibling_current",
        referrer="林媽媽",
        tour_guide_name="王老師、李老師",
        rides_bus=True,
        deposit_collector="陳會計",
        no_deposit_reason="費用考量",
        no_deposit_reason_detail="想再比較",
        transfer_term=True,
        parent_response="下週再回覆",
        notes="第一行\n第二行，有逗號",
    )
    await _set(
        db_session,
        full,
        created_at=datetime(2026, 10, 6, 16, 30, tzinfo=timezone.utc),
        follow_up_at=datetime(2026, 10, 6, 15, 59, tzinfo=timezone.utc),
        last_contacted_at=datetime(2026, 10, 6, 16, 0, tzinfo=timezone.utc),
        provisional_grade="中班",
    )
    await create_record(admin_client, child_name="空白寶貝")

    _, rows = _csv(await admin_client.get(f"{RECORDS_EXPORT}?campus_key=yihua"))
    by_name = {row["幼生姓名"]: row for row in rows}
    assert by_name["王小明"] == {
        "校區": "義華",
        "月份": "115年09月",
        "序號": "1",
        "參觀日期": "2026/09/08",
        "幼生姓名": "王小明",
        "英文名字": "Ming",
        "生日": "2023/03/02",
        "班別": "小班",
        "入學學年": "115",
        "入學學期": "上學期",
        "階段": "已訪視",
        "預繳": "否",
        "已註冊": "否",
        "聯絡人": "王媽媽",
        "電話": "0912-345-601",
        "地址": "高雄市三民區大昌路1號",
        "父親職業": "工程師",
        "母親職業": "教師",
        "來源": "親友介紹",
        "來源分類": "在校生弟妹",
        "家長介紹": "林媽媽",
        "帶參觀老師": "王老師、李老師",
        "搭娃娃車": "要搭",
        "收預繳人員": "陳會計",
        "未預繳原因": "費用考量",
        "未預繳說明": "想再比較",
        "保留座位": "中班",
        "註冊日期": "",
        "轉學期": "是",
        "退出原因": "",
        # 台北時間，跨日的邊界不能差一天。
        "下次聯絡": "2026/10/06 23:59",
        "負責人": "admin@ivy.example",
        "最近聯絡": "2026/10/07 00:00",
        "官網預約": "否",
        "電訪回應": "下週再回覆",
        "備註": "第一行\n第二行，有逗號",
        "建檔時間": "2026/10/07 00:30",
    }
    blank = by_name["空白寶貝"]
    for column in ("英文名字", "班別", "電話", "地址", "來源", "來源分類", "家長介紹", "帶參觀老師", "收預繳人員",
                   "未預繳原因", "保留座位", "註冊日期", "退出原因", "下次聯絡", "最近聯絡", "備註"):
        assert blank[column] == "", column
    assert blank["搭娃娃車"] == "不搭"
    assert blank["轉學期"] == "否"


@pytest.mark.asyncio
async def test_records_export_stage_text_matches_the_admin_stage_meta(admin_client):
    await create_record(admin_client, child_name="已訪視寶貝")
    await record_at_stage(admin_client, "deposited", child_name="已預繳寶貝")
    await record_at_stage(admin_client, "enrolled", child_name="已註冊寶貝")
    await record_at_stage(admin_client, "withdrawn", child_name="退預繳寶貝", withdrawn_from="deposited")
    await record_at_stage(admin_client, "withdrawn", child_name="退註冊寶貝", withdrawn_from="enrolled")

    _, rows = _csv(await admin_client.get(f"{RECORDS_EXPORT}?campus_key=yihua"))
    by_name = {row["幼生姓名"]: row for row in rows}
    assert {name: row["階段"] for name, row in by_name.items()} == {
        "已訪視寶貝": "已訪視",
        "已預繳寶貝": "已預繳",
        "已註冊寶貝": "已註冊",
        "退預繳寶貝": "已退預繳",
        "退註冊寶貝": "已退註冊",
    }
    assert by_name["已預繳寶貝"]["預繳"] == "是"
    enrolled = by_name["已註冊寶貝"]
    assert (enrolled["已註冊"], enrolled["註冊日期"], enrolled["保留座位"]) == ("是", "2026/09/30", "小班")
    assert by_name["退預繳寶貝"]["退出原因"] == "家長改送他校"
    assert by_name["退預繳寶貝"]["預繳"] == "否"


@pytest.mark.asyncio
async def test_records_export_address_falls_back_to_district(admin_client, db_session):
    with_address = await create_record(admin_client, child_name="有地址", address="高雄市前鎮區")
    only_district = await create_record(admin_client, child_name="只有區域")
    await _set(db_session, with_address, district="三民區")
    await _set(db_session, only_district, district="三民區")
    _, rows = _csv(await admin_client.get(f"{RECORDS_EXPORT}?campus_key=yihua"))
    by_name = {row["幼生姓名"]: row for row in rows}
    assert by_name["有地址"]["地址"] == "高雄市前鎮區"
    assert by_name["只有區域"]["地址"] == "三民區"


@pytest.mark.asyncio
async def test_records_export_source_category_uses_short_labels(admin_client):
    for code in ("sibling_current", "sibling_graduate", "referral", "self_report", "invite_success", "returning",
                 "sibling_split", "invite_origin", "home_deposit"):
        await create_record(admin_client, child_name=f"分類-{code}", source_category=code)
    await create_record(admin_client, child_name="分類-空")
    _, rows = _csv(await admin_client.get(f"{RECORDS_EXPORT}?campus_key=yihua"))
    assert {row["幼生姓名"].removeprefix("分類-"): row["來源分類"] for row in rows} == {
        # 表單六項用短標籤（同後台 SOURCE_CATEGORY_CHOICES）。
        "sibling_current": "在校生弟妹",
        "sibling_graduate": "畢業生弟妹",
        "referral": "家長介紹／社區招生",
        "self_report": "自報生（廣告、鄰居、網路、活動）",
        "invite_success": "邀約來園",
        "returning": "舊生復學",
        # 舊資料才有的三類用園務原文。
        "sibling_split": constants.SOURCE_CATEGORIES["sibling_split"],
        "invite_origin": constants.SOURCE_CATEGORIES["invite_origin"],
        "home_deposit": constants.SOURCE_CATEGORIES["home_deposit"],
        # NULL 空白。
        "空": "",
    }


def test_source_category_label_falls_back_to_the_code_itself():
    assert download.source_category_label("referral") == "家長介紹／社區招生"
    assert download.source_category_label("sibling_split") == constants.SOURCE_CATEGORIES["sibling_split"]
    assert download.source_category_label("brand_new_code") == "brand_new_code"
    assert download.source_category_label(None) == ""
    assert download.source_category_label("") == ""


def test_short_labels_cover_exactly_the_six_form_choices():
    assert set(download.SOURCE_CATEGORY_SHORT_LABELS) <= set(constants.SOURCE_CATEGORIES)
    assert list(download.SOURCE_CATEGORY_SHORT_LABELS) == [
        "sibling_current", "sibling_graduate", "referral", "self_report", "invite_success", "returning",
    ]


def _visit(**overrides) -> RecruitmentVisit:
    """不進資料庫的訪視，測 record_row 的邊角（資料庫欄位有 NOT NULL，邊角值寫不進去）。"""
    values = dict(
        id=uuid.uuid4(), campus_key="yihua", month="115.09", seq_no="3", visit_date=date(2026, 9, 8),
        child_name="邊角寶貝", has_deposit=False, rides_bus=False, enrolled=False, transfer_term=False,
        created_at=datetime(2026, 9, 8, 1, 0, tzinfo=timezone.utc),
    )
    values.update(overrides)
    return RecruitmentVisit(**values)


def test_record_row_edge_values():
    row = dict(zip(EXPECTED_HEADERS, download.record_row(_visit(rides_bus=None)), strict=True))
    assert row["搭娃娃車"] == ""
    assert download.record_row(_visit(rides_bus=True))[EXPECTED_HEADERS.index("搭娃娃車")] == "要搭"
    assert download.record_row(_visit(rides_bus=False))[EXPECTED_HEADERS.index("搭娃娃車")] == "不搭"

    # 沒有 withdrawn_from 的退出當成從預繳退（同後台 stageMeta）。
    withdrawn = _visit(withdrawn_at=datetime(2026, 9, 9, tzinfo=timezone.utc))
    assert download.record_row(withdrawn)[EXPECTED_HEADERS.index("階段")] == "已退預繳"

    owner_id = uuid.uuid4()
    owned = _visit(follow_up_owner_id=owner_id)
    index = EXPECTED_HEADERS.index("負責人")
    assert download.record_row(owned, {owner_id: "王老師"})[index] == "王老師"
    # 對不到帳號（查不到）寫空白，沒有負責人也是空白。
    assert download.record_row(owned, {})[index] == ""
    assert download.record_row(owned)[index] == ""
    assert download.record_row(_visit(), {owner_id: "王老師"})[index] == ""


@pytest.mark.asyncio
async def test_records_export_owner_name_is_display_name_or_email_in_one_query(
    app, admin_client, reception_yihua_client, db_session  # noqa: F811
):
    me = (await admin_client.get(f"{API}/auth/me")).json()["user"]
    other = (await reception_yihua_client.get(f"{API}/auth/me")).json()["user"]
    await db_session.execute(update(User).where(User.id == uuid.UUID(other["id"])).values(display_name="接待小美"))
    await db_session.commit()
    mine = [await create_record(admin_client, child_name=f"我負責{i}") for i in range(3)]
    theirs = [await create_record(admin_client, child_name=f"小美負責{i}") for i in range(2)]
    unowned = await create_record(admin_client, child_name="沒人負責")
    for record in theirs:
        await _set(db_session, record, follow_up_owner_id=uuid.UUID(other["id"]))
    await _set(db_session, unowned, follow_up_owner_id=None)
    assert mine

    _, rows = _csv(await admin_client.get(f"{RECORDS_EXPORT}?campus_key=yihua"))
    owners = {row["幼生姓名"]: row["負責人"] for row in rows}
    assert owners["我負責0"] == me["email"]  # 沒設顯示名稱就用 Email（同後台 ownerLabel）
    assert owners["小美負責0"] == owners["小美負責1"] == "接待小美"
    assert owners["沒人負責"] == ""

    # 一次查完：不管幾列、幾位負責人，只查 users 一次；沒有負責人就不查。
    visits = list((await db_session.execute(select(RecruitmentVisit))).scalars())
    statements: list[str] = []

    def record(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    engine = app.state.engine.sync_engine
    event.listen(engine, "before_cursor_execute", record)
    try:
        names = await download.owner_names(db_session, visits)
        assert len(statements) == 1 and "users" in statements[0]
        assert names[uuid.UUID(other["id"])] == "接待小美"
        statements.clear()
        assert await download.owner_names(db_session, [_visit()]) == {}
        assert statements == []
    finally:
        event.remove(engine, "before_cursor_execute", record)


@pytest.mark.asyncio
async def test_records_export_applies_follow_up_and_owner_filters(
    admin_client, reception_yihua_client, db_session  # noqa: F811
):
    other = (await reception_yihua_client.get(f"{API}/auth/me")).json()["user"]
    await create_record(admin_client, child_name="我的案件")  # 建立的人自動是追蹤負責人
    theirs = await create_record(admin_client, child_name="別人的案件")
    nobody = await create_record(admin_client, child_name="沒人負責")
    await _set(
        db_session, theirs,
        follow_up_owner_id=uuid.UUID(other["id"]), follow_up_at=datetime.now(timezone.utc) - timedelta(days=1),
    )
    await _set(db_session, nobody, follow_up_owner_id=None)
    base = f"{RECORDS_EXPORT}?campus_key=yihua"

    async def export(query: str, client=admin_client) -> list[str]:
        return sorted(_names(_csv(await client.get(f"{base}&{query}"))[1]))

    assert await export("owner=me") == ["我的案件"]
    assert await export("owner=none") == ["沒人負責"]
    assert await export(f"owner={other['id']}") == ["別人的案件"]
    assert await export("follow_up=due") == ["別人的案件"]
    assert await export("follow_up=unscheduled") == ["我的案件", "沒人負責"]
    assert await export("follow_up=unscheduled&owner=none") == ["沒人負責"]
    # owner=me 是「目前登入的人」：同一批資料換人匯出，結果跟著換。
    granted = await admin_client.patch(
        f"{API}/admin/users/{other['id']}/capabilities", json={"capabilities": ["booking.export"]}
    )
    assert granted.status_code == 200, granted.text
    assert await export("owner=me", reception_yihua_client) == ["別人的案件"]


@pytest.mark.asyncio
async def test_records_export_marks_visits_created_from_a_booking(admin_client, public_client, db_session):
    booking = await started_booking(admin_client, public_client, db_session, child_name="預約寶貝")
    assert (await complete(admin_client, booking["id"])).status_code == 200
    await create_record(admin_client, child_name="手動寶貝")
    _, rows = _csv(await admin_client.get(f"{RECORDS_EXPORT}?campus_key=yihua"))
    assert {row["幼生姓名"]: row["官網預約"] for row in rows} == {"預約寶貝": "是", "手動寶貝": "否"}


@pytest.mark.asyncio
async def test_records_export_neutralises_formulas_and_keeps_anonymized_text(admin_client, db_session):
    await create_record(
        admin_client, child_name="公式寶貝", notes='=HYPERLINK("http://x")', address=" @SUM(A1)",
        parent_response="+cmd", english_name="-Ming", referrer="@林",
    )
    anonymized = await create_record(admin_client, child_name="要匿名的寶貝", phone="0912000999")
    await _set(
        db_session, anonymized, child_name=ANONYMIZED_TEXT, phone=None, anonymized_at=datetime.now(timezone.utc)
    )

    _, rows = _csv(await admin_client.get(f"{RECORDS_EXPORT}?campus_key=yihua"))
    by_name = {row["幼生姓名"]: row for row in rows}
    ming = by_name["公式寶貝"]
    assert ming["備註"] == '\'=HYPERLINK("http://x")'
    assert ming["地址"].startswith("'")
    assert (ming["電訪回應"], ming["英文名字"], ming["家長介紹"]) == ("'+cmd", "'-Ming", "'@林")
    assert by_name[ANONYMIZED_TEXT]["電話"] == ""


@pytest.mark.asyncio
async def test_records_export_keeps_one_row_per_record_with_hostile_text(admin_client):
    await create_record(admin_client, child_name='引號"寶貝"', notes='a,b\r\n"c"\nd', parent_response="一\n二")
    await create_record(admin_client, child_name="第二筆")
    text = (await admin_client.get(f"{RECORDS_EXPORT}?campus_key=yihua")).content.decode("utf-8-sig")
    parsed = list(csv.reader(io.StringIO(text)))
    assert len(parsed) == 3  # 表頭＋兩筆；備註裡的換行、逗號、雙引號不會拆成多列多欄
    assert all(len(row) == 37 for row in parsed)


@pytest.mark.asyncio
async def test_records_export_needs_export_grant_and_campus_scope(
    admin_client, campus_admin_yihua_client, reception_yihua_client  # noqa: F811
):
    await create_record(admin_client, child_name="授權測試寶貝")
    # 看得到明細不等於可以批次匯出：分校管理者、櫃台都要總管理者另外授權。
    assert (await campus_admin_yihua_client.get(f"{RECORDS_EXPORT}?campus_key=yihua")).status_code == 403
    assert (await reception_yihua_client.get(f"{RECORDS_EXPORT}?campus_key=yihua")).status_code == 403

    me = (await reception_yihua_client.get(f"{API}/auth/me")).json()["user"]
    granted = await admin_client.patch(
        f"{API}/admin/users/{me['id']}/capabilities", json={"capabilities": ["booking.export"]}
    )
    assert granted.status_code == 200, granted.text
    _, rows = _csv(await reception_yihua_client.get(f"{RECORDS_EXPORT}?campus_key=yihua"))
    assert _names(rows) == ["授權測試寶貝"]
    # 授權不擴大校區範圍；不存在的校區一樣 404。
    assert (await reception_yihua_client.get(f"{RECORDS_EXPORT}?campus_key=minghua")).status_code == 404
    assert (await admin_client.get(f"{RECORDS_EXPORT}?campus_key=nowhere")).status_code == 404


@pytest.mark.asyncio
async def test_records_export_audits_filters_without_search_text(admin_client, db_session):
    await create_record(admin_client, child_name="稽核寶貝", grade="中班", referrer="林老師", source="親友介紹")
    _csv(
        await admin_client.get(
            f"{RECORDS_EXPORT}?campus_key=yihua&grade=中班&q=稽核寶貝&referrer=林老師&source=親友介紹&has_deposit=false"
        )
    )
    entry = (
        await db_session.execute(select(AuditLogEntry).where(AuditLogEntry.action == "recruitment_visit.export"))
    ).scalar_one()
    assert entry.target_type == "recruitment_visit"
    assert entry.target_id == "yihua"
    assert entry.campus_key == "yihua"
    assert entry.metadata_json == {
        "row_count": 1,
        "grade": "中班",
        "has_source": True,
        "has_referrer": True,
        "has_deposit": False,
        "has_search": True,
    }
    # 搜尋字、介紹者、來源原文可能是人名，只記「有篩選」。
    assert "稽核寶貝" not in str(entry.metadata_json)
    assert "林老師" not in str(entry.metadata_json)


@pytest.mark.asyncio
async def test_records_export_audits_follow_up_and_owner_category_never_an_id(
    admin_client, reception_yihua_client, db_session  # noqa: F811
):
    other = (await reception_yihua_client.get(f"{API}/auth/me")).json()["user"]
    await create_record(admin_client, child_name="追蹤寶貝")
    for query in ("follow_up=due", "owner=me", "owner=none", f"owner={other['id']}", "follow_up=upcoming&owner=me"):
        _csv(await admin_client.get(f"{RECORDS_EXPORT}?campus_key=yihua&{query}"))
    entries = (
        await db_session.execute(
            select(AuditLogEntry)
            .where(AuditLogEntry.action == "recruitment_visit.export")
            .order_by(AuditLogEntry.created_at)
        )
    ).scalars().all()
    metadata = [entry.metadata_json for entry in entries]
    assert [{k: v for k, v in m.items() if k != "row_count"} for m in metadata] == [
        {"follow_up": "due"},
        {"owner": "me"},
        {"owner": "none"},
        {"owner": "staff"},
        {"follow_up": "upcoming", "owner": "me"},
    ]
    assert other["id"] not in str(metadata)


@pytest.mark.asyncio
async def test_records_export_refuses_more_than_the_limit(admin_client, db_session, monkeypatch):
    await create_record(admin_client, child_name="上限一", grade="中班")
    await create_record(admin_client, child_name="上限二", grade="小班")
    monkeypatch.setattr(csv_export, "EXPORT_ROW_LIMIT", 1)
    resp = await admin_client.get(f"{RECORDS_EXPORT}?campus_key=yihua")
    assert resp.status_code == 422
    assert resp.json()["detail"]["code"] == "EXPORT_TOO_LARGE"
    # 剛好等於上限可以匯出；被拒絕的不寫稽核（沒有檔案外流）。
    assert _names(_csv(await admin_client.get(f"{RECORDS_EXPORT}?campus_key=yihua&grade=中班"))[1]) == ["上限一"]
    entries = (
        await db_session.execute(select(AuditLogEntry).where(AuditLogEntry.action == "recruitment_visit.export"))
    ).scalars().all()
    assert [entry.metadata_json["row_count"] for entry in entries] == [1]


# ---- 未預繳名單：欄名、每列轉換、稽核 metadata ----

NO_DEPOSIT_EXPECTED_HEADERS = [
    "校區", "月份", "序號", "姓名", "班別", "原因分類", "轉換潛力", "冷名單", "說明", "來源", "家長介紹",
    "電訪回應", "建檔時間",
]


def test_no_deposit_row_matches_the_screen():
    assert list(download.NO_DEPOSIT_HEADERS) == NO_DEPOSIT_EXPECTED_HEADERS
    record = {
        "month": "115.09", "seq_no": "7", "child_name": "林小安", "grade": "小班",
        "no_deposit_reason": "費用考量", "no_deposit_reason_detail": "想再比較", "source": "親友介紹",
        "referrer": "林媽媽", "parent_response": "下週再聯絡",
        "created_at": datetime(2026, 10, 6, 16, 30, tzinfo=timezone.utc),
        "priority": "medium", "cold": True,
    }
    assert dict(zip(NO_DEPOSIT_EXPECTED_HEADERS, download.no_deposit_row("yihua", record), strict=True)) == {
        "校區": "義華", "月份": "115年09月", "序號": "7", "姓名": "林小安", "班別": "小班", "原因分類": "費用考量",
        "轉換潛力": "中", "冷名單": "是", "說明": "想再比較", "來源": "親友介紹", "家長介紹": "林媽媽",
        "電訪回應": "下週再聯絡", "建檔時間": "2026/10/07 00:30",
    }
    # 原因分類沒填寫「未分類」（同畫面）；其他空值寫空白。
    empty = {**record, "seq_no": None, "grade": None, "no_deposit_reason": None, "no_deposit_reason_detail": None,
             "source": None, "referrer": None, "parent_response": None, "priority": None, "cold": False}
    assert dict(zip(NO_DEPOSIT_EXPECTED_HEADERS, download.no_deposit_row("yihua", empty), strict=True)) == {
        "校區": "義華", "月份": "115年09月", "序號": "", "姓名": "林小安", "班別": "", "原因分類": "未分類",
        "轉換潛力": "", "冷名單": "否", "說明": "", "來源": "", "家長介紹": "", "電訪回應": "", "建檔時間": "2026/10/07 00:30",
    }


def test_audit_metadata_only_records_which_filters_were_applied():
    filters = SimpleNamespace(
        month=None, grade="中班", target_school_year=115, target_semester=1, source="親友介紹", referrer=None,
        has_deposit=False, no_deposit_reason=None, stage=None, visit_request_id=None, q="王小明",
        follow_up="due", owner=str(uuid.uuid4()),
    )
    assert download.records_audit_metadata(filters) == {
        "grade": "中班", "school_year": 115, "semester": 1, "has_source": True, "has_deposit": False,
        "has_search": True, "follow_up": "due", "owner": "staff",
    }
    assert download.no_deposit_audit_metadata(
        school_year=None, semester=None, reason=None, grade=None, priority="high", overdue_days=None, cold_only=False
    ) == {"priority": "high"}
    assert download.no_deposit_audit_metadata(
        school_year=115, semester=2, reason="費用考量", grade="小班", priority="low", overdue_days=30, cold_only=True
    ) == {
        "school_year": 115, "semester": 2, "no_deposit_reason": "費用考量", "grade": "小班", "priority": "low",
        "overdue_days": 30, "cold_only": True,
    }


def test_audit_metadata_records_reason_and_grade_verbatim_only_when_they_are_known_choices():
    def metadata(**overrides):
        values = dict(school_year=None, semester=None, reason=None, grade=None, priority=None, overdue_days=None,
                      cold_only=None)
        return download.no_deposit_audit_metadata(**{**values, **overrides})

    # 端點的 reason／grade 收任意字串（最長 60／20）：不在選項內的可能是人名，不能原文寫進稽核紀錄。
    for reason in constants.NO_DEPOSIT_REASONS:
        assert metadata(reason=reason) == {"no_deposit_reason": reason}
    for grade in constants.GRADES:
        assert metadata(grade=grade) == {"grade": grade}
    assert metadata(reason="王小明的媽媽說的", grade="王小明") == {"no_deposit_reason": "other", "grade": "other"}
    assert metadata(reason="未分類") == {"no_deposit_reason": "other"}  # 篩選器沒有「未分類」這個值，不特別放行
    assert metadata(reason="", grade="") == {}  # 空字串等於沒篩選（端點對空字串不篩）


NO_DEPOSIT_EXPORT = f"{ADMISSIONS}/no-deposit-records/export"


def _days_ago(days: int) -> str:
    """相對今天的參觀日期：冷名單看參觀日 90 天，固定日期會隨時間翻轉，所以一律用相對日期。"""
    return (today_local() - timedelta(days=days)).isoformat()


@pytest.mark.asyncio
async def test_no_deposit_export_follows_screen_filters_and_audits_them(
    admin_client, campus_admin_yihua_client, db_session  # noqa: F811
):
    fresh, cold = _days_ago(20), _days_ago(100)
    await create_record(
        admin_client, child_name="林小安", visit_date=fresh, no_deposit_reason="費用考量", parent_response="下週再聯絡"
    )
    await create_record(admin_client, child_name="周小樂", visit_date=fresh, no_deposit_reason="時程未到／仍在觀望")
    await create_record(admin_client, child_name="陳冷淡", visit_date=cold, no_deposit_reason="時程未到／仍在觀望")
    await create_record(admin_client, child_name="黃未填", visit_date=fresh)
    await record_at_stage(admin_client, "deposited", child_name="已預繳不列", visit_date=fresh)
    await record_at_stage(admin_client, "withdrawn", child_name="已退出不列", visit_date=fresh)

    resp = await admin_client.get(f"{NO_DEPOSIT_EXPORT}?campus_key=yihua")
    header, rows = _csv(resp)
    assert header == NO_DEPOSIT_EXPECTED_HEADERS
    assert all(len(row) == 13 for row in csv.reader(io.StringIO(resp.content.decode("utf-8-sig"))))
    assert f'filename="admissions-no-deposit-yihua-{today_local():%Y%m%d}.csv"' in resp.headers["content-disposition"]
    by_name = {row["姓名"]: row for row in rows}
    assert set(by_name) == {"林小安", "周小樂", "陳冷淡", "黃未填"}
    fresh_month = f"{int(fresh[:4]) - 1911}年{fresh[5:7]}月"
    assert by_name["林小安"]["月份"] == fresh_month
    assert (by_name["林小安"]["轉換潛力"], by_name["林小安"]["冷名單"], by_name["林小安"]["電訪回應"]) == (
        "中", "否", "下週再聯絡",
    )
    assert (by_name["周小樂"]["轉換潛力"], by_name["周小樂"]["冷名單"]) == ("高", "否")
    assert (by_name["陳冷淡"]["轉換潛力"], by_name["陳冷淡"]["冷名單"]) == ("高", "是")
    # 原因分類沒填寫「未分類」（同畫面）；沒有潛力分組就空白。
    assert (by_name["黃未填"]["原因分類"], by_name["黃未填"]["轉換潛力"]) == ("未分類", "")

    # 和 /no-deposit-records 同一組篩選、同一批人、同一個順序：畫面上篩好什麼，匯出的就是那一批。
    for query in ("", "&priority=high", "&priority=high&cold_only=true", "&reason=費用考量", "&grade=大班",
                  "&overdue_days=30", "&school_year=115&semester=1", "&school_year=114"):
        listing = await admin_client.get(f"{ADMISSIONS}/no-deposit-records?campus_key=yihua&page_size=100{query}")
        _, exported = _csv(await admin_client.get(f"{NO_DEPOSIT_EXPORT}?campus_key=yihua{query}"))
        assert [row["姓名"] for row in exported] == [r["child_name"] for r in listing.json()["records"]], query
    _, high = _csv(await admin_client.get(f"{NO_DEPOSIT_EXPORT}?campus_key=yihua&priority=high"))
    assert sorted(row["姓名"] for row in high) == ["周小樂", "陳冷淡"]
    _, cold_high = _csv(await admin_client.get(f"{NO_DEPOSIT_EXPORT}?campus_key=yihua&priority=high&cold_only=true"))
    assert [row["姓名"] for row in cold_high] == ["陳冷淡"]
    # 0 筆是只有表頭的檔案，不是錯誤。
    header_only, none = _csv(await admin_client.get(f"{NO_DEPOSIT_EXPORT}?campus_key=yihua&grade=大班"))
    assert header_only == NO_DEPOSIT_EXPECTED_HEADERS
    assert none == []

    entries = (
        await db_session.execute(
            select(AuditLogEntry)
            .where(AuditLogEntry.action == "recruitment_visit.export_no_deposit")
            .order_by(AuditLogEntry.created_at)
        )
    ).scalars().all()
    assert all((e.target_type, e.target_id, e.campus_key) == ("recruitment_visit", "yihua", "yihua") for e in entries)
    # 前 1 次是沒帶篩選的完整匯出，最後 1 次是 grade=大班 的 0 筆；中間各次逐一比對篩選記錄。
    metadata = [entry.metadata_json for entry in entries]
    assert metadata[0] == {"row_count": 4}
    assert {"row_count": 2, "priority": "high"} in metadata
    assert {"row_count": 1, "priority": "high", "cold_only": True} in metadata
    assert {"row_count": 1, "no_deposit_reason": "費用考量"} in metadata
    assert metadata[-1] == {"row_count": 0, "grade": "大班"}


@pytest.mark.asyncio
async def test_no_deposit_export_cold_flag_flips_on_the_visit_date_not_a_fixed_date(admin_client):
    for days in (89, 90, 91):
        await create_record(admin_client, child_name=f"第{days}天", visit_date=_days_ago(days), no_deposit_reason="費用考量")
    _, rows = _csv(await admin_client.get(f"{NO_DEPOSIT_EXPORT}?campus_key=yihua"))
    assert {row["姓名"]: row["冷名單"] for row in rows} == {"第89天": "否", "第90天": "是", "第91天": "是"}


@pytest.mark.asyncio
async def test_no_deposit_export_audit_never_records_free_text_filters(admin_client, db_session):
    await create_record(admin_client, child_name="稽核寶貝", visit_date=_days_ago(5), no_deposit_reason="費用考量")
    # 端點的 reason／grade 收任意字串：王小明這種人名不能寫進稽核紀錄。
    for query in ("reason=王小明", "grade=王小明", "reason=費用考量&grade=小班"):
        _csv(await admin_client.get(f"{NO_DEPOSIT_EXPORT}?campus_key=yihua&{query}"))
    entries = (
        await db_session.execute(
            select(AuditLogEntry)
            .where(AuditLogEntry.action == "recruitment_visit.export_no_deposit")
            .order_by(AuditLogEntry.created_at)
        )
    ).scalars().all()
    assert [entry.metadata_json for entry in entries] == [
        {"row_count": 0, "no_deposit_reason": "other"},
        {"row_count": 0, "grade": "other"},
        {"row_count": 0, "no_deposit_reason": "費用考量", "grade": "小班"},
    ]
    assert "王小明" not in str([entry.metadata_json for entry in entries])


@pytest.mark.asyncio
async def test_no_deposit_export_neutralises_formulas_and_keeps_one_row_per_record(admin_client):
    await create_record(
        admin_client, child_name='引號"寶貝"', visit_date=_days_ago(5), no_deposit_reason="費用考量",
        no_deposit_reason_detail="=1+1", parent_response='a,b\r\n"c"\nd', source="@來源", referrer="+林",
    )
    await create_record(admin_client, child_name="第二筆", visit_date=_days_ago(5))
    resp = await admin_client.get(f"{NO_DEPOSIT_EXPORT}?campus_key=yihua")
    parsed = list(csv.reader(io.StringIO(resp.content.decode("utf-8-sig"))))
    assert len(parsed) == 3 and all(len(row) == 13 for row in parsed)
    _, rows = _csv(resp)
    first = next(row for row in rows if row["姓名"].startswith("引號"))
    assert (first["說明"], first["來源"], first["家長介紹"]) == ("'=1+1", "'@來源", "'+林")


@pytest.mark.asyncio
async def test_no_deposit_export_needs_export_grant_and_campus_scope(
    admin_client, campus_admin_yihua_client, reception_yihua_client  # noqa: F811
):
    await create_record(admin_client, child_name="授權測試寶貝", visit_date=_days_ago(5), no_deposit_reason="費用考量")
    url = f"{NO_DEPOSIT_EXPORT}?campus_key=yihua"
    # 名單有孩子姓名與電訪回應：看得到名單不等於可以批次匯出，要總管理者另外授權。
    assert (await campus_admin_yihua_client.get(url)).status_code == 403
    assert (await reception_yihua_client.get(url)).status_code == 403

    me = (await reception_yihua_client.get(f"{API}/auth/me")).json()["user"]
    granted = await admin_client.patch(
        f"{API}/admin/users/{me['id']}/capabilities", json={"capabilities": ["booking.export"]}
    )
    assert granted.status_code == 200, granted.text
    _, rows = _csv(await reception_yihua_client.get(url))
    assert [row["姓名"] for row in rows] == ["授權測試寶貝"]
    # 授權不擴大校區範圍；不存在的校區一樣 404。
    assert (await reception_yihua_client.get(f"{NO_DEPOSIT_EXPORT}?campus_key=minghua")).status_code == 404
    assert (await admin_client.get(f"{NO_DEPOSIT_EXPORT}?campus_key=nowhere")).status_code == 404
    # 篩選參數不合法（轉換潛力只有高／中／低）和列表端點一樣 422。
    assert (await admin_client.get(f"{url}&priority=urgent")).status_code == 422


@pytest.mark.asyncio
async def test_no_deposit_export_refuses_more_than_the_limit(admin_client, db_session, monkeypatch):
    await create_record(admin_client, child_name="未預繳一", visit_date=_days_ago(5), no_deposit_reason="費用考量")
    await create_record(admin_client, child_name="未預繳二", visit_date=_days_ago(5), no_deposit_reason="距離／地點因素")
    monkeypatch.setattr(csv_export, "EXPORT_ROW_LIMIT", 1)
    resp = await admin_client.get(f"{NO_DEPOSIT_EXPORT}?campus_key=yihua")
    assert resp.status_code == 422
    assert resp.json()["detail"]["code"] == "EXPORT_TOO_LARGE"
    # 剛好等於上限可以匯出；被拒絕的不寫稽核（沒有檔案外流）。
    _, rows = _csv(await admin_client.get(f"{NO_DEPOSIT_EXPORT}?campus_key=yihua&reason=費用考量"))
    assert [row["姓名"] for row in rows] == ["未預繳一"]
    entries = (
        await db_session.execute(
            select(AuditLogEntry).where(AuditLogEntry.action == "recruitment_visit.export_no_deposit")
        )
    ).scalars().all()
    assert [entry.metadata_json["row_count"] for entry in entries] == [1]
