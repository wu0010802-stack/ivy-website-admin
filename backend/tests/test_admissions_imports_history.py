"""後台資料匯入：歷年註冊的預覽與確認端點（2026-10-21 規格 §6–§8）。

瀏覽器只送擷取後的格子表（表頭兩列與五個標籤列），伺服器用既有規則解析並預覽、確認後整校取代。
全部用 history_helpers 合成的假檔與假姓名；斷言重點是預覽結果和 CLI 一致，以及備註（假名）不會出現在回應裡。"""
from __future__ import annotations

import json
import logging
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app.admissions.history.grid import EMPTY, MASKED, GridCell
from app.admissions.history.importer import replace_history
from app.admissions.history.models import CampusTermEnrollment
from app.admissions.history.payload import build_payload
from app.admissions.history.payload import load_payload as load_history_payload
from app.admissions.history.workbook import parse_workbook, read_grids
from app.admissions.schemas import HistorySheetIn
from app.main import create_app
from app.operations.models import AuditLogEntry
from tests.admissions_helpers import readonly_yihua_client, reception_yihua_client  # noqa: F401
from tests.conftest import _logged_in_client, _test_settings
from tests.history_helpers import (
    FAKE_NOTES,
    GRADES,
    SheetSpec,
    browser_extract,
    grid_json,
    history_payload,
    history_text,
    modern_rows,
    term_row,
    write_workbook,
)

IMPORTS = "/api/website/v1/admin/admissions/imports"
TERMS = {"104上": SheetSpec(rows=modern_rows()), "104下": SheetSpec(rows=modern_rows())}


def _sheets(directory: Path, terms: dict[str, SheetSpec] | None = None) -> list[dict]:
    """合成檔 → read_grids → 瀏覽器擷取 → 送給伺服器的 JSON（和前端做的事一樣）。"""
    path = write_workbook(directory, terms or TERMS)
    return [grid_json(browser_extract(grid)) for grid in read_grids(path)]


def _sheet(**changes) -> dict:
    """一張最小的合法工作表（內容不需要解析得通，只用來測 schema）。"""
    sheet = {"name": "104上", "width": 3, "rows": {"2": [None, "a", 1], "3": [None, 1.5, {"masked": True}]}}
    sheet.update(changes)
    return sheet


async def _count(db, model=CampusTermEnrollment) -> int:
    return (await db.execute(select(func.count()).select_from(model))).scalar_one()


async def _audit(db, action: str | None = None) -> list[AuditLogEntry]:
    query = select(AuditLogEntry).order_by(AuditLogEntry.created_at)
    if action is not None:
        query = query.where(AuditLogEntry.action == action)
    return list((await db.execute(query.execution_options(populate_existing=True))).scalars())


async def _seed(db, rows: list[dict], campus_key: str = "yihua") -> None:
    await replace_history(db, load_history_payload(history_text(history_payload(rows, campus_key=campus_key))))
    await db.commit()


def _four_grades(school_year: int, semester: int, **by_grade: int) -> list[dict]:
    """某學期四個年級的假列；registered 預設照 modern_rows，by_grade 可以逐年級覆蓋。"""
    base = {grade: values["registered"] for grade, values in modern_rows().items()}
    base.update(by_grade)
    return [term_row(school_year, semester, grade, registered=base[grade]) for grade in GRADES]


def _requests(campus_key: str, sheets: list[dict]) -> list[tuple[str, str, dict]]:
    query = f"?campus_key={campus_key}"
    return [
        ("POST", f"{IMPORTS}/history/preview{query}", {"sheets": sheets}),
        ("POST", f"{IMPORTS}/history/apply{query}", history_payload()),
    ]


async def test_permissions(
    reception_yihua_client, readonly_yihua_client, minghua_client, editor_client, admin_client, public_client, tmp_path
):
    """限總管理者（admissions.stats）：其他角色不論本校或他校一律 403；未登入 401；不存在的校區 404。"""
    sheets = _sheets(tmp_path)
    for client in (reception_yihua_client, readonly_yihua_client, minghua_client, editor_client):
        for campus_key in ("yihua", "minghua"):
            for method, path, body in _requests(campus_key, sheets):
                assert (await client.request(method, path, json=body)).status_code == 403, (method, path)
    for method, path, body in _requests("yihua", sheets):
        response = await admin_client.request(method, path, json=body)
        assert response.status_code == 200, (method, path, response.text)
    for method, path, body in _requests("nowhere", sheets):
        assert (await admin_client.request(method, path, json=body)).status_code == 404, (method, path)
    for method, path, body in _requests("yihua", sheets):
        assert (await public_client.request(method, path, json=body)).status_code == 401, (method, path)


async def test_hidden_when_admissions_are_disabled(admin_client, tmp_path):
    """admin_client 只為了建好總管理者帳號；這裡用另一個關掉招生的 app 登入。"""
    disabled = create_app(_test_settings().model_copy(update={"admissions_enabled": False}))
    client = await _logged_in_client(disabled, "admin@ivy.example", "super-admin-password-123")
    try:
        for method, path, body in _requests("yihua", _sheets(tmp_path)):
            assert (await client.request(method, path, json=body)).status_code == 404, (method, path)
    finally:
        await client.aclose()
        await disabled.state.engine.dispose()
        await disabled.state.rate_limit_engine.dispose()


async def test_preview_matches_the_cli(admin_client, tmp_path):
    path = write_workbook(tmp_path, TERMS)
    sheets = [grid_json(browser_extract(grid)) for grid in read_grids(path)]
    response = await admin_client.post(f"{IMPORTS}/history/preview?campus_key=yihua", json={"sheets": sheets})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["payload"] == json.loads(json.dumps(build_payload(parse_workbook(path), "yihua")))
    assert (body["rows"], body["first"], body["last"]) == (8, {"school_year": 104, "semester": 1}, {"school_year": 104, "semester": 2})
    assert (body["removed_terms"], body["changed"], body["warnings"]) == ([], [], [])


async def test_preview_reports_the_warnings_of_the_cli(admin_client, tmp_path):
    """總人數對不上的警告原樣帶出，也寫進可以送回 apply 的 payload。"""
    spec = SheetSpec(rows=modern_rows(), total={"registered": 999})
    path = write_workbook(tmp_path, {"104上": spec})
    sheets = [grid_json(browser_extract(grid)) for grid in read_grids(path)]
    body = (await admin_client.post(f"{IMPORTS}/history/preview?campus_key=yihua", json={"sheets": sheets})).json()
    assert len(body["warnings"]) == 1 and "總人數 999" in body["warnings"][0]
    assert body["payload"]["warnings"] == body["warnings"]


async def test_preview_orders_terms_whatever_the_sheet_order(admin_client, tmp_path):
    terms = {"105上": SheetSpec(rows=modern_rows()), "103下": SheetSpec(rows=modern_rows()), "104上": SheetSpec(rows=modern_rows())}
    body = (await admin_client.post(f"{IMPORTS}/history/preview?campus_key=yihua", json={"sheets": _sheets(tmp_path, terms)})).json()
    assert (body["rows"], body["first"], body["last"]) == (12, {"school_year": 103, "semester": 2}, {"school_year": 105, "semester": 1})


async def test_preview_writes_nothing(admin_client, db_session, tmp_path):
    await _seed(db_session, _four_grades(103, 1))
    audits_before = len(await _audit(db_session))
    response = await admin_client.post(f"{IMPORTS}/history/preview?campus_key=yihua", json={"sheets": _sheets(tmp_path)})
    assert response.status_code == 200, response.text
    stored = (await db_session.execute(select(CampusTermEnrollment.school_year, CampusTermEnrollment.semester).execution_options(populate_existing=True))).all()
    assert sorted(set(stored)) == [(103, 1)] and len(stored) == 4
    assert len(await _audit(db_session)) == audits_before


async def test_preview_lists_removed_and_changed_terms(admin_client, db_session, tmp_path):
    """資料庫有 103上＋104上；新檔 104上（大班改了）＋105上 → 103上被移除、只有 104上 大班不同。"""
    await _seed(db_session, [*_four_grades(103, 1), *_four_grades(104, 1, 大班=60)])
    terms = {"105上": SheetSpec(rows=modern_rows()), "104上": SheetSpec(rows=modern_rows())}
    body = (await admin_client.post(f"{IMPORTS}/history/preview?campus_key=yihua", json={"sheets": _sheets(tmp_path, terms)})).json()
    assert body["removed_terms"] == [{"school_year": 103, "semester": 1}]
    assert body["changed"] == [{"school_year": 104, "semester": 1, "grade": "大班", "before": 60, "after": 62}]
    assert (body["rows"], body["first"], body["last"]) == (8, {"school_year": 104, "semester": 1}, {"school_year": 105, "semester": 1})


async def test_preview_ignores_other_campuses_when_diffing(admin_client, db_session, tmp_path):
    await _seed(db_session, _four_grades(103, 1), campus_key="minghua")
    body = (await admin_client.post(f"{IMPORTS}/history/preview?campus_key=yihua", json={"sheets": _sheets(tmp_path)})).json()
    assert (body["removed_terms"], body["changed"]) == ([], [])
    assert body["payload"]["campus_key"] == "yihua"


async def test_invalid_workbook_returns_masked_headers(admin_client, tmp_path, caplog):
    caplog.set_level(logging.DEBUG)
    sheets = _sheets(tmp_path, {"工作表1": SheetSpec(rows=modern_rows())})
    response = await admin_client.post(f"{IMPORTS}/history/preview?campus_key=yihua", json={"sheets": sheets})
    assert response.status_code == 422, response.text
    detail = response.json()["detail"]
    assert detail["code"] == "HISTORY_WORKBOOK_INVALID"
    assert "工作表1" in detail["message"]
    [header] = detail["headers"]
    assert header["name"] == "工作表1"
    assert set(header) == {"name", "row2", "row3", "labels"}
    assert "舊生" in header["row2"] and header["labels"][4] == "大班"
    for sentence in FAKE_NOTES:
        assert sentence not in response.text and sentence not in caplog.text
    for name in ("王小明", "李小華", "陳小美"):
        assert name not in response.text and name not in caplog.text


async def test_invalid_workbook_never_echoes_label_cells(admin_client, tmp_path, caplog):
    """第 0 欄不是年級／總人數標籤的格子（備註、姓名）在 headers.labels 裡一律是「…」，整份回應與日誌都不含內容。"""
    caplog.set_level(logging.DEBUG)
    sheets = _sheets(tmp_path, {"工作表1": SheetSpec(rows=modern_rows())})
    width = sheets[0]["width"]
    sheets[0]["rows"]["5"] = ["測試小明"] + [None] * (width - 1)
    response = await admin_client.post(f"{IMPORTS}/history/preview?campus_key=yihua", json={"sheets": sheets})
    assert response.status_code == 422, response.text
    detail = response.json()["detail"]
    assert detail["code"] == "HISTORY_WORKBOOK_INVALID"
    labels = detail["headers"][0]["labels"]
    assert labels[5] == "…"
    assert labels[4] == "大班" and labels[0] == ""
    assert "測試小明" not in response.text and "測試小明" not in caplog.text


async def test_workbook_errors_only_name_sheets_and_columns(admin_client, tmp_path):
    """表頭缺「新生」區塊 → 訊息點名工作表與欄位，不帶任何格子內容。"""
    sheets = _sheets(tmp_path)
    sheets[0]["rows"]["2"] = [cell if cell != "新生" else None for cell in sheets[0]["rows"]["2"]]
    response = await admin_client.post(f"{IMPORTS}/history/preview?campus_key=yihua", json={"sheets": sheets})
    detail = response.json()["detail"]
    assert response.status_code == 422 and detail["code"] == "HISTORY_WORKBOOK_INVALID"
    assert detail["message"] == "104上：第 2 列找不到「新生」欄"
    assert detail["headers"][0]["name"] == "104上"


async def test_preview_reports_invalid_payload(admin_client, tmp_path):
    """表本身看得懂、但學年超出範圍（98 比 99 上早）→ 解析出的資料過不了匯入端的檢查，回 HISTORY_PAYLOAD_INVALID。"""
    sheets = _sheets(tmp_path, {"98上": SheetSpec(rows=modern_rows())})
    response = await admin_client.post(f"{IMPORTS}/history/preview?campus_key=yihua", json={"sheets": sheets})
    assert response.status_code == 422, response.text
    detail = response.json()["detail"]
    assert detail["code"] == "HISTORY_PAYLOAD_INVALID"
    assert "rows.0.school_year：greater_than_equal" in detail["message"]


@pytest.mark.parametrize(
    "sheet",
    [
        pytest.param(_sheet(rows={"2": [{"masked": False}]}), id="masked-false"),
        pytest.param(_sheet(rows={"2": [{"masked": True, "name": "測試小明"}]}), id="masked-with-extra-key"),
        pytest.param(_sheet(rows={"2": [[1]]}), id="nested-array"),
        pytest.param(_sheet(rows={"2": [{}]}), id="empty-object"),
        pytest.param(_sheet(rows={"2": [True]}), id="bool-true"),
        pytest.param(_sheet(rows={"2": [False]}), id="bool-false"),
        pytest.param(_sheet(rows={"2": [10**400]}), id="huge-int"),
        pytest.param(_sheet(rows={"2": ["義" * 201]}), id="long-string"),
        pytest.param(_sheet(rows={"1": [1]}), id="row-1"),
        pytest.param(_sheet(rows={"0": [1]}), id="row-0"),
        pytest.param(_sheet(rows={"1000": [1]}), id="row-1000"),
        pytest.param(_sheet(rows={"-2": [1]}), id="row-negative"),
        pytest.param(_sheet(rows={"測試小明": [1]}), id="row-key-not-a-number"),
        pytest.param(_sheet(rows={str(n): [1] for n in range(2, 10)}), id="eight-rows"),
        pytest.param(_sheet(rows={"2": [1, 2, 3, 4]}), id="row-longer-than-width"),
        pytest.param(_sheet(width=65), id="width-65"),
        pytest.param(_sheet(width=0, rows={}), id="width-0"),
        pytest.param(_sheet(name=""), id="empty-name"),
        pytest.param(_sheet(name="義" * 21), id="long-name"),
        pytest.param(_sheet(rows=[[1]]), id="rows-as-list"),
        pytest.param(_sheet(extra="x"), id="extra-sheet-key"),
    ],
)
async def test_preview_rejects_unknown_cell_shapes(admin_client, sheet):
    response = await admin_client.post(f"{IMPORTS}/history/preview?campus_key=yihua", json={"sheets": [sheet]})
    assert response.status_code == 422, response.text
    assert response.json()["detail"]["code"] == "INVALID_IMPORT_PAYLOAD"
    assert "測試小明" not in response.text and "義義義" not in response.text


@pytest.mark.parametrize("sheets", [[], [_sheet()] * 101], ids=["no-sheets", "101-sheets"])
async def test_preview_rejects_bad_sheet_counts(admin_client, sheets):
    response = await admin_client.post(f"{IMPORTS}/history/preview?campus_key=yihua", json={"sheets": sheets})
    assert response.status_code == 422, response.text
    assert response.json()["detail"]["code"] == "INVALID_IMPORT_PAYLOAD"


async def test_preview_rejects_unreadable_bodies_without_echo(admin_client):
    path = f"{IMPORTS}/history/preview?campus_key=yihua"
    headers = {"content-type": "application/json"}
    broken = await admin_client.post(path, content='{"sheets": [{"name": "測試小明"', headers=headers)
    assert broken.status_code == 422 and broken.json()["detail"]["code"] == "INVALID_IMPORT_PAYLOAD"
    assert "測試小明" not in broken.text
    wrong_type = await admin_client.post(path, json=["測試小明"])
    assert wrong_type.status_code == 422 and wrong_type.json()["detail"]["code"] == "INVALID_IMPORT_PAYLOAD"
    assert "測試小明" not in wrong_type.text


async def test_preview_validation_errors_list_positions_without_values(admin_client):
    """位置與錯誤種類；多餘欄位與非數字的列號（可能是姓名）都不印。"""
    response = await admin_client.post(
        f"{IMPORTS}/history/preview?campus_key=yihua",
        json={"sheets": [_sheet(rows={"測試小明": [1]}, 測試小華="x")]},
    )
    detail = response.json()["detail"]
    assert response.status_code == 422 and detail["code"] == "INVALID_IMPORT_PAYLOAD"
    assert "sheets.0.（多餘欄位）：extra_forbidden" in detail["message"]
    assert "測試小明" not in response.text and "測試小華" not in response.text


@pytest.mark.parametrize(
    "rows",
    [
        pytest.param({"測試小明": [True]}, id="bool-value"),
        pytest.param({"測試小明": [{"masked": False}]}, id="bad-masked-value"),
        pytest.param({"測試小明": "x"}, id="not-a-list"),
        pytest.param({"測試小明": [1, 2, 3, 4, 5]}, id="long-row"),
        pytest.param({"Alice小明": [True], "2": [{"masked": False}], "測試小華": [[1]]}, id="several-keys"),
    ],
)
async def test_preview_never_echoes_a_bad_row_key_in_value_errors(admin_client, rows):
    """列號不是數字時，鍵本身和這個鍵底下的值的錯誤位置（pydantic 各自回報）都不能印出那個鍵。"""
    response = await admin_client.post(
        f"{IMPORTS}/history/preview?campus_key=yihua", json={"sheets": [_sheet(rows=rows)]}
    )
    detail = response.json()["detail"]
    assert response.status_code == 422 and detail["code"] == "INVALID_IMPORT_PAYLOAD"
    assert "（鍵）" in detail["message"]
    for leaked in ("測試小明", "測試小華", "Alice"):
        assert leaked not in response.text


def test_describe_masks_bad_keys_only_where_the_key_failed():
    """合法的鍵（數字）照常印出位置；驗不過的鍵遮住，包括它底下的錯誤與多餘欄位。"""
    from app.admissions.import_routes import _describe

    errors = [
        {"loc": ("body", "sheets", 0, "rows", "測試小明", "[key]"), "type": "int_parsing"},
        {"loc": ("body", "sheets", 0, "rows", "測試小明", 0, "constrained-int"), "type": "int_type"},
        {"loc": ("body", "sheets", 0, "rows", 2, 1), "type": "int_type"},
        {"loc": ("body", "sheets", 0, "rows", "測試小明", "測試小華"), "type": "extra_forbidden"},
    ]
    message = _describe(errors)
    assert "測試小明" not in message and "測試小華" not in message
    assert message == (
        "上傳的資料格式不對（sheets.0.rows.（鍵）.[key]：int_parsing；sheets.0.rows.（鍵）.0.constrained-int：int_type；"
        "sheets.0.rows.2.1：int_type；sheets.0.rows.（鍵）.（多餘欄位）：extra_forbidden）"
    )


async def test_preview_accepts_the_largest_shape_within_the_body_limit(admin_client):
    """100 張表 × 7 列 × 64 欄全是遮住的格子：通過格式檢查（接著因為表頭看不懂回 HISTORY_WORKBOOK_INVALID），
    而且 JSON 在 1 MB 本文上限內。"""
    rows = {str(n): [{"masked": True}] * 64 for n in (2, 3, 4, 5, 6, 7, 8)}
    sheets = [{"name": f"{99 + n // 2}{'上' if n % 2 == 0 else '下'}", "width": 64, "rows": rows} for n in range(100)]
    content = json.dumps({"sheets": sheets}, ensure_ascii=False).encode()
    assert len(content) < 1024 * 1024
    response = await admin_client.post(
        f"{IMPORTS}/history/preview?campus_key=yihua", content=content, headers={"content-type": "application/json"}
    )
    assert response.status_code == 422, response.text[:200]
    assert response.json()["detail"]["code"] == "HISTORY_WORKBOOK_INVALID"


def test_sheet_to_grid_keeps_kind_and_value_consistent():
    sheet = HistorySheetIn.model_validate(
        {"name": "104上", "width": 6, "rows": {"2": [None, 3, 2.5, "文字", {"masked": True}, 0], "3": []}}
    )
    grid = sheet.to_grid()
    assert (grid.name, grid.width) == ("104上", 6)
    assert grid.rows[2] == [EMPTY, GridCell("number", 3.0), GridCell("number", 2.5), GridCell("text", "文字"), MASKED, GridCell("number", 0.0)]
    assert isinstance(grid.rows[2][1].value, float)  # 整數也轉成 float，和 xlrd 讀進來的數字格一樣
    assert grid.rows[3] == []


async def test_apply_replaces_history_and_audits(admin_client, db_session, tmp_path):
    await _seed(db_session, _four_grades(103, 1))
    await _seed(db_session, _four_grades(103, 1), campus_key="minghua")
    preview = (await admin_client.post(f"{IMPORTS}/history/preview?campus_key=yihua", json={"sheets": _sheets(tmp_path)})).json()
    response = await admin_client.post(f"{IMPORTS}/history/apply?campus_key=yihua", json=preview["payload"])
    assert response.status_code == 200, response.text
    assert response.json() == {"rows": 8}

    stored = (await db_session.execute(select(CampusTermEnrollment).execution_options(populate_existing=True))).scalars().all()
    by_campus: dict[str, set[tuple[int, int]]] = {}
    for row in stored:
        by_campus.setdefault(row.campus_key, set()).add((row.school_year, row.semester))
    assert by_campus == {"yihua": {(104, 1), (104, 2)}, "minghua": {(103, 1)}}
    assert sum(row.campus_key == "yihua" for row in stored) == 8 and sum(row.campus_key == "minghua" for row in stored) == 4

    status_body = (await admin_client.get(f"{IMPORTS}/status?campus_key=yihua")).json()
    history = status_body["history"]
    assert (history["rows"], history["first_school_year"], history["first_semester"]) == (8, 104, 1)
    assert (history["last_school_year"], history["last_semester"]) == (104, 2)

    [entry] = await _audit(db_session, "enrollment_history.import")
    assert (entry.target_type, entry.target_id, entry.campus_key) == ("enrollment_history", "yihua", "yihua")
    assert set(entry.metadata_json) == {"term_rows", "first_term", "last_term"}
    assert entry.metadata_json == {"term_rows": 8, "first_term": "104上", "last_term": "104下"}


async def test_apply_twice_keeps_one_copy(admin_client, db_session, tmp_path):
    preview = (await admin_client.post(f"{IMPORTS}/history/preview?campus_key=yihua", json={"sheets": _sheets(tmp_path)})).json()
    for _ in range(2):
        response = await admin_client.post(f"{IMPORTS}/history/apply?campus_key=yihua", json=preview["payload"])
        assert response.status_code == 200, response.text
    assert await _count(db_session) == 8
    assert len(await _audit(db_session, "enrollment_history.import")) == 2


async def test_apply_rejects_other_campus(admin_client, db_session):
    response = await admin_client.post(f"{IMPORTS}/history/apply?campus_key=minghua", json=history_payload())
    assert response.status_code == 422, response.text
    assert response.json()["detail"]["code"] == "CAMPUS_MISMATCH"
    assert await _count(db_session) == 0
    assert await _audit(db_session, "enrollment_history.import") == []


async def test_apply_rejects_bad_payloads_without_echo(admin_client, db_session):
    leaked = {**term_row(), "name": "測試小明"}
    response = await admin_client.post(f"{IMPORTS}/history/apply?campus_key=yihua", json=history_payload([leaked]))
    assert response.status_code == 422, response.text
    assert response.json()["detail"]["code"] == "INVALID_IMPORT_PAYLOAD"
    assert "測試小明" not in response.text
    assert await _count(db_session) == 0
    duplicated = await admin_client.post(f"{IMPORTS}/history/apply?campus_key=yihua", json=history_payload([term_row(), term_row()]))
    assert duplicated.status_code == 422 and duplicated.json()["detail"]["code"] == "INVALID_IMPORT_PAYLOAD"
    assert await _count(db_session) == 0


@pytest.mark.parametrize("path", ["history/preview", "history/apply"])
async def test_requires_a_campus_key(admin_client, path):
    response = await admin_client.post(f"{IMPORTS}/{path}", json={})
    assert response.status_code == 422
