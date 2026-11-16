"""廣告平台歸因與手填花費表（2026-11-16，docs/specs/2026-11-16-ad-roi-design.md）。"""
from __future__ import annotations

import base64
import json
import re
import uuid
from datetime import date, datetime, timezone
from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.admissions.models import MANUAL_SPEND_PLATFORMS, AdSpendEntry
from app.booking import attribution
from app.booking.models import VisitRequest
from tests.analytics_fixtures import add_case
from tests.conftest import book_slot

pytestmark = pytest.mark.usefixtures("booking_consent")
API = "/api/website/v1"
WEB_ENGAGEMENT = Path(__file__).resolve().parents[2] / "web" / "shared" / "engagement.ts"

# 和 web/tests/attribution-cookie.spec.ts 同一組樣本：
# {"v":1,"f":{"s":"search","d":"2026-11-10"},"l":{"s":"ads","p":"google","d":"2026-11-16"}}
SAMPLE_ADS_COOKIE = (
    "eyJ2IjoxLCJmIjp7InMiOiJzZWFyY2giLCJkIjoiMjAyNi0xMS0xMCJ9LCJsIjp7InMiOiJhZHMiLCJwIjoiZ29vZ2xlIiwiZCI6IjIwMjYtMTEtMTYifX0"
)


def _cookie(last: dict) -> str:
    data = {"v": 1, "f": {"s": "search", "d": "2026-11-10"}, "l": last}
    return base64.urlsafe_b64encode(json.dumps(data, separators=(",", ":")).encode()).decode().rstrip("=")


def test_parse_reads_platform_from_shared_sample():
    site = attribution.parse_site_cookie(SAMPLE_ADS_COOKIE)
    assert site is not None
    assert site.last == attribution.Touch("ads", None, date(2026, 11, 16), "google")
    assert site.first == attribution.Touch("search", None, date(2026, 11, 10))
    columns = attribution.touch_columns(site)
    assert columns["last_touch_ad_platform"] == "google" and columns["first_touch_ad_platform"] is None


@pytest.mark.parametrize(
    "last",
    [
        {"s": "ads", "p": "tiktok", "d": "2026-11-16"},
        {"s": "ads", "p": 5, "d": "2026-11-16"},
        {"s": "search", "p": "google", "d": "2026-11-16"},
    ],
)
def test_parse_drops_bad_platform(last):
    site = attribution.parse_site_cookie(_cookie(last))
    assert site is not None and site.last is not None
    assert site.last.platform is None
    assert site.last.source == last["s"] and site.last.on == date(2026, 11, 16)


def test_ad_platforms_match_web():
    text = WEB_ENGAGEMENT.read_text(encoding="utf-8")
    match = re.search(r"AD_PLATFORMS = \[([^\]]*)\]", text)
    assert match
    assert tuple(re.findall(r"'([a-z]+)'", match.group(1))) == attribution.AD_PLATFORMS


@pytest.mark.asyncio
async def test_submission_records_ad_platform(admin_client, public_client, db_session):
    public_client.cookies.set(attribution.SITE_COOKIE, SAMPLE_ADS_COOKIE)
    booked = await book_slot(admin_client, public_client)
    db_session.expire_all()
    row = (
        await db_session.execute(select(VisitRequest).where(VisitRequest.id == uuid.UUID(booked["receipt_id"])))
    ).scalar_one()
    assert row.last_touch_ad_platform == "google" and row.first_touch_ad_platform is None
    detail = (await admin_client.get(f"{API}/admin/visit-requests/{booked['receipt_id']}")).json()
    assert detail["last_touch_ad_platform"] == "google" and detail["first_touch_ad_platform"] is None


@pytest.mark.asyncio
async def test_ad_platform_requires_ads_source(db_session):
    case_id = await add_case(db_session)
    case = await db_session.get(VisitRequest, case_id)
    case.last_touch_source = "search"
    case.last_touch_ad_platform = "google"
    with pytest.raises(IntegrityError):
        await db_session.flush()
    await db_session.rollback()


@pytest.mark.asyncio
async def test_ad_platform_rejects_unknown_value(db_session):
    case_id = await add_case(db_session)
    case = await db_session.get(VisitRequest, case_id)
    case.first_touch_source = "ads"
    case.first_touch_ad_platform = "tiktok"
    with pytest.raises(IntegrityError):
        await db_session.flush()
    await db_session.rollback()


def _entry(month: date = date(2026, 11, 1), platform: str = "openai", amount: int = 1000) -> AdSpendEntry:
    now = datetime.now(timezone.utc)
    return AdSpendEntry(month=month, platform=platform, amount=amount, created_at=now, updated_at=now)


def test_manual_spend_platforms():
    assert MANUAL_SPEND_PLATFORMS == ("openai", "meta", "line", "other", "offline")


@pytest.mark.asyncio
async def test_ad_spend_entry_constraints(db_session):
    db_session.add(_entry())
    await db_session.commit()
    for bad in (_entry(month=date(2026, 11, 2)), _entry(platform="google"), _entry(platform="meta", amount=-1)):
        db_session.add(bad)
        with pytest.raises(IntegrityError):
            await db_session.commit()
        await db_session.rollback()
    db_session.add(_entry())  # 同月同平台第二筆
    with pytest.raises(IntegrityError):
        await db_session.commit()
    await db_session.rollback()
