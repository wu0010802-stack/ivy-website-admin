from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

import pytest

from app.admissions import retention, stats
from app.admissions.academic import roc_month
from app.admissions.models import GradeIntakeTarget, RecruitmentVisit
from tests.admissions_helpers import reception_yihua_client, readonly_yihua_client  # noqa: F401

API = "/api/website/v1"
# 台北 2026-10-01 12:00。服務層測試一律注入 now，近 30／90 天與逾期都相對這個時刻。
NOW = datetime(2026, 10, 1, 4, 0, tzinfo=timezone.utc)
HIGH = "時程未到／仍在觀望"


def days_ago(days: float) -> datetime:
    return NOW - timedelta(days=days)


def snap(visit, deposit, enrolled, transfer, pending, effective, v2d, v2e, d2e, e2e) -> dict:
    """期望值的 metric snapshot（比率已手算到小數一位）。"""
    return {
        "visit": visit, "deposit": deposit, "enrolled": enrolled, "transfer_term": transfer,
        "pending_deposit": pending, "effective_deposit": effective,
        "visit_to_deposit_rate": v2d, "visit_to_enrolled_rate": v2e,
        "deposit_to_enrolled_rate": d2e, "effective_to_enrolled_rate": e2e,
    }


EMPTY = snap(0, 0, 0, 0, 0, 0, None, None, None, None)


def add_visit(db, *, campus_key="yihua", visit_date=date(2026, 9, 1), child_name="測試幼生", birthday=None,
              grade=None, source=None, referrer=None, has_deposit=False, enrolled=False, transfer_term=False,
              no_deposit_reason=None, withdrawn_at=None, provisional_grade=None, target_school_year=115,
              target_semester=1, created_at=NOW) -> RecruitmentVisit:
    """直接寫一筆招生訪視（統計只讀資料，不經 API，才能控制 created_at）。month 用 A1 的 roc_month 由參觀日期換算。"""
    visit = RecruitmentVisit(
        id=uuid.uuid4(), campus_key=campus_key, month=roc_month(visit_date), seq_no=None, visit_date=visit_date,
        child_name=child_name, birthday=birthday, grade=grade, source=source, referrer=referrer,
        has_deposit=has_deposit, rides_bus=False, enrolled=enrolled,
        enrolled_on=visit_date + timedelta(days=10) if enrolled else None,
        transfer_term=transfer_term, no_deposit_reason=no_deposit_reason,
        withdrawn_at=withdrawn_at, withdrawn_from="deposited" if withdrawn_at else None,
        withdraw_reason="家長改送他校" if withdrawn_at else None,
        provisional_grade=provisional_grade, target_school_year=target_school_year, target_semester=target_semester,
        version=1, created_at=created_at, updated_at=created_at,
    )
    db.add(visit)
    return visit


async def seed_r10(db) -> None:
    """R10 合成資料：義華 115 學年上學期 9 筆（V1–V9），另有 4 筆不該被算進來（X1–X4）。

    | 筆 | 參觀日 → 月份 | 姓名｜生日 | 年級 | 來源 | 介紹者 | 預繳 | 註冊 | 轉學期 | 未預繳原因 | 退出 | 建立 |
    | V1 | 08-10 → 115.08 | 王小明｜2022-03-01 | 小班 | Facebook | 林老師 | 是 | 是 | | | | 50 天前 |
    | V2 | 08-12 → 115.08 | 陳小華｜2022-05-02 | 小班 | Facebook | 林老師 | 是 | | | | | 95 天前 |
    | V3 | 08-15 → 115.08 | 李小美｜2021-04-03 | 中班 | 親友介紹 | 張老師 | 是 | | 是 | | | 29 天前 |
    | V4 | 09-03 → 115.09 | 林小安｜2022-06-04 | 小班 | Facebook | 林老師 | | | | 時程未到 | | 28 天前 |
    | V5 | 09-05 → 115.09 | 黃小雨｜2023-01-05 | 幼幼班 | Google 評論 | 張老師 | | | | （NULL） | | 26 天前 |
    | V6 | 09-10 → 115.09 | 吳小晴｜2021-02-06 | （NULL） | （NULL） | （NULL） | | | | 時程未到 | | 21 天前 |
    | V7 | 09-20 → 115.09 | 王小明｜2022-03-01（同 V1） | 小班 | Facebook | 林老師 | 是 | | | | | 11 天前 |
    | V8 | 09-25 → 115.09 | 周小宇｜2022-07-07 | 小班 | 親友介紹 | 林老師 | （退出後清掉） | | | 時程未到（舊值） | 2 天前退預繳 | 6 天前 |
    | V9 | 2025-12-15 → 114.12 | 鄭小芸｜2021-11-08 | 中班 | Facebook | 張老師 | 是 | 是 | | | | 290 天前 |
    """
    y = 2026
    add_visit(db, visit_date=date(y, 8, 10), child_name="王小明", birthday=date(2022, 3, 1), grade="小班", source="Facebook",
              referrer="林老師", has_deposit=True, enrolled=True, provisional_grade="小班", created_at=days_ago(50))
    add_visit(db, visit_date=date(y, 8, 12), child_name="陳小華", birthday=date(2022, 5, 2), grade="小班", source="Facebook",
              referrer="林老師", has_deposit=True, created_at=days_ago(95))
    add_visit(db, visit_date=date(y, 8, 15), child_name="李小美", birthday=date(2021, 4, 3), grade="中班", source="親友介紹",
              referrer="張老師", has_deposit=True, transfer_term=True, created_at=days_ago(29))
    add_visit(db, visit_date=date(y, 9, 3), child_name="林小安", birthday=date(2022, 6, 4), grade="小班", source="Facebook",
              referrer="林老師", no_deposit_reason=HIGH, created_at=days_ago(28))
    add_visit(db, visit_date=date(y, 9, 5), child_name="黃小雨", birthday=date(2023, 1, 5), grade="幼幼班", source="Google 評論",
              referrer="張老師", created_at=days_ago(26))
    add_visit(db, visit_date=date(y, 9, 10), child_name="吳小晴", birthday=date(2021, 2, 6), no_deposit_reason=HIGH,
              created_at=days_ago(21))
    add_visit(db, visit_date=date(y, 9, 20), child_name="王小明", birthday=date(2022, 3, 1), grade="小班", source="Facebook",
              referrer="林老師", has_deposit=True, created_at=days_ago(11))
    add_visit(db, visit_date=date(y, 9, 25), child_name="周小宇", birthday=date(2022, 7, 7), grade="小班", source="親友介紹",
              referrer="林老師", no_deposit_reason=HIGH, withdrawn_at=days_ago(2), created_at=days_ago(6))
    add_visit(db, visit_date=date(2025, 12, 15), child_name="鄭小芸", birthday=date(2021, 11, 8), grade="中班", source="Facebook",
              referrer="張老師", has_deposit=True, enrolled=True, provisional_grade="中班", created_at=days_ago(290))
    # X1 下學期、X2 114 學年、X3 沒填入學學期、X4 明華：篩選後都不在母體內。
    add_visit(db, visit_date=date(y, 9, 12), child_name="何小森", grade="大班", source="Facebook", has_deposit=True,
              target_semester=2, created_at=days_ago(15))
    add_visit(db, visit_date=date(y, 8, 20), child_name="許小樂", grade="大班", target_school_year=114, created_at=days_ago(40))
    add_visit(db, visit_date=date(y, 9, 18), child_name="蘇小晨", target_school_year=None, target_semester=None, created_at=days_ago(13))
    add_visit(db, campus_key="minghua", visit_date=date(y, 9, 22), child_name="楊小禾", has_deposit=True, created_at=days_ago(5))
    await db.commit()


async def test_stats_matches_ivy_semantics(db_session):
    """R10：每個指標都照園務 _visit_metric_cases 語意手算。"""
    await seed_r10(db_session)

    result = await stats.query_stats(db_session, "yihua", school_year=115, semester=1, reference_month=None, now=NOW)

    # 母體 V1–V9 共 9 筆。預繳 V1 V2 V3 V7 V9＝5；註冊 V1 V9＝2；轉學期 V3＝1；
    # 預繳未註冊未轉學期 V2 V7＝2；有效預繳（預繳且未轉學期）V1 V2 V7 V9＝4。
    # 比率：5/9＝55.6、2/9＝22.2、2/5＝40.0、2/4＝50.0。
    # 唯一幼生：V1 與 V7 同「王小明|2022-03-01」→ 9－1＝8；預繳唯一：V1 V2 V3 V7(=V1) V9 → 4。
    assert result["kpi"] == {**snap(9, 5, 2, 1, 2, 4, 55.6, 22.2, 40.0, 50.0), "unique_visit": 8, "unique_deposit": 4}
    assert result["filters"] == {"campus_key": "yihua", "school_year": 115, "semester": 1, "reference_month": None}
    assert result["as_of"] == NOW

    # 月度（民國月份升序）：114.12＝V9；115.08＝V1 V2 V3；115.09＝V4–V8。
    # 115.08：預繳 3、註冊 1（V1）、轉學期 1（V3）、預繳未註冊 1（V2）、有效 2（V1 V2）→ 3/3＝100.0、1/3＝33.3、1/3＝33.3、1/2＝50.0
    # 115.09：預繳 1（V7）、有效 1、預繳未註冊 1 → 1/5＝20.0、0/5＝0.0、0/1＝0.0、0/1＝0.0
    assert result["monthly"] == [
        {"month": "114.12", **snap(1, 1, 1, 0, 0, 1, 100.0, 100.0, 100.0, 100.0)},
        {"month": "115.08", **snap(3, 3, 1, 1, 1, 2, 100.0, 33.3, 33.3, 50.0)},
        {"month": "115.09", **snap(5, 1, 0, 0, 1, 1, 20.0, 0.0, 0.0, 0.0)},
    ]
    assert sum(row["visit"] for row in result["monthly"]) == result["kpi"]["visit"]  # 不重不漏
    # 年度＝月份的民國年相加：115 年＝115.08＋115.09 → 8、4、1、1、2、3 → 4/8＝50.0、1/8＝12.5、1/4＝25.0、1/3＝33.3
    assert result["by_year"] == [
        {"year": "114", **snap(1, 1, 1, 0, 0, 1, 100.0, 100.0, 100.0, 100.0)},
        {"year": "115", **snap(8, 4, 1, 1, 2, 3, 50.0, 12.5, 25.0, 33.3)},
    ]

    # 參考月份預設最新的 115.09，上月 115.08。
    assert result["reference_month"] == "115.09"
    summary = result["decision_summary"]
    assert summary["current_month"] == snap(5, 1, 0, 0, 1, 1, 20.0, 0.0, 0.0, 0.0)
    # 近 30 天看 created_at（>= now－30 天）：V3(29) V4(28) V5(26) V6(21) V7(11) V8(6) → 6 筆；
    # 預繳 V3 V7＝2、轉學期 V3＝1、預繳未註冊 V7＝1、有效 V7＝1 → 2/6＝33.3、0/6＝0.0、0/2＝0.0、0/1＝0.0
    assert summary["rolling_30d"] == snap(6, 2, 0, 1, 1, 1, 33.3, 0.0, 0.0, 0.0)
    # 近 90 天：上列＋V1(50)；V2(95) 建立時間早於參觀日，證明看 created_at 不看月份 → 7 筆；
    # 預繳 V1 V3 V7＝3、註冊 V1＝1、轉學期 V3＝1、預繳未註冊 V7＝1、有效 V1 V7＝2
    # → 3/7＝42.9、1/7＝14.3、1/3＝33.3、1/2＝50.0
    assert summary["rolling_90d"] == snap(7, 3, 1, 1, 1, 2, 42.9, 14.3, 33.3, 50.0)
    # 年度累計＝同民國年、月份 <= 9：115.08＋115.09（114.12 不算）
    assert summary["ytd"] == snap(8, 4, 1, 1, 2, 3, 50.0, 12.5, 25.0, 33.3)
    assert result["funnel_snapshot"] == {
        "visit": 5, "deposit": 1, "enrolled": 0, "transfer_term": 0, "effective_deposit": 1, "pending_deposit": 1,
    }

    # 月比：115.09 對 115.08；delta＝round(本月－上月, 1)。
    assert result["month_over_month"] == {
        "current_month": "115.09", "previous_month": "115.08",
        "visit": {"current": 5, "previous": 3, "delta": 2},
        "deposit": {"current": 1, "previous": 3, "delta": -2},
        "enrolled": {"current": 0, "previous": 1, "delta": -1},
        "effective_deposit": {"current": 1, "previous": 2, "delta": -1},
        "pending_deposit": {"current": 1, "previous": 1, "delta": 0},
        "visit_to_deposit_rate": {"current": 20.0, "previous": 100.0, "delta": -80.0},
        "visit_to_enrolled_rate": {"current": 0.0, "previous": 33.3, "delta": -33.3},
        "deposit_to_enrolled_rate": {"current": 0.0, "previous": 33.3, "delta": -33.3},
        "effective_to_enrolled_rate": {"current": 0.0, "previous": 50.0, "delta": -50.0},
    }

    # 班別：小班 V1 V2 V4 V7 V8＝5（預繳 V1 V2 V7＝3、註冊 V1）→ 60.0、20.0、33.3；
    # 中班 V3 V9＝2（預繳 2、註冊 V9）→ 100.0、50.0、50.0；幼幼班 V5＝1 → 0.0、0.0、分母 0＝None；
    # 年級 NULL（V6）顯示「未填寫」。同為 1 筆時依標籤字碼升序：幼(U+5E7C) < 未(U+672A)。
    assert result["by_grade"] == [
        {"grade": "小班", "visit": 5, "deposit": 3, "enrolled": 1,
         "visit_to_deposit_rate": 60.0, "visit_to_enrolled_rate": 20.0, "deposit_to_enrolled_rate": 33.3},
        {"grade": "中班", "visit": 2, "deposit": 2, "enrolled": 1,
         "visit_to_deposit_rate": 100.0, "visit_to_enrolled_rate": 50.0, "deposit_to_enrolled_rate": 50.0},
        {"grade": "幼幼班", "visit": 1, "deposit": 0, "enrolled": 0,
         "visit_to_deposit_rate": 0.0, "visit_to_enrolled_rate": 0.0, "deposit_to_enrolled_rate": None},
        {"grade": "未填寫", "visit": 1, "deposit": 0, "enrolled": 0,
         "visit_to_deposit_rate": 0.0, "visit_to_enrolled_rate": 0.0, "deposit_to_enrolled_rate": None},
    ]
    assert result["month_grade"] == {
        "114.12": {"中班": 1, "合計": 1},
        "115.08": {"小班": 2, "中班": 1, "合計": 3},
        "115.09": {"小班": 3, "幼幼班": 1, "未填寫": 1, "合計": 5},
    }

    # 來源：Facebook V1 V2 V4 V7 V9＝5（預繳 4）→ 80.0；親友介紹 V3 V8＝2（預繳 1）→ 50.0；
    # Google 評論 1、未填寫 1 同票同預繳 → 來源升序，'G'(0x47) 排在「未」前面。
    assert result["by_source"] == [
        {"source": "Facebook", "visit": 5, "deposit": 4, "visit_to_deposit_rate": 80.0},
        {"source": "親友介紹", "visit": 2, "deposit": 1, "visit_to_deposit_rate": 50.0},
        {"source": "Google 評論", "visit": 1, "deposit": 0, "visit_to_deposit_rate": 0.0},
        {"source": "未填寫", "visit": 1, "deposit": 0, "visit_to_deposit_rate": 0.0},
    ]
    assert result["top_source_names"] == ["Facebook", "親友介紹", "Google 評論", "未填寫"]

    # 接待人員：林老師 V1 V2 V4 V7 V8＝5（預繳 3）→ 60.0，全是小班；
    # 張老師 V3 V5 V9＝3（預繳 V3 V9）→ 66.7，中班 2／2、幼幼班 1／0；V6 介紹者與年級都是 NULL。
    assert result["by_referrer"] == [
        {"referrer": "林老師", "visit": 5, "deposit": 3, "visit_to_deposit_rate": 60.0,
         "by_grade": {"小班": {"visit": 5, "deposit": 3}}},
        {"referrer": "張老師", "visit": 3, "deposit": 2, "visit_to_deposit_rate": 66.7,
         "by_grade": {"中班": {"visit": 2, "deposit": 2}, "幼幼班": {"visit": 1, "deposit": 0}}},
        {"referrer": "未填寫", "visit": 1, "deposit": 0, "visit_to_deposit_rate": 0.0,
         "by_grade": {"未填寫": {"visit": 1, "deposit": 0}}},
    ]
    # 介紹者 × 來源：欄是前 10 名來源，缺的補 0；total＝該介紹者全部來源合計。
    assert result["referrer_source_cross"] == {
        "sources": ["Facebook", "親友介紹", "Google 評論", "未填寫"],
        "referrers": [
            {"referrer": "林老師", "sources": {"Facebook": 4, "親友介紹": 1, "Google 評論": 0, "未填寫": 0}, "total": 5},
            {"referrer": "張老師", "sources": {"Facebook": 1, "親友介紹": 1, "Google 評論": 1, "未填寫": 0}, "total": 3},
            {"referrer": "未填寫", "sources": {"Facebook": 0, "親友介紹": 0, "Google 評論": 0, "未填寫": 1}, "total": 1},
        ],
    }

    # 未預繳母體＝未預繳且未退出：V4 V5 V6（V8 退預繳後 has_deposit=false，但不算，舊的高潛力原因也不算）。
    # 時程未到：V4（小班）、V6（未填寫）→ 2；原因 NULL 的 V5 →「未分類」1。
    assert result["no_deposit_reasons"] == [
        {"reason": HIGH, "count": 2, "by_grade": {"小班": 1, "未填寫": 1}, "priority": "high"},
        {"reason": "未分類", "count": 1, "by_grade": {"幼幼班": 1}, "priority": None},
    ]
    assert result["no_deposit_total"] == 3
    assert result["no_deposit_priority"] == {"high": 2, "medium": 0, "low": 0, "other": 1}
    # 高潛力 V4 V6＝2；參觀日 <= 台北今天－14 天（09-17）：V4(09-03) V5(09-05) V6(09-10)＝3；
    # <= 今天－90 天（07-03）：0；高潛力且逾 14 天：V4 V6＝2（V8 已退出，不算）。
    assert result["no_deposit_summary"] == {
        "high_potential_count": 2, "overdue_followup_count": 3, "cold_count": 0, "high_potential_backlog_count": 2,
    }

    # 警示：參觀轉預繳 delta －80.0 <= －10 → FUNNEL_DROP；高潛力積壓 2 < 5 不警示；
    # 近 90 天來源（V1 V3–V8）：Facebook 3 筆預繳 2，占比 42.9% 但預繳率 66.7% 不低於整體 3/7＝42.9% → 不失衡。
    assert result["alerts"] == [
        {
            "code": "FUNNEL_DROP", "level": "warning", "title": "本月漏斗轉換下滑",
            "message": "115.09 參觀轉預繳 -80.0 個百分點，參觀轉註冊 -33.3 個百分點。",
            "target_tab": "records", "target_filter": {"month": "115.09"},
        },
    ]
    assert result["top_action_queue"] == [
        {
            "code": "FOLLOW_HIGH_POTENTIAL", "title": "查看高風險未預繳",
            "description": "目前有 2 筆高潛力名單逾期未追。",
            "target_tab": "nodeposit", "target_filter": {"priority": "high", "overdue_days": 14},
        },
        {
            "code": "REVIEW_CURRENT_MONTH", "title": "查看本月明細",
            "description": "切換到 115.09 明細，檢查本月漏斗掉點。",
            "target_tab": "records", "target_filter": {"month": "115.09"},
        },
    ]


async def test_stats_endpoint_serializes_service_result(admin_client, db_session):
    await seed_r10(db_session)

    response = await admin_client.get(f"{API}/admin/admissions/stats?campus_key=yihua&school_year=115&semester=1")

    assert response.status_code == 200, response.text
    body = response.json()
    # 不依賴現在時間的部分（近 30／90 天、逾期隨真實時鐘變動，由上一個測試注入 now 驗證）。
    assert body["kpi"] == {**snap(9, 5, 2, 1, 2, 4, 55.6, 22.2, 40.0, 50.0), "unique_visit": 8, "unique_deposit": 4}
    assert body["reference_month"] == "115.09"
    assert [row["grade"] for row in body["by_grade"]] == ["小班", "中班", "幼幼班", "未填寫"]
    assert body["by_grade"][2]["deposit_to_enrolled_rate"] is None
    assert body["filters"] == {"campus_key": "yihua", "school_year": 115, "semester": 1, "reference_month": None}


async def test_cross_total_counts_sources_outside_top_ten(db_session):
    # 11 個來源各 1 筆、都同一位介紹者：前 10 名依來源升序是 來源01–來源10，來源11 不在欄上，
    # 但 total 仍是 11（園務 referrer_source_cross 的 total 含前 10 以外）。
    for n in range(1, 12):
        add_visit(db_session, campus_key="international", source=f"來源{n:02d}", referrer="林老師")
    await db_session.commit()

    result = await stats.query_stats(db_session, "international", school_year=None, semester=None, reference_month=None, now=NOW)

    assert result["top_source_names"] == [f"來源{n:02d}" for n in range(1, 11)]
    [row] = result["referrer_source_cross"]["referrers"]
    assert sum(row["sources"].values()) == 10
    assert row["total"] == 11


async def test_alert_thresholds_and_source_imbalance(db_session):
    # 明華：社區傳單 6 筆都是高潛力、未預繳——4 筆 09-10 參觀、1 筆剛好參觀滿 14 天（09-17，<= 截止，算）、
    # 1 筆 09-18 參觀（不算）。逾期看參觀日不看建檔：6 筆都是 20 天前建檔；親友介紹 4 筆 10 天前、預繳 3。
    for _ in range(4):
        add_visit(db_session, campus_key="minghua", visit_date=date(2026, 9, 10), source="社區傳單",
                  no_deposit_reason=HIGH, created_at=days_ago(20))
    add_visit(db_session, campus_key="minghua", visit_date=date(2026, 9, 17), source="社區傳單",
              no_deposit_reason=HIGH, created_at=days_ago(20))
    add_visit(db_session, campus_key="minghua", visit_date=date(2026, 9, 18), source="社區傳單",
              no_deposit_reason=HIGH, created_at=days_ago(20))
    for has_deposit in (True, True, True, False):
        add_visit(db_session, campus_key="minghua", visit_date=date(2026, 9, 12), source="親友介紹",
                  has_deposit=has_deposit, created_at=days_ago(10))
    await db_session.commit()

    result = await stats.query_stats(db_session, "minghua", school_year=None, semester=None, reference_month=None, now=NOW)

    # 積壓 4＋1＝5 >= 5 → 警示。近 90 天共 10 筆、預繳 3 → 整體 30.0%；
    # 社區傳單 6/10＝60.0% >= 40 且預繳率 0.0% < 30.0% → 失衡；親友介紹 40.0% 但預繳率 75.0% → 不是。
    # 上月 115.08 沒資料：上月比率 None → 月比 delta None → 不判定漏斗下滑。
    assert result["month_over_month"]["visit_to_deposit_rate"] == {"current": 30.0, "previous": None, "delta": None}
    assert result["alerts"] == [
        {
            "code": "HIGH_POTENTIAL_BACKLOG", "level": "danger", "title": "高潛力未預繳名單堆積",
            "message": "參觀超過 14 天仍未預繳的高潛力名單有 5 筆。",
            "target_tab": "nodeposit", "target_filter": {"priority": "high", "overdue_days": 14},
        },
        {
            "code": "SOURCE_IMBALANCE", "level": "info", "title": "來源結構失衡",
            "message": "社區傳單 近 90 天占比 60.0% ，預繳率 0.0% 低於整體 30.0%。",
            "target_tab": "source", "target_filter": {"source": "社區傳單"},
        },
    ]
    assert [action["code"] for action in result["top_action_queue"]] == [
        "FOLLOW_HIGH_POTENTIAL", "REVIEW_CURRENT_MONTH", "REVIEW_SOURCE",
    ]
    assert result["top_action_queue"][2] == {
        "code": "REVIEW_SOURCE", "title": "查看來源結構",
        "description": "社區傳單 近 90 天占比 60.0%，預繳率低於整體，先看這個來源的後續追蹤。",
        "target_tab": "source", "target_filter": {"source": "社區傳單"},
    }

    # 早一天算（台北 09-30）：09-17 參觀那筆變成「還沒逾期」→ 積壓 4 < 5，不警示；行動入口只要 > 0 就列。
    earlier = await stats.query_stats(
        db_session, "minghua", school_year=None, semester=None, reference_month=None, now=NOW - timedelta(days=1)
    )
    assert [alert["code"] for alert in earlier["alerts"]] == ["SOURCE_IMBALANCE"]
    assert earlier["top_action_queue"][0]["description"] == "目前有 4 筆高潛力名單逾期未追。"


async def test_funnel_drop_alert_at_exact_threshold(db_session):
    # 崇德：115.08 兩筆預繳 1 → 50.0%；115.09 五筆預繳 2 → 40.0%；delta＝－10.0，<= －10 也要警示。
    for has_deposit in (True, False):
        add_visit(db_session, campus_key="chongde", visit_date=date(2026, 8, 5), has_deposit=has_deposit)
    for has_deposit in (True, True, False, False, False):
        add_visit(db_session, campus_key="chongde", visit_date=date(2026, 9, 5), has_deposit=has_deposit)
    await db_session.commit()

    result = await stats.query_stats(db_session, "chongde", school_year=115, semester=1, reference_month=None, now=NOW)

    assert result["alerts"][0]["code"] == "FUNNEL_DROP"
    assert result["alerts"][0]["message"] == "115.09 參觀轉預繳 -10.0 個百分點，參觀轉註冊 0.0 個百分點。"


async def test_rolling_windows_cut_at_exact_instant_across_taipei_midnight(db_session):
    """R11：現在是台北 10/01 00:30（UTC 還是 09/30）。近 30／90 天以瞬間比較，截止點本身算在內。"""
    now = datetime(2026, 9, 30, 16, 30, tzinfo=timezone.utc)  # 台北 2026-10-01 00:30
    cut_30 = now - timedelta(days=30)  # 台北 2026-09-01 00:30
    cut_90 = now - timedelta(days=90)  # 台北 2026-07-03 00:30
    for created_at in (
        cut_30,                          # A：近 30、近 90
        cut_30 - timedelta(seconds=1),   # B：只有近 90
        cut_90,                          # C：近 90
        cut_90 - timedelta(seconds=1),   # D：都不算
        now - timedelta(hours=1),        # E：台北 09/30 23:30（台北的昨天、UTC 的今天）→ 都算
    ):
        add_visit(db_session, visit_date=date(2026, 9, 15), created_at=created_at)
    await db_session.commit()

    result = await stats.query_stats(db_session, "yihua", school_year=115, semester=1, reference_month=None, now=now)

    assert result["kpi"]["visit"] == 5
    assert result["decision_summary"]["rolling_30d"]["visit"] == 2  # A E
    assert result["decision_summary"]["rolling_90d"]["visit"] == 4  # A B C E
    assert result["as_of"] == now


async def test_reference_month_previous_month_and_ytd_cross_year(db_session):
    """R11：參考月份與上月跨年（115.01 的上月是 114.12），年度累計只算同一個民國年。"""
    add_visit(db_session, visit_date=date(2025, 12, 31), has_deposit=True)   # 114.12
    add_visit(db_session, visit_date=date(2026, 1, 1))                        # 115.01
    add_visit(db_session, visit_date=date(2026, 1, 20), has_deposit=True)    # 115.01
    await db_session.commit()

    default = await stats.query_stats(db_session, "yihua", school_year=115, semester=1, reference_month=None, now=NOW)
    assert [row["month"] for row in default["monthly"]] == ["114.12", "115.01"]
    assert default["reference_month"] == "115.01"
    mom = default["month_over_month"]
    assert (mom["current_month"], mom["previous_month"]) == ("115.01", "114.12")
    assert mom["visit"] == {"current": 2, "previous": 1, "delta": 1}
    # 1/2＝50.0 對 1/1＝100.0 → －50.0，觸發漏斗下滑。
    assert mom["visit_to_deposit_rate"] == {"current": 50.0, "previous": 100.0, "delta": -50.0}
    assert default["decision_summary"]["ytd"]["visit"] == 2  # 114.12 是去年，不算

    december = await stats.query_stats(db_session, "yihua", school_year=115, semester=1, reference_month="114.12", now=NOW)
    assert december["month_over_month"]["previous_month"] == "114.11"
    assert december["decision_summary"]["current_month"] == snap(1, 1, 0, 0, 1, 1, 100.0, 0.0, 0.0, 0.0)
    # 上月沒資料：計數是 0，比率是 None，delta 也是 None（園務會算成 100.0－0）。
    assert december["month_over_month"]["visit"] == {"current": 1, "previous": 0, "delta": 1}
    assert december["month_over_month"]["visit_to_deposit_rate"] == {"current": 100.0, "previous": None, "delta": None}
    assert december["decision_summary"]["ytd"]["visit"] == 1

    padded = await stats.query_stats(db_session, "yihua", school_year=115, semester=1, reference_month="115.1", now=NOW)
    assert padded["reference_month"] == "115.01"
    assert padded["filters"]["reference_month"] == "115.01"

    no_data = await stats.query_stats(db_session, "yihua", school_year=115, semester=1, reference_month="115.05", now=NOW)
    assert no_data["decision_summary"]["current_month"] == EMPTY
    assert no_data["decision_summary"]["ytd"]["visit"] == 2  # 115.01–115.05

    with pytest.raises(stats.InvalidReferenceMonth):
        await stats.query_stats(db_session, "yihua", school_year=115, semester=1, reference_month="115.13", now=NOW)


async def test_invalid_reference_month_is_422(admin_client):
    response = await admin_client.get(f"{API}/admin/admissions/stats?campus_key=yihua&reference_month=115-09")
    assert response.status_code == 422, response.text
    assert response.json()["detail"]["code"] == "INVALID_REFERENCE_MONTH"
    assert response.json()["detail"]["message"] == "月份格式應為 民國年.月，如 115.03"

    # 兩位數年份格式本身合法，但 A 的 shift_roc_month 只收三位數年份：同樣 422，不是 500。
    short_year = await admin_client.get(f"{API}/admin/admissions/stats?campus_key=yihua&reference_month=99.12")
    assert short_year.status_code == 422, short_year.text
    assert short_year.json()["detail"]["code"] == "INVALID_REFERENCE_MONTH"


async def test_stats_empty_campus(admin_client, db_session):
    """Review Focus 5：一筆訪視都沒有的校區——比率 null、參考月份 null、不報錯。"""
    result = await stats.query_stats(db_session, "renwu", school_year=115, semester=1, reference_month=None, now=NOW)

    assert result["kpi"] == {**EMPTY, "unique_visit": 0, "unique_deposit": 0}
    assert result["reference_month"] is None
    assert result["decision_summary"] == {"current_month": EMPTY, "rolling_30d": EMPTY, "rolling_90d": EMPTY, "ytd": EMPTY}
    assert result["funnel_snapshot"] == dict.fromkeys(
        ("visit", "deposit", "enrolled", "transfer_term", "effective_deposit", "pending_deposit"), 0
    )
    mom = result["month_over_month"]
    assert (mom["current_month"], mom["previous_month"]) == (None, None)
    assert mom["visit"] == {"current": 0, "previous": 0, "delta": 0}
    assert mom["visit_to_deposit_rate"] == {"current": None, "previous": None, "delta": None}
    for key in ("monthly", "by_year", "by_grade", "by_source", "top_source_names", "by_referrer",
                "no_deposit_reasons", "alerts", "top_action_queue"):
        assert result[key] == [], key
    assert result["month_grade"] == {}
    assert result["referrer_source_cross"] == {"referrers": [], "sources": []}
    assert result["no_deposit_total"] == 0
    assert result["no_deposit_priority"] == {"high": 0, "medium": 0, "low": 0, "other": 0}
    assert result["no_deposit_summary"] == dict.fromkeys(
        ("high_potential_count", "overdue_followup_count", "cold_count", "high_potential_backlog_count"), 0
    )

    response = await admin_client.get(f"{API}/admin/admissions/stats?campus_key=renwu&school_year=115&semester=1")
    assert response.status_code == 200, response.text
    assert response.json()["reference_month"] is None
    assert response.json()["kpi"]["visit_to_deposit_rate"] is None


async def test_stats_permissions(reception_yihua_client, readonly_yihua_client, minghua_client, editor_client, admin_client):
    path = f"{API}/admin/admissions/stats?campus_key="
    # 接待人員有 admissions.read，只有義華。
    assert (await reception_yihua_client.get(path + "yihua")).status_code == 200
    assert (await reception_yihua_client.get(path + "minghua")).status_code == 404
    # 明華分校管理者看義華 → 404（不洩漏存在）。
    assert (await minghua_client.get(path + "yihua")).status_code == 404
    assert (await minghua_client.get(path + "minghua")).status_code == 200
    # editor、readonly 沒有招生權限 → 403（規格 7：統計含接待人員名字，不開給只有 analytics.read 的角色）。
    assert (await editor_client.get(path + "yihua")).status_code == 403
    assert (await readonly_yihua_client.get(path + "yihua")).status_code == 403
    # 不存在的校區：總管理者也是 404。
    assert (await admin_client.get(path + "nowhere")).status_code == 404


async def test_unique_counts_keep_anonymized_rows_apart(db_session):
    """同一孩子（同姓名、同生日）兩筆訪視：其中一筆依保存政策匿名化後，不能再併成同一人。"""
    first = add_visit(db_session, child_name="王小明", birthday=date(2022, 3, 1), has_deposit=True)
    add_visit(db_session, child_name="王小明", birthday=date(2022, 3, 1), has_deposit=True)
    await db_session.commit()

    before = await stats.query_stats(db_session, "yihua", school_year=115, semester=1, reference_month=None, now=NOW)
    assert (before["kpi"]["unique_visit"], before["kpi"]["unique_deposit"]) == (1, 1)

    retention.anonymize_visit(first, [])  # 姓名換固定文字、生日清空、anonymized_at 設值
    await db_session.commit()

    after = await stats.query_stats(db_session, "yihua", school_year=115, semester=1, reference_month=None, now=NOW)
    assert after["kpi"]["visit"] == 2
    assert (after["kpi"]["unique_visit"], after["kpi"]["unique_deposit"]) == (2, 2)


def add_target(db, *, campus_key: str, grade: str, seats: int, school_year: int = 115, semester: int = 1) -> None:
    db.add(GradeIntakeTarget(
        id=uuid.uuid4(), campus_key=campus_key, grade=grade, school_year=school_year, semester=semester,
        target_seats=seats, created_at=NOW, updated_at=NOW, updated_by=None,
    ))


def rate(value, numerator, denominator) -> dict:
    return {"value": value, "numerator": numerator, "denominator": denominator}


NO_RATE = rate(None, 0, 0)


async def seed_compare(db) -> None:
    # 義華 115 上：小班已保留 1、中班已註冊 1、大班已保留 1（大班沒計畫）、小班未預繳 1；另 1 筆是下學期。
    add_visit(db, grade="小班", has_deposit=True, provisional_grade="小班")
    add_visit(db, grade="中班", has_deposit=True, enrolled=True, provisional_grade="中班")
    add_visit(db, grade="大班", has_deposit=True, provisional_grade="大班")
    add_visit(db, grade="小班")
    add_visit(db, grade="小班", has_deposit=True, target_semester=2)
    add_target(db, campus_key="yihua", grade="小班", seats=10)
    add_target(db, campus_key="yihua", grade="中班", seats=0)   # 設成 0 也算「有設定」
    # 明華 115 上：1 筆未預繳，沒有任何計畫名額。
    add_visit(db, campus_key="minghua", grade="中班")
    await db.commit()


async def test_compare_rows_and_seats(db_session):
    await seed_compare(db_session)

    result = await stats.compare(db_session, ["yihua", "minghua", "renwu"], school_year=115, semester=1, now=NOW)
    rows = result["rows"]

    assert (result["as_of"], result["school_year"], result["semester"], result["seat_semester"]) == (NOW, 115, 1, 1)
    assert [row["campus_key"] for row in rows] == ["yihua", "minghua", "renwu"]
    # 義華：4 筆、預繳 3、註冊 1、有效預繳 3、預繳未註冊 2（小班、大班保留中）
    # → 3/4＝75.0、1/4＝25.0、1/3＝33.3、1/3＝33.3。
    # 剩餘：小班 10－1－0＝9，中班 0－0－1＝－1，大班沒計畫不算 → 8；計畫合計 10＋0＝10。
    assert rows[0] == {
        "campus_key": "yihua", "visit": 4, "deposit": 3, "enrolled": 1, "transfer_term": 0,
        "effective_deposit": 3, "pending_deposit": 2,
        "visit_to_deposit_rate": rate(75.0, 3, 4), "visit_to_enrolled_rate": rate(25.0, 1, 4),
        "deposit_to_enrolled_rate": rate(33.3, 1, 3), "effective_to_enrolled_rate": rate(33.3, 1, 3),
        "target_seats": 10, "remaining_seats": 8, "grades_with_target": 2,
    }


async def test_compare_whole_year_counts_all_terms_and_seats_use_first_term(db_session):
    """5A：不帶學期＝件數算整學年；名額剩餘仍用名額規劃的上學期，seat_semester 標明。"""
    await seed_compare(db_session)

    result = await stats.compare(db_session, ["yihua"], school_year=115, semester=None, now=NOW)
    row = result["rows"][0]

    assert (result["school_year"], result["semester"], result["seat_semester"]) == (115, None, 1)
    # 上學期 4 筆（預繳 3）＋下學期 1 筆（預繳 1）＝5 筆、預繳 4。
    assert (row["visit"], row["deposit"], row["enrolled"]) == (5, 4, 1)
    assert row["visit_to_deposit_rate"] == rate(80.0, 4, 5)
    # 名額剩餘與上學期相同：小班 10－1＝9、中班 0－1＝－1 → 8；下學期的保留不扣上學期名額。
    assert (row["target_seats"], row["remaining_seats"]) == (10, 8)

    second = await stats.compare(db_session, ["yihua"], school_year=115, semester=2, now=NOW)
    assert (second["semester"], second["seat_semester"]) == (2, 2)
    assert (second["rows"][0]["visit"], second["rows"][0]["deposit"]) == (1, 1)
    assert second["rows"][0]["target_seats"] is None


async def test_compare_without_targets(db_session):
    """Review Focus 5：沒設計畫名額＝未設定（None），不是 0；沒資料的比率是 None。"""
    await seed_compare(db_session)

    rows = (await stats.compare(db_session, ["minghua", "renwu"], school_year=115, semester=1))["rows"]

    # 明華：1 筆未預繳 → 0/1＝0.0；預繳 0 → 後兩個比率分母 0＝None。
    assert rows[0] == {
        "campus_key": "minghua", "visit": 1, "deposit": 0, "enrolled": 0, "transfer_term": 0,
        "effective_deposit": 0, "pending_deposit": 0,
        "visit_to_deposit_rate": rate(0.0, 0, 1), "visit_to_enrolled_rate": rate(0.0, 0, 1),
        "deposit_to_enrolled_rate": NO_RATE, "effective_to_enrolled_rate": NO_RATE,
        "target_seats": None, "remaining_seats": None, "grades_with_target": 0,
    }
    # 仁武：沒有任何訪視。
    assert rows[1]["visit"] == 0
    assert rows[1]["visit_to_deposit_rate"] == NO_RATE
    assert (rows[1]["target_seats"], rows[1]["remaining_seats"]) == (None, None)


async def test_compare_endpoint_scope(admin_client, minghua_client, reception_yihua_client, editor_client, db_session):
    await seed_compare(db_session)
    path = f"{API}/admin/admissions/compare?school_year=115&semester=1"

    everyone = await admin_client.get(path)
    assert everyone.status_code == 200, everyone.text
    body = everyone.json()
    assert body["as_of"]
    assert (body["school_year"], body["semester"]) == (115, 1)
    assert [row["campus_key"] for row in body["rows"]] == ["yihua", "minghua", "chongde", "international", "renwu"]
    assert body["rows"][0]["remaining_seats"] == 8

    # 分校帳號只看到自己的校區（規格 9.3、第 7 節）。
    assert [row["campus_key"] for row in (await minghua_client.get(path)).json()["rows"]] == ["minghua"]
    assert [row["campus_key"] for row in (await reception_yihua_client.get(path)).json()["rows"]] == ["yihua"]
    assert (await editor_client.get(path)).status_code == 403
    assert body["seat_semester"] == 1

    # 學期選填：只帶學年＝件數整學年（上下學期都算）、名額用上學期、seat_semester 標 1。
    whole = await admin_client.get(f"{API}/admin/admissions/compare?school_year=115")
    assert whole.status_code == 200, whole.text
    whole_body = whole.json()
    assert (whole_body["semester"], whole_body["seat_semester"]) == (None, 1)
    assert (whole_body["rows"][0]["visit"], whole_body["rows"][0]["remaining_seats"]) == (5, 8)
    second = (await admin_client.get(f"{API}/admin/admissions/compare?school_year=115&semester=2")).json()
    assert (second["semester"], second["seat_semester"]) == (2, 2)
    # 學年仍必填。
    assert (await admin_client.get(f"{API}/admin/admissions/compare?semester=1")).status_code == 422


# ── 未預繳明細（C2b）：園務 GET /no-deposit-analysis（stats.py:938-1005）──

EVALUATING = "課程／環境仍在評估"
COST = "費用考量"
OTHER_SCHOOL = "已有其他就學選項／比較他校"
UNSPECIFIED = "未註明／待追蹤"
RECORD_KEYS = {
    "id", "month", "seq_no", "child_name", "grade", "no_deposit_reason", "no_deposit_reason_detail",
    "source", "referrer", "parent_response", "created_at", "priority", "cold",
}
# seed_no_deposit 的 N1–N7 依「月份降序、序號數字升序」排好的順序。
ALL_SEVEN = ["陳小魚", "林小安", "黃小雨", "王小樹", "李小美", "周小宇", "鄭小芸"]


def add_numbered(db, seq_no: str | None, **kwargs) -> RecruitmentVisit:
    """add_visit 不配序號（seq_no=None）；名單要驗排序，這裡補上。"""
    visit = add_visit(db, **kwargs)
    visit.seq_no = seq_no
    return visit


async def seed_no_deposit(db) -> uuid.UUID:
    """未預繳明細的合成資料：義華 115 學年上學期 N1–N7 在母體內，X1–X4 不在。回傳 N1 的 id。

    逾期、冷名單看參觀日（2026-10-06 起，和園務看建檔時間分歧）：台北今天 10-01，逾 14 天＝參觀日 <= 09-17，
    冷名單＝參觀日 <= 07-03。建檔時間刻意和參觀日對不上（補登、隔很久才建），證明不看建檔。

    | 筆 | 參觀日 → 月份 | 序號 | 姓名 | 年級 | 未預繳原因（潛力） | 建檔 | 逾 14 天 | 冷名單 |
    | N1 | 09-03 → 115.09 | 2 | 林小安 | 小班 | 時程未到／仍在觀望（高） | 20 天前 | 是 | |
    | N2 | 09-17 → 115.09 | 10 | 黃小雨 | 幼幼班 | 費用考量（中） | 3 天前 | 是（剛好 14 天） | |
    | N3 | 09-18 → 115.09 | 1 | 陳小魚 | 中班 | 課程／環境仍在評估（高） | 30 天前 | （差 1 天） | |
    | N4 | 08-20 → 115.08 | 5 | 王小樹 | 大班 | （NULL，未分類） | 3 天前（補登） | 是 | |
    | N5 | 07-03 → 115.07 | 3 | 周小宇 | 小班 | 已有其他就學選項／比較他校（低） | 10 天前（補登） | 是 | 是（剛好 90 天） |
    | N6 | 07-04 → 115.07 | 1 | 李小美 | 中班 | 未註明／待追蹤（—） | 120 天前 | 是 | （差 1 天） |
    | N7 | 2025-12-15 → 114.12 | 4 | 鄭小芸 | 大班 | 時程未到／仍在觀望（高） | 290 天前 | 是 | 是 |

    X1 已預繳、X2 退預繳（殘留高潛力原因）、X3 下學期、X4 明華。
    """
    y = 2026
    n1 = add_numbered(db, "2", visit_date=date(y, 9, 3), child_name="林小安", birthday=date(2022, 6, 4), grade="小班",
                      source="Facebook", referrer="林老師", no_deposit_reason=HIGH, created_at=days_ago(20))
    n1.no_deposit_reason_detail = "想等明年再決定"
    n1.parent_response = "下週再電訪"
    n1.phone = "0912345678"
    n1.address = "高雄市三民區測試路 1 號"
    n1_id = n1.id  # commit 後再讀屬性會觸發 lazy refresh，先記下來
    add_numbered(db, "10", visit_date=date(y, 9, 17), child_name="黃小雨", grade="幼幼班", no_deposit_reason=COST,
                 created_at=days_ago(3))
    add_numbered(db, "1", visit_date=date(y, 9, 18), child_name="陳小魚", grade="中班", no_deposit_reason=EVALUATING,
                 created_at=days_ago(30))
    add_numbered(db, "5", visit_date=date(y, 8, 20), child_name="王小樹", grade="大班", created_at=days_ago(3))
    add_numbered(db, "3", visit_date=date(y, 7, 3), child_name="周小宇", grade="小班", no_deposit_reason=OTHER_SCHOOL,
                 created_at=days_ago(10))
    add_numbered(db, "1", visit_date=date(y, 7, 4), child_name="李小美", grade="中班", no_deposit_reason=UNSPECIFIED,
                 created_at=days_ago(120))
    add_numbered(db, "4", visit_date=date(2025, 12, 15), child_name="鄭小芸", grade="大班", no_deposit_reason=HIGH,
                 created_at=days_ago(290))
    add_numbered(db, "3", visit_date=date(y, 9, 10), child_name="何小森", grade="小班", has_deposit=True,
                 created_at=days_ago(30))
    add_numbered(db, "4", visit_date=date(y, 9, 12), child_name="許小樂", grade="小班", no_deposit_reason=HIGH,
                 withdrawn_at=days_ago(2), created_at=days_ago(30))
    add_numbered(db, "5", visit_date=date(y, 9, 15), child_name="蘇小晨", grade="小班", no_deposit_reason=HIGH,
                 target_semester=2, created_at=days_ago(30))
    add_numbered(db, "1", campus_key="minghua", visit_date=date(y, 9, 3), child_name="楊小禾", grade="小班",
                 no_deposit_reason=HIGH, created_at=days_ago(30))
    await db.commit()
    return n1_id


async def no_deposit(db, campus_key: str = "yihua", **changes) -> dict:
    params = {
        "school_year": 115, "semester": 1, "reason": None, "grade": None, "priority": None,
        "overdue_days": None, "cold_only": None, "page": 1, "page_size": 100, **changes,
    }
    return await stats.no_deposit_records(db, campus_key, now=NOW, **params)


def names(result: dict) -> list[str]:
    return [row["child_name"] for row in result["records"]]


async def test_no_deposit_records_population_order_and_fields(db_session):
    """母體同 C1 的 no_deposit（未預繳且未退出、篩入學學年學期）；月份降序、序號依數字升序。"""
    n1_id = await seed_no_deposit(db_session)

    result = await no_deposit(db_session)

    # X1 已預繳、X2 已退出、X3 下學期、X4 明華都不在。
    # 115.09 的序號 1、2、10（字串排序會是 1、10、2）→ 115.08 → 115.07 的 1、3 → 114.12（跨民國年照月份降序）。
    assert names(result) == ALL_SEVEN
    assert (result["total"], result["page"], result["page_size"]) == (7, 1, 100)
    # 高潛力 N1 N3 N7＝3；參觀日 <= 09-17：N1 N2 N4 N5 N6 N7＝6（N3 差 1 天不算）；<= 07-03：N5 N7＝2（N6 差 1 天不算）。
    assert result["summary"] == {"high_potential_count": 3, "overdue_followup_count": 6, "cold_count": 2}
    # 與 /stats 同口徑：統計寫幾筆，名單就是幾筆；三個數字也對得起來。
    overall = await stats.query_stats(db_session, "yihua", school_year=115, semester=1, reference_month=None, now=NOW)
    assert result["total"] == overall["no_deposit_total"]
    assert {key: overall["no_deposit_summary"][key] for key in result["summary"]} == result["summary"]

    lin = result["records"][1]
    assert set(lin) == RECORD_KEYS  # 不含電話、地址、生日
    assert lin == {
        "id": n1_id, "month": "115.09", "seq_no": "2", "child_name": "林小安", "grade": "小班",
        "no_deposit_reason": HIGH, "no_deposit_reason_detail": "想等明年再決定", "source": "Facebook",
        "referrer": "林老師", "parent_response": "下週再電訪", "created_at": days_ago(20), "priority": "high", "cold": False,
    }
    # 潛力：「未註明／待追蹤」與沒填原因（未分類）都是 None；冷名單＝參觀滿 90 天。
    assert [(row["priority"], row["cold"]) for row in result["records"]] == [
        ("high", False), ("high", False), ("medium", False), (None, False), (None, False), ("low", True), ("high", True),
    ]


async def test_no_deposit_records_filters_keep_summary(db_session):
    """潛力、冷名單只篩名單，summary 不變；逾期天數同園務：篩名單，也決定 summary 的逾期筆數；原因與班別兩邊都篩。"""
    await seed_no_deposit(db_session)
    base = (await no_deposit(db_session))["summary"]

    high = await no_deposit(db_session, priority="high")
    assert (names(high), high["total"], high["summary"]) == (["陳小魚", "林小安", "鄭小芸"], 3, base)
    assert names(await no_deposit(db_session, priority="medium")) == ["黃小雨"]
    assert names(await no_deposit(db_session, priority="low")) == ["周小宇"]

    # 畫面的「逾 14 天」開關：summary 的逾期本來就用 14 天，所以不變。
    overdue = await no_deposit(db_session, overdue_days=14)
    assert (names(overdue), overdue["summary"]) == (["林小安", "黃小雨", "王小樹", "李小美", "周小宇", "鄭小芸"], base)
    # 逾 25 天（參觀日 <= 09-06）：N2 也掉出去；summary 只有逾期筆數跟著天數變（園務 effective_overdue_days）。
    overdue_25 = await no_deposit(db_session, overdue_days=25)
    assert names(overdue_25) == ["林小安", "王小樹", "李小美", "周小宇", "鄭小芸"]
    assert overdue_25["summary"] == {**base, "overdue_followup_count": 5}

    cold = await no_deposit(db_session, cold_only=True)
    assert (names(cold), cold["total"], cold["summary"]) == (["周小宇", "鄭小芸"], 2, base)
    assert names(await no_deposit(db_session, cold_only=False)) == ALL_SEVEN  # 園務只在 true 時篩
    assert names(await no_deposit(db_session, priority="high", overdue_days=14)) == ["林小安", "鄭小芸"]

    # 原因、班別：名單與 summary 都只算符合的（園務 base_query）。
    by_reason = await no_deposit(db_session, reason=HIGH)
    assert names(by_reason) == ["林小安", "鄭小芸"]
    assert by_reason["summary"] == {"high_potential_count": 2, "overdue_followup_count": 2, "cold_count": 1}
    by_grade = await no_deposit(db_session, grade="小班")
    assert names(by_grade) == ["林小安", "周小宇"]
    assert by_grade["summary"] == {"high_potential_count": 1, "overdue_followup_count": 2, "cold_count": 1}


async def test_no_deposit_records_cutoff_is_inclusive(db_session):
    """參觀剛好滿 14／90 天就算逾期／冷名單（<=，同園務）；差 1 天就不算。看參觀日，不看建檔時間。"""
    await seed_no_deposit(db_session)

    overdue = names(await no_deposit(db_session, overdue_days=14))
    assert "黃小雨" in overdue      # 09-17 參觀，剛好 14 天（3 天前才建檔）
    assert "陳小魚" not in overdue  # 09-18 參觀（30 天前就建檔）
    assert "王小樹" in overdue      # 08-20 參觀，3 天前才補登
    cold = {row["child_name"]: row["cold"] for row in (await no_deposit(db_session))["records"]}
    assert (cold["周小宇"], cold["李小美"]) == (True, False)  # 07-03 參觀（10 天前補登）／07-04（120 天前建檔）
    assert names(await no_deposit(db_session, cold_only=True)) == ["周小宇", "鄭小芸"]


async def test_no_deposit_cutoff_uses_taipei_date(db_session):
    """「今天」是台北日期：UTC 10-01 16:30＝台北 10-02 00:30，09-18 參觀的那筆就滿 14 天了。"""
    await seed_no_deposit(db_session)
    after_midnight = datetime(2026, 10, 1, 16, 30, tzinfo=timezone.utc)
    before_midnight = datetime(2026, 10, 1, 15, 59, tzinfo=timezone.utc)

    def overdue_at(now):
        return stats.no_deposit_records(
            db_session, "yihua", school_year=115, semester=1, reason=None, grade=None, priority=None,
            overdue_days=14, cold_only=None, page=1, page_size=100, now=now,
        )

    assert "陳小魚" in names(await overdue_at(after_midnight))
    assert "陳小魚" not in names(await overdue_at(before_midnight))
    summary = (await stats.query_stats(
        db_session, "yihua", school_year=115, semester=1, reference_month=None, now=after_midnight,
    ))["no_deposit_summary"]
    assert summary["overdue_followup_count"] == 7


async def test_no_deposit_records_pagination(db_session):
    await seed_no_deposit(db_session)

    pages = [await no_deposit(db_session, page=page, page_size=3) for page in (1, 2, 3, 4)]

    # 排序固定，換頁不重複、不漏；超過最後一頁回空陣列，total 照算。
    assert [names(result) for result in pages] == [ALL_SEVEN[0:3], ALL_SEVEN[3:6], ALL_SEVEN[6:], []]
    assert {(result["total"], result["page_size"]) for result in pages} == {(7, 3)}
    assert [result["page"] for result in pages] == [1, 2, 3, 4]


async def test_no_deposit_records_empty_campus(db_session):
    await seed_no_deposit(db_session)

    result = await no_deposit(db_session, "renwu", priority="high")

    assert result == {
        "total": 0, "page": 1, "page_size": 100,
        "summary": {"high_potential_count": 0, "overdue_followup_count": 0, "cold_count": 0},
        "records": [],
    }


async def test_no_deposit_records_endpoint(admin_client, db_session):
    await seed_no_deposit(db_session)
    path = f"{API}/admin/admissions/no-deposit-records?campus_key=yihua&school_year=115&semester=1"

    response = await admin_client.get(path)
    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["total"], body["page"], body["page_size"]) == (7, 1, 100)
    assert [row["child_name"] for row in body["records"]] == ALL_SEVEN
    assert set(body["records"][1]) == RECORD_KEYS
    # 電話、地址、生日不在回應裡（N1 三個都有填）。
    for secret in ("0912345678", "測試路", "2022-06-04"):
        assert secret not in response.text, secret

    filtered = await admin_client.get(path + "&priority=high&page=1&page_size=2")
    assert filtered.status_code == 200, filtered.text
    assert (filtered.json()["total"], [row["child_name"] for row in filtered.json()["records"]]) == (3, ["陳小魚", "林小安"])

    base = f"{API}/admin/admissions/no-deposit-records?campus_key=yihua"
    for bad in ("priority=urgent", "overdue_days=0", "overdue_days=366", "page=0", "page_size=0", "page_size=501", "semester=3"):
        assert (await admin_client.get(f"{base}&{bad}")).status_code == 422, bad


async def test_no_deposit_records_permissions(reception_yihua_client, readonly_yihua_client, minghua_client, editor_client, admin_client):
    """名單含孩子姓名：權限同統計（admissions.read＋校區範圍；越權 404、editor／readonly 403）。"""
    path = f"{API}/admin/admissions/no-deposit-records?campus_key="
    assert (await reception_yihua_client.get(path + "yihua")).status_code == 200
    assert (await reception_yihua_client.get(path + "minghua")).status_code == 404
    assert (await minghua_client.get(path + "yihua")).status_code == 404
    assert (await minghua_client.get(path + "minghua")).status_code == 200
    assert (await editor_client.get(path + "yihua")).status_code == 403
    assert (await readonly_yihua_client.get(path + "yihua")).status_code == 403
    assert (await admin_client.get(path + "nowhere")).status_code == 404
