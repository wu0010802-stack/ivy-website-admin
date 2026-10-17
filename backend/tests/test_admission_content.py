"""入學資訊頁（admission_content）搬進 CMS：payload 規則與初始化。"""
from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.content.initialize import _copy_fields, initial_payloads
from app.content.registry import CONTENT_KIND_REGISTRY
from app.content.schemas import AdmissionContentPayload

FIXTURE = Path(__file__).resolve().parents[2] / "web" / "server" / "data" / "site-fixture.json"


def _payload() -> dict:
    return _copy_fields(json.loads(FIXTURE.read_text())["admission"], "admission_content")


def test_fixture_admission_validates_and_is_shared_only():
    payload = AdmissionContentPayload.model_validate(_payload())
    assert len(payload.steps) == 6
    assert len(payload.refunds) == 5
    assert CONTENT_KIND_REGISTRY["admission_content"].shared_only is True


@pytest.mark.asyncio
async def test_initialize_publishes_the_fixture_admission_copy(db_session):
    # 內容 fixture 只剩 web/server/data/ 一份（2026-10-12 合一，後端初始化也讀它）：
    # 初始化後已發布的版本要等於 fixture 那段文案，CMS 發布前後畫面才不會跳。
    from app.content import service
    from app.content.initialize import initialize_content

    await initialize_content(db_session, json.loads(FIXTURE.read_text()))
    published = await service.published_payload(db_session, "admission_content", None)
    assert published == AdmissionContentPayload.model_validate(_payload()).model_dump()


def test_initialize_includes_admission_content():
    kinds = [kind for kind, _campus, _payload in initial_payloads(json.loads(FIXTURE.read_text()))]
    assert kinds.count("admission_content") == 1


def test_blank_list_entries_are_dropped_not_published():
    data = _payload()
    data["phases"][0]["items"] = ["牙刷", "  ", ""]
    data["pickup_notes"] = ["", "請出示接送證"]
    payload = AdmissionContentPayload.model_validate(data)
    assert payload.phases[0].items == ["牙刷"]
    assert payload.pickup_notes == ["請出示接送證"]


def test_notice_may_be_empty_to_hide_it():
    data = _payload()
    data["notice"] = ""
    assert AdmissionContentPayload.model_validate(data).notice == ""


@pytest.mark.parametrize(
    "mutate",
    [
        lambda d: d.update(steps=[]),
        lambda d: d.update(steps=d["steps"] * 2),
        lambda d: d["steps"][0].update(title="  "),
        lambda d: d.update(subsidies=[{"amount": "", "unit": "元／月", "who": "大班", "by": "教育部"}]),
        lambda d: d["refunds"][0].update(groups=[]),
        lambda d: d["refunds"][0]["groups"][0].update(lines=["", " "]),
        lambda d: d.update(uniform_week=d["uniform_week"] * 2),
    ],
)
def test_rejects_empty_or_oversized_sections(mutate):
    data = copy.deepcopy(_payload())
    mutate(data)
    with pytest.raises(ValidationError):
        AdmissionContentPayload.model_validate(data)


@pytest.mark.parametrize(
    "mutate",
    [
        lambda d: d.update(notice="javascript:alert(1)"),
        lambda d: d["steps"][0].update(text=" JavaScript:alert(1)"),
        lambda d: d["phases"][0]["tips"].append("javascript:alert(1)"),
        lambda d: d["refunds"][1]["groups"][0]["lines"].append("data:text/html,x"),
    ],
)
def test_rejects_script_schemes_anywhere_in_nested_copy(mutate):
    data = copy.deepcopy(_payload())
    mutate(data)
    with pytest.raises(ValidationError):
        AdmissionContentPayload.model_validate(data)
