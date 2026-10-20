"""幼兒園裁罰同步（2026-10-20 規格 C1–C3、C7–C9）。HTTP 一律用 MockTransport，不連外。

重點：人名欄一定不能進資料庫、日誌、狀態列的錯誤訊息（FAKE_PERSON_NAMES 是測試檔裡編的假姓名）。"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from urllib.parse import unquote

import httpx
import pytest
from sqlalchemy import select, text, update

from app.admissions.geo import penalties as pen
from app.admissions.geo import sync
from app.admissions.geo.models import GeoDatasetStatus, GeoKindergarten, GeoKindergartenPenalty
from app.common.timezones import today_local
from tests.geo_helpers import FAKE_PERSON_NAMES, FIXTURES, penalty_files, penalty_response
from tests.test_geo_sync import _site, _status, _sync, small_minimum  # noqa: F401

CHANGCHUN = "高雄市私立常春藤幼兒園"
PAUL = "高雄市私立保羅幼兒園"
OLD_NAME = "高雄市私立舊名幼兒園"  # 第 7 欄寫著現在的義華
YIHUA = "高雄市私立義華幼兒園"
CLOSED = "高雄市私立已停辦幼兒園"


@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch):
    async def instant(seconds: float) -> None:
        return None

    monkeypatch.setattr(sync, "_sleep", instant)


class PenaltySite:
    """假的 GitHub 目錄清單與 kiang Pages 裁罰檔。files 的鍵是園名；listing 不給就列出 files 全部；errors 的園名回 500；
    gone 的園名在清單裡但檔案 404；其他網址交給 test_geo_sync 的 _site。"""

    def __init__(self, *, files=None, listing=None, listing_status=200, errors=(), gone=(), **site):
        self.files = penalty_files() if files is None else files
        self.listing, self.listing_status = listing, listing_status
        self.errors, self.gone = set(errors), set(gone)
        self.requests: list[str] = []  # 裁罰相關的請求：清單網址或園名
        self._base, _ = _site(**site)

    def handle(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if url == pen.LISTING_URL:
            self.requests.append(url)
            if self.listing_status != 200:
                return httpx.Response(self.listing_status, json={"message": "API rate limit exceeded"})
            return penalty_response(url, files=self.files, listing=self.listing)
        if url.startswith(f"{pen.FILE_ROOT}/"):
            name = unquote(url[len(pen.FILE_ROOT) + 1:]).removesuffix(".json")
            self.requests.append(name)
            if name in self.errors:
                return httpx.Response(500)
            if name in self.gone:
                return httpx.Response(404)
            return penalty_response(url, files=self.files)
        return self._base.handler(request)

    @property
    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handle)


def _padded(extra: int = 12) -> dict[str, list]:
    """假檔再加 extra 個空檔：讓「一檔下載失敗」不超過一成的錯誤門檻。"""
    files = penalty_files()
    files.update({f"高雄市私立補充{index:02d}幼兒園": [] for index in range(extra)})
    return files


async def _rows(app) -> list[GeoKindergartenPenalty]:
    async with app.state.session_factory() as db:
        result = await db.execute(select(GeoKindergartenPenalty).order_by(GeoKindergartenPenalty.school_name, GeoKindergartenPenalty.occurred_on, GeoKindergartenPenalty.id))
        return list(result.scalars())


async def _source_id(app, name: str) -> str:
    async with app.state.session_factory() as db:
        return (await db.execute(select(GeoKindergarten.source_id).where(GeoKindergarten.name == name))).scalar_one()


async def _age_status(app, days: int) -> None:
    old = datetime.now(timezone.utc) - timedelta(days=days)
    async with app.state.session_factory() as db:
        await db.execute(
            update(GeoDatasetStatus).where(GeoDatasetStatus.dataset == "kindergarten_penalties").values(checked_at=old, synced_at=old)
        )
        await db.commit()


async def _everything_stored(app) -> str:
    """裁罰表與公開資料狀態表的每一列，轉成一大段文字（拿來斷言姓名不在資料庫裡）。"""
    async with app.state.session_factory() as db:
        parts = (
            await db.execute(text("SELECT row_to_json(t)::text FROM geo_kindergarten_penalties t"))
        ).scalars().all() + (await db.execute(text("SELECT row_to_json(t)::text FROM geo_dataset_status t"))).scalars().all()
    return "\n".join(parts)


async def test_first_sync_imports_every_row_and_matches_schools(app, small_minimum):
    site = PenaltySite()
    result = await _sync(app, site.transport)
    assert result.kindergartens == "updated" and result.kindergarten_penalties == "updated"
    assert result.kindergarten_penalty_rows == 7
    rows = await _rows(app)
    assert len(rows) == 7
    by_name: dict[str, list[GeoKindergartenPenalty]] = {}
    for row in rows:
        by_name.setdefault(row.school_name, []).append(row)
    assert {name: len(items) for name, items in by_name.items()} == {CHANGCHUN: 3, PAUL: 2, OLD_NAME: 1, CLOSED: 1}
    # 檔名 = 園所名稱 → 對到；第 7 欄的園所全名 → 對到現在的義華；已停辦的對不到但照樣存。
    assert {row.source_id for row in by_name[CHANGCHUN]} == {await _source_id(app, CHANGCHUN)}
    assert {row.source_id for row in by_name[PAUL]} == {await _source_id(app, PAUL)}
    assert {row.source_id for row in by_name[OLD_NAME]} == {await _source_id(app, YIHUA)}
    assert {row.source_id for row in by_name[CLOSED]} == {None}
    # 處分與對象類別
    kinds = {(row.school_name, row.occurred_on.isoformat()): (row.kind, row.amount, row.subject) for row in rows}
    assert kinds[(CHANGCHUN, "2026-01-27")][0] == "fine"
    assert kinds[(PAUL, "2025-03-10")] == ("stop_enrollment", None, "staff")
    assert kinds[(PAUL, "2018-10-23")] == ("reduce_enrollment", None, "operator")
    assert kinds[(CLOSED, "2020-09-01")] == ("closure", None, "operator")
    stop = next(row for row in rows if row.kind == "stop_enrollment")
    assert (stop.period_start.isoformat(), stop.period_end.isoformat()) == ("2025-04-01", "2025-06-30")
    status = await _status(app, "kindergarten_penalties")
    assert status.label == status.active_version == today_local().isoformat()
    assert status.last_error is None and status.synced_at is not None and status.checked_at is not None
    assert result.kindergarten_penalties_version == today_local().isoformat()


async def test_person_names_never_reach_the_database_the_logs_or_the_status(app, small_minimum, caplog):
    caplog.set_level(logging.DEBUG)
    site = PenaltySite(errors={PAUL})  # 也走過一次下載失敗的日誌
    result = await _sync(app, site.transport)
    stored = await _everything_stored(app)
    logged = "\n".join(record.getMessage() for record in caplog.records) + "\n" + caplog.text
    for person in FAKE_PERSON_NAMES:
        assert person not in stored and person not in logged and person not in repr(result)
    assert "負責人：" not in stored and "行為人：" not in stored
    assert "負責人：" not in logged and "行為人：" not in logged


async def test_person_names_do_not_reach_the_error_message_when_a_file_is_broken(app, small_minimum, caplog):
    caplog.set_level(logging.DEBUG)
    files = penalty_files()
    files[CHANGCHUN] = {"error": f"負責人：{FAKE_PERSON_NAMES[0]}"}  # 不是陣列
    result = await _sync(app, PenaltySite(files=files).transport)
    assert result.kindergarten_penalties == "failed"  # 4 檔壞 1 檔，超過一成
    status = await _status(app, "kindergarten_penalties")
    assert status.last_error == "裁罰檔下載錯誤太多，未更新"
    assert FAKE_PERSON_NAMES[0] not in status.last_error and FAKE_PERSON_NAMES[0] not in caplog.text


async def test_second_sync_within_seven_days_does_not_fetch_again(app, small_minimum):
    site = PenaltySite()
    await _sync(app, site.transport)
    site.requests.clear()
    result = await _sync(app, site.transport)
    assert result.kindergarten_penalties == "skipped" and site.requests == []
    assert result.kindergarten_penalties_version == today_local().isoformat()


async def test_after_seven_days_the_table_is_replaced(app, small_minimum):
    site = PenaltySite()
    await _sync(app, site.transport)
    await _age_status(app, 8)
    files = penalty_files()
    files[CHANGCHUN] = files[CHANGCHUN][:1]  # 常春藤只剩一筆
    files[PAUL][0][5] = "停止招生：2025/04/01~2025/07/31"  # 保羅的期間改了
    del files[CLOSED]  # 已停辦的那檔不在清單了
    site = PenaltySite(files=files)
    result = await _sync(app, site.transport)
    assert result.kindergarten_penalties == "updated" and result.kindergarten_penalty_rows == 4
    rows = await _rows(app)
    assert [row.school_name for row in rows].count(CHANGCHUN) == 1
    assert CLOSED not in {row.school_name for row in rows}
    assert next(row for row in rows if row.kind == "stop_enrollment").period_end.isoformat() == "2025-07-31"


async def test_force_fetches_even_when_not_due(app, small_minimum):
    site = PenaltySite()
    await _sync(app, site.transport)
    site.requests.clear()
    result = await _sync(app, site.transport, force=True)
    assert result.kindergarten_penalties == "updated" and site.requests


async def test_a_listed_file_that_is_gone_loses_its_rows(app, small_minimum):
    site = PenaltySite()
    await _sync(app, site.transport)
    await _age_status(app, 8)
    site.gone = {CLOSED}  # 清單還列著，檔案已經 404（404 不算下載錯誤）
    result = await _sync(app, site.transport)
    assert result.kindergarten_penalties == "updated"
    assert CLOSED not in {row.school_name for row in await _rows(app)}


async def test_a_file_that_failed_to_download_keeps_its_old_rows_while_the_others_are_replaced(app, small_minimum):
    site = PenaltySite(files=_padded())
    await _sync(app, site.transport)
    await _age_status(app, 8)
    files = _padded()
    files[PAUL] = files[PAUL][:1]
    site = PenaltySite(files=files, errors={CHANGCHUN})  # 1/16 檔失敗，在一成以內
    result = await _sync(app, site.transport)
    assert result.kindergarten_penalties == "updated"
    rows = await _rows(app)
    names = [row.school_name for row in rows]
    assert names.count(CHANGCHUN) == 3  # 舊列保留
    assert names.count(PAUL) == 1  # 其他檔照常換


async def test_too_many_download_errors_keep_everything_and_report_it(app, small_minimum):
    site = PenaltySite()
    await _sync(app, site.transport)
    before = [(row.school_name, row.occurred_on, row.doc_no) for row in await _rows(app)]
    await _age_status(app, 8)
    result = await _sync(app, PenaltySite(errors={CHANGCHUN, PAUL}).transport)
    assert result.kindergarten_penalties == "failed" and result.kindergarten_penalty_rows == 0
    assert [(row.school_name, row.occurred_on, row.doc_no) for row in await _rows(app)] == before
    status = await _status(app, "kindergarten_penalties")
    assert status.last_error == "裁罰檔下載錯誤太多，未更新"
    assert status.label is not None  # 舊版仍在使用中


async def test_a_listing_that_shrank_below_eighty_percent_keeps_the_old_rows(app, small_minimum, monkeypatch):
    monkeypatch.setattr(sync, "PENALTIES_LISTING_MIN_EXISTING", 3)
    await _sync(app, PenaltySite().transport)
    before = len(await _rows(app))
    await _age_status(app, 8)
    result = await _sync(app, PenaltySite(listing=[CHANGCHUN, PAUL]).transport)  # 表內 4 所、清單只剩 2 所
    assert result.kindergarten_penalties == "failed"
    assert len(await _rows(app)) == before
    assert (await _status(app, "kindergarten_penalties")).last_error == "裁罰檔名清單比上次少了兩成以上，疑似殘缺，未更新"


async def test_a_small_table_is_not_subject_to_the_listing_check(app, small_minimum):
    await _sync(app, PenaltySite().transport)  # 表內只有 4 所，低於 50 所的門檻
    await _age_status(app, 8)
    result = await _sync(app, PenaltySite(listing=[CHANGCHUN]).transport)
    assert result.kindergarten_penalties == "updated"
    assert {row.school_name for row in await _rows(app)} == {CHANGCHUN}


async def test_an_unusable_listing_fails_and_keeps_the_old_rows(app, small_minimum):
    await _sync(app, PenaltySite().transport)
    before = len(await _rows(app))
    await _age_status(app, 8)
    result = await _sync(app, PenaltySite(listing=[]).transport)
    assert result.kindergarten_penalties == "failed" and len(await _rows(app)) == before
    assert (await _status(app, "kindergarten_penalties")).last_error == "裁罰檔名清單是空的"


async def test_when_the_listing_is_rate_limited_it_falls_back_to_the_known_school_names(app, small_minimum):
    site = PenaltySite(listing_status=403)
    result = await _sync(app, site.transport)
    assert result.kindergarten_penalties == "updated"
    asked = {name for name in site.requests if name != pen.LISTING_URL}
    active = {name for name in (await _active_names(app))}
    assert asked == active  # 逐一試營業中園所的檔名
    assert {row.school_name for row in await _rows(app)} == {CHANGCHUN, PAUL}  # 舊名與已停辦的檔不在營業中名單，這次沒抓到


async def test_the_fallback_also_tries_the_names_already_in_the_table(app, small_minimum):
    await _sync(app, PenaltySite().transport)
    await _age_status(app, 8)
    site = PenaltySite(listing_status=403)
    result = await _sync(app, site.transport)
    assert result.kindergarten_penalties == "updated"
    assert {OLD_NAME, CLOSED} <= set(site.requests)  # 表裡已有的名稱也試
    assert len(await _rows(app)) == 7


async def _active_names(app) -> list[str]:
    async with app.state.session_factory() as db:
        return list((await db.execute(select(GeoKindergarten.name).where(GeoKindergarten.is_active.is_(True)))).scalars())


async def test_a_file_over_the_size_cap_counts_as_a_download_error(app, small_minimum, monkeypatch):
    monkeypatch.setattr(sync, "PENALTIES_MAX_BYTES", 10)
    result = await _sync(app, PenaltySite().transport)
    assert result.kindergarten_penalties == "failed" and await _rows(app) == []
    assert (await _status(app, "kindergarten_penalties")).last_error == "裁罰檔下載錯誤太多，未更新"


async def test_running_out_of_time_fails_the_round(app, small_minimum, monkeypatch):
    monkeypatch.setattr(sync, "PENALTIES_TIME_BUDGET", timedelta(0))
    result = await _sync(app, PenaltySite().transport)
    assert result.kindergarten_penalties == "failed" and await _rows(app) == []
    assert (await _status(app, "kindergarten_penalties")).last_error.startswith("裁罰同步超過")


async def test_penalties_are_not_fetched_when_the_school_list_failed(app, small_minimum):
    site = PenaltySite(kiang=b"not json")
    result = await _sync(app, site.transport)
    assert (result.kindergartens, result.kindergarten_penalties) == ("failed", "skipped")
    assert site.requests == []


async def test_rows_are_inserted_in_chunks_and_duplicates_collapse(app, small_minimum, monkeypatch):
    monkeypatch.setattr(pen, "INSERT_CHUNK", 2)
    files = penalty_files()
    files[CHANGCHUN] = [*files[CHANGCHUN], files[CHANGCHUN][0]]  # 同一筆出現兩次
    result = await _sync(app, PenaltySite(files=files).transport)
    assert result.kindergarten_penalty_rows == 7 and len(await _rows(app)) == 7


async def test_a_database_error_while_writing_fails_only_the_penalties(app, small_minimum, monkeypatch):
    def blow_up(*args, **kwargs):
        raise RuntimeError("資料庫寫入壞掉")

    monkeypatch.setattr(pen, "pg_insert", blow_up)
    result = await _sync(app, PenaltySite().transport)
    assert (result.kindergartens, result.kindergarten_penalties) == ("updated", "failed")
    assert await _rows(app) == []
    assert (await _status(app, "kindergarten_penalties")).last_error == "下載或匯入失敗：RuntimeError"


async def test_the_client_identifies_itself_without_an_account():
    agent = sync.new_client().headers["User-Agent"]
    assert agent == sync.USER_AGENT and "@" not in agent and "gmail" not in agent.lower()


async def test_file_mode_imports_the_bundled_csv_without_touching_the_network(app, small_minimum, tmp_path):
    rows = []
    for name, data in penalty_files().items():
        rows.extend(pen.parse_penalty_file(data, name).rows)
    path = tmp_path / "kindergarten-penalties.csv"
    path.write_text(pen.rows_to_csv(rows), encoding="utf-8")
    site = PenaltySite()
    result = await _sync(app, site.transport, kindergarten_penalties_file=path)
    assert result.kindergarten_penalties == "updated" and result.kindergarten_penalty_rows == 7
    assert site.requests == [] and result.kindergartens == "skipped"
    stored = await _rows(app)
    assert len(stored) == 7 and {row.source_id for row in stored if row.school_name == CHANGCHUN} == {None}  # 沒有園所資料可比對
    assert path.read_text(encoding="utf-8").count("負責人：") == 0
    for person in FAKE_PERSON_NAMES:
        assert person not in await _everything_stored(app)


async def test_file_mode_matches_schools_that_are_already_imported(app, small_minimum, tmp_path):
    await _sync(app, PenaltySite(files={}, listing=[]).transport)  # 先匯入幼兒園名單（裁罰清單是空的，這輪裁罰失敗沒關係）
    rows = pen.parse_penalty_file(penalty_files()[CHANGCHUN], CHANGCHUN).rows
    path = tmp_path / "p.csv"
    path.write_text(pen.rows_to_csv(rows), encoding="utf-8")
    result = await _sync(app, PenaltySite().transport, kindergarten_penalties_file=path)
    assert result.kindergarten_penalties == "updated"
    assert {row.source_id for row in await _rows(app)} == {await _source_id(app, CHANGCHUN)}


async def test_a_broken_csv_fails_without_echoing_the_content(app, small_minimum, tmp_path):
    path = tmp_path / "bad.csv"
    path.write_text(f"<html>{FAKE_PERSON_NAMES[0]}</html>", encoding="utf-8")
    result = await _sync(app, PenaltySite().transport, kindergarten_penalties_file=path)
    assert result.kindergarten_penalties == "failed"
    status = await _status(app, "kindergarten_penalties")
    assert status.last_error == "裁罰檔不是預期的格式" and FAKE_PERSON_NAMES[0] not in status.last_error


async def test_file_mode_replaces_the_whole_table(app, small_minimum, tmp_path):
    await _sync(app, PenaltySite().transport)
    rows = pen.parse_penalty_file(penalty_files()[PAUL], PAUL).rows
    path = tmp_path / "p.csv"
    path.write_text(pen.rows_to_csv(rows), encoding="utf-8")
    await _sync(app, PenaltySite().transport, kindergarten_penalties_file=path)
    assert {row.school_name for row in await _rows(app)} == {PAUL}


def test_the_test_fixtures_directory_still_has_no_real_punish_file():
    """真檔含負責人與行為人姓名，不進 repo：fixtures 目錄裡不該有 punish 開頭的檔。"""
    assert not [path for path in FIXTURES.iterdir() if "punish" in path.name.lower() or "penalt" in path.name.lower()]
