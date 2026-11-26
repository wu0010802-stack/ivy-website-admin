"""2026-11-26 資安檢查的修正（README 同日「資安檢查修正」）。

每一段對應一條發現；改動前這些測試都會失敗（2026-11-26 在原版程式上確認）。"""
from __future__ import annotations

import base64
import json
import uuid
from datetime import date

import pytest
from sqlalchemy import select

from app.booking import attribution
from app.booking.models import VisitRequest
from tests.conftest import book_slot

API = "/api/website/v1"


def _site_cookie(payload: dict) -> str:
    return base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")


# ----------------------------------------------------------------------------- 網站來源 cookie
# re.match 搭 `$` 會放過結尾的換行：32 字的活動代碼加 "\n" 變 33 字，寫進 String(32) 欄位時資料庫回
# 「value too long」，訪客自己的送單變 500，還會建錯誤群組、推播總管理者（匿名就能做）。


@pytest.mark.parametrize(
    "touch",
    [
        {"s": "ads", "d": "2026-11-12", "c": "a" * 32 + "\n"},
        {"s": "ads", "d": "2026-11-12", "c": "spring\n"},
    ],
)
def test_campaign_with_trailing_newline_is_dropped(touch):
    site = attribution.parse_site_cookie(_site_cookie({"v": 1, "l": touch}))
    assert site is not None and site.last is not None
    assert site.last.campaign is None


def test_day_with_trailing_newline_is_rejected():
    site = attribution.parse_site_cookie(_site_cookie({"v": 1, "l": {"s": "search", "d": "2026-11-12\n"}}))
    assert site is not None and site.last is None


def test_click_tokens_with_trailing_newline_are_rejected():
    site = attribution.parse_site_cookie(
        _site_cookie({"v": 1, "o": {"v": "ob-ref\n", "t": 1_794_787_200_000}, "b": {"v": "IwAR0\n", "t": 1_794_787_200_000}})
    )
    assert site is not None and site.oppref is None and site.fbclid is None


def test_platform_cookies_with_trailing_newline_are_ignored():
    from datetime import datetime, timezone

    now = datetime(2026, 11, 20, tzinfo=timezone.utc)
    cookies = {"_ga": "GA1.1.123456789.1763000000\n", "_fbp": "fb.1.1763000000000.987654321\n", "__obref": "ob\n"}
    assert attribution.click_ids(cookies, None, ("ga4", "meta", "openai"), now) is None


@pytest.mark.asyncio
async def test_booking_with_overlong_campaign_newline_succeeds(admin_client, public_client, db_session):
    public_client.cookies.set(
        attribution.SITE_COOKIE, _site_cookie({"v": 1, "l": {"s": "ads", "d": "2026-11-12", "c": "a" * 32 + "\n"}})
    )
    booked = await book_slot(admin_client, public_client)
    db_session.expire_all()
    row = (
        await db_session.execute(select(VisitRequest).where(VisitRequest.id == uuid.UUID(booked["receipt_id"])))
    ).scalar_one()
    assert (row.last_touch_source, row.last_touch_on, row.last_touch_campaign) == ("ads", date(2026, 11, 12), None)


# ----------------------------------------------------------------------------- LINE 群組被移出後又回來
# 11-19 的修正只解除校區綁定：驗證紀錄與群組名都留著，後台仍顯示「已驗證」與離開前的名稱，總管理者不用新
# 驗證碼就能再選它；離開事件漏收時，拉回來（join）更是什麼都不解除。

from app.notifications.models import LineCampusTarget, LineGroup, LineGroupSetting  # noqa: E402
from tests.test_line_group_attend import HQ_GROUP, YIHUA_GROUP, _groups, _postback, _press  # noqa: E402
from tests.test_line_integrations_20261116 import fake_line  # noqa: E402,F401  (fixture)

GROUP_BODY = {"kinds": ["visit_request_created"], "digest_enabled": False, "mention_all_same_day": False}


def _group_event(kind: str, group: str, *, redelivery: bool = False) -> dict:
    event = _postback(None, group, user=None)
    event["type"] = kind
    if kind == "leave":
        del event["replyToken"]
    if redelivery:
        event["deliveryContext"] = {"isRedelivery": True}
    return event


async def _name_groups(app, name: str) -> None:
    async with app.state.session_factory() as db:
        for target in (YIHUA_GROUP, HQ_GROUP):
            (await db.get(LineGroup, target)).name = name
        await db.commit()


@pytest.mark.asyncio
@pytest.mark.usefixtures("booking_consent")
async def test_rejoined_group_must_be_verified_again(app, fake_line, admin_client):  # noqa: F811
    await _groups(app)
    await _name_groups(app, "義華行政群")
    await _press(app, _group_event("leave", YIHUA_GROUP))
    await _press(app, _group_event("join", YIHUA_GROUP))
    async with app.state.session_factory() as db:
        group = await db.get(LineGroup, YIHUA_GROUP)
        assert group.left_at is None
        assert group.verified_at is None
        # 名稱清掉，回來後重新向 LINE 取（假的 LINE 不回名稱，所以留空）。
        assert group.name is None
        assert await db.get(LineCampusTarget, "yihua") is None

    rebind = await admin_client.put(f"{API}/admin/line/campus-targets/yihua", json={"target_id": YIHUA_GROUP})
    assert rebind.status_code == 409, rebind.text
    assert rebind.json()["detail"]["code"] == "LINE_GROUP_UNVERIFIED"
    hq = await admin_client.put(f"{API}/admin/line/groups/{YIHUA_GROUP}", json={**GROUP_BODY, "is_hq": True})
    assert hq.status_code == 409, hq.text
    assert hq.json()["detail"]["code"] == "LINE_GROUP_UNVERIFIED"


@pytest.mark.asyncio
@pytest.mark.usefixtures("booking_consent")
async def test_join_without_recorded_leave_resets_the_group(app, fake_line):  # noqa: F811
    """離開的 webhook 漏收：記錄上群組一直都在，又收到 join，一樣當作被移出後回來。"""
    await _groups(app)
    await _name_groups(app, "總部群")
    async with app.state.session_factory() as db:
        db.add(LineCampusTarget(campus_key="minghua", target_id=HQ_GROUP, updated_at=(await db.get(LineGroup, HQ_GROUP)).first_seen_at))
        await db.commit()
    await _press(app, _group_event("join", HQ_GROUP))
    async with app.state.session_factory() as db:
        group = await db.get(LineGroup, HQ_GROUP)
        assert group.verified_at is None and group.name is None and group.left_at is None
        assert (await db.get(LineGroupSetting, HQ_GROUP)).is_hq is False
        assert await db.get(LineCampusTarget, "minghua") is None
        # 其他群組不受影響。
        assert (await db.get(LineCampusTarget, "yihua")).target_id == YIHUA_GROUP
        assert (await db.get(LineGroup, YIHUA_GROUP)).verified_at is not None


@pytest.mark.asyncio
@pytest.mark.usefixtures("booking_consent")
async def test_redelivered_join_of_present_group_changes_nothing(app, fake_line):  # noqa: F811
    await _groups(app)
    await _press(app, _group_event("join", YIHUA_GROUP, redelivery=True))
    async with app.state.session_factory() as db:
        assert (await db.get(LineGroup, YIHUA_GROUP)).verified_at is not None
        assert (await db.get(LineCampusTarget, "yihua")).target_id == YIHUA_GROUP
        assert (await db.get(LineGroupSetting, HQ_GROUP)).is_hq is True


# ----------------------------------------------------------------------------- ffmpeg 的錯誤輸出不進記憶體
# 去除拍攝資訊與抽 poster 原本用 capture_output，特製影片讓 ffmpeg 一直印錯誤時，整段輸出都堆在 API 程序
# 的記憶體（實測 1.3 MB 的檔 2 秒印 13.7 MB）。這裡用假的 ffmpeg 印 30 MB，量 Python 的記憶體高峰。

import os  # noqa: E402
import stat  # noqa: E402
import tracemalloc  # noqa: E402

from app.media import metadata, processing  # noqa: E402

NOISE_BYTES = 30_000_000
_FAKE_FFMPEG = f"""#!/bin/sh
for last; do :; done
head -c {NOISE_BYTES} /dev/zero | tr '\\000' 'x' >&2
printf '\\ntail-marker: Invalid NAL unit size\\n' >&2
if [ "$FAKE_FFMPEG_OK" = 1 ]; then printf data > "$last"; exit 0; fi
exit 1
"""


@pytest.fixture
def noisy_ffmpeg(tmp_path, monkeypatch):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    script = bin_dir / "ffmpeg"
    script.write_text(_FAKE_FFMPEG)
    script.chmod(script.stat().st_mode | stat.S_IXUSR)
    monkeypatch.setenv("PATH", f"{bin_dir}{os.pathsep}{os.environ.get('PATH', '')}")
    return tmp_path


def _peak_bytes(call) -> int:
    tracemalloc.start()
    try:
        call()
        return tracemalloc.get_traced_memory()[1]
    finally:
        tracemalloc.stop()


def test_strip_video_does_not_buffer_ffmpeg_output(noisy_ffmpeg, monkeypatch):
    monkeypatch.setenv("FAKE_FFMPEG_OK", "1")
    src, dst = noisy_ffmpeg / "in.mp4", noisy_ffmpeg / "out.mp4"
    src.write_bytes(b"\x00\x00\x00\x18ftypmp42")
    peak = _peak_bytes(lambda: metadata.strip_video_file(src, dst))
    assert dst.read_bytes() == b"data"
    assert peak < 2_000_000, peak


def test_poster_failure_keeps_only_the_stderr_tail(noisy_ffmpeg):
    errors: list[str] = []

    def run() -> None:
        with pytest.raises(processing.ProcessingError) as caught:
            processing.extract_video_poster(noisy_ffmpeg / "in.mp4")
        errors.append(str(caught.value))

    peak = _peak_bytes(run)
    assert "tail-marker: Invalid NAL unit size" in errors[0]
    assert peak < 2_000_000, peak


def test_poster_timeout_kills_ffmpeg(tmp_path, monkeypatch):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    script = bin_dir / "ffmpeg"
    script.write_text("#!/bin/sh\nexec sleep 30\n")
    script.chmod(script.stat().st_mode | stat.S_IXUSR)
    monkeypatch.setenv("PATH", f"{bin_dir}{os.pathsep}{os.environ.get('PATH', '')}")
    import subprocess as _subprocess

    with pytest.raises(_subprocess.TimeoutExpired):
        processing.run_keeping_stderr_tail(["ffmpeg", "x"], timeout=0.5)
