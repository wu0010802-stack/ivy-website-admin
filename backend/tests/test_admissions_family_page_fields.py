"""看板卡片與待追蹤列帶 visit_request_id（2026-10-05 預約明細當家庭頁規格第 7 節）：
招生入學點有預約的卡片時，前端用它開那筆預約明細；手動新增的訪視是 null。"""

from __future__ import annotations

import pytest

from app.admissions import academic
from app.common.timezones import today_local
from tests.admissions_helpers import ADMISSIONS, complete, create_record, started_booking


@pytest.mark.asyncio
async def test_board_and_follow_ups_carry_visit_request_id(admin_client, public_client, db_session):
    booking = await started_booking(admin_client, public_client, db_session, child_name="家庭頁寶貝")
    done = await complete(admin_client, booking["id"])
    assert done.status_code == 200, done.text
    school_year, semester = academic.current_term(today_local())
    await create_record(admin_client, child_name="手動寶貝", target_school_year=school_year, target_semester=semester)

    board = await admin_client.get(f"{ADMISSIONS}/board?campus_key=yihua&school_year={school_year}")
    assert board.status_code == 200, board.text
    cards = {card["child_name"]: card for card in board.json()["columns"]["visited"]}
    assert cards["家庭頁寶貝"]["visit_request_id"] == booking["id"]
    assert cards["家庭頁寶貝"]["has_visit_request"] is True
    assert cards["手動寶貝"]["visit_request_id"] is None

    # 預約轉來的不自動排聯絡、手動新增也沒排：兩筆都在「未排定」。
    follow_ups = await admin_client.get(f"{ADMISSIONS}/follow-ups?campus_key=yihua&scope=unscheduled&page_size=100")
    assert follow_ups.status_code == 200, follow_ups.text
    rows = {row["child_name"]: row for row in follow_ups.json()["rows"]}
    assert rows["家庭頁寶貝"]["visit_request_id"] == booking["id"]
    assert rows["手動寶貝"]["visit_request_id"] is None
