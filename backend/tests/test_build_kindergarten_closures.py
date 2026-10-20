"""停辦回補腳本 scripts/build_kindergarten_closures.py（2026-10-20 延伸到 2022-08）：不連網，
把 gh 換成假的 GitHub（commit 歷史＋各版的教育部名單與 preschools.json），用假版本驗證每月取樣、逐版找離開日、
改名判斷、合併舊檔與欄位來源。"""

from __future__ import annotations

import csv
import importlib.util
import io
import json
import sys
import urllib.parse
from datetime import date
from pathlib import Path

import pytest

from app.admissions.geo.closure_backfill import ClosureBackfill, load_closure_backfill

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "build_kindergarten_closures.py"


@pytest.fixture
def script():
    """scripts/ 不是套件：照路徑載入（dataclass 要在 sys.modules 裡找得到模組）。"""
    spec = importlib.util.spec_from_file_location("build_kindergarten_closures_for_test", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    yield module
    sys.modules.pop(spec.name, None)


# ---- 假的教育部名單與 preschools.json ----

REG = "docs/data/高雄市.csv"
PRE = "docs/preschools.json"


class Kg:
    """一所假幼兒園：名單的（立案文號、名稱、地址、設立日）與 preschools.json 的 id、核定、座標、類型。"""

    def __init__(self, name, *, address=None, reg_date="2010/1/1", capacity="100", type_="私立", pre_public="無", lat=22.6, lng=120.3):
        self.name = name
        self.docno = f"文號-{name}"
        self.id = f"id-{name}"
        self.address = address or f"[800]{name}路1號"
        self.reg_date = reg_date
        self.capacity = capacity
        self.type_ = type_
        self.pre_public = pre_public
        self.lat, self.lng = lat, lng

    def feature(self, **changes):
        props = {
            "id": self.id, "city": "高雄市", "town": "三民區", "reg_docno": self.docno, "title": self.name,
            "type": self.type_, "address": self.address, "count_approved": self.capacity, "pre_public": self.pre_public,
            "reg_date": self.reg_date, "is_active": 1, **changes,
        }
        return {"type": "Feature", "properties": props, "geometry": {"type": "Point", "coordinates": [self.lng, self.lat]}}


def registry_text(kgs) -> str:
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\n")
    writer.writerow(["reg_no", "reg_docno", "reg_date", "title", "city", "town", "type", "address"])
    for kg in kgs:
        writer.writerow(["", kg.docno, kg.reg_date, kg.name, "高雄市", "三民區", kg.type_, kg.address])
    return out.getvalue()


# 每一版名單都多這 40 所不會離開的園所：真實名單約 700 所，少一兩所不能被當成殘缺版本（腳本會略過列數掉太多的月底版）。
PAD = [Kg(f"填{n:02d}") for n in range(40)]


def reg(*kgs) -> str:
    return registry_text([*kgs, *PAD])


def preschools_text(features) -> str:
    return json.dumps({"type": "FeatureCollection", "features": list(features)}, ensure_ascii=False)


class FakeRepo:
    """假的 kiang/ap.ece.moe.edu.tw：commit 由舊到新用 add() 加；gh() 取代 script.gh，並記下呼叫。"""

    def __init__(self, script):
        self.script = script
        self.commits: list[tuple[str, str]] = []  # 新到舊：(sha, UTC 時間)
        self.files: dict[tuple[str, str], str] = {}
        self.calls: list[tuple[str, ...]] = []

    def add(self, sha, stamp, kgs, features=None, *, registry=None):
        self.commits.insert(0, (sha, stamp))
        self.files[(REG, sha)] = registry if registry is not None else reg(*kgs)
        if features is not None:
            self.files[(PRE, sha)] = preschools_text(features)

    def install(self, monkeypatch):
        monkeypatch.setattr(self.script, "gh", self.gh)

    def gh(self, *args):
        self.calls.append(args)
        endpoint = next(arg for arg in args if arg.startswith("repos/"))
        if endpoint.endswith("/commits/master"):
            return self.commits[0][0] + "\n"
        if "/commits?" in endpoint:
            query = urllib.parse.parse_qs(endpoint.split("?", 1)[1])
            since = query["since"][0]
            return "".join(f"{sha}\t{stamp}\n" for sha, stamp in self.commits if stamp >= since)
        path, sha = endpoint.split("/contents/", 1)[1].split("?ref=")
        try:
            return self.files[(urllib.parse.unquote(path), sha)]
        except KeyError:
            raise self.script.GhError(f"gh: Not Found (HTTP 404)：{path}@{sha}", not_found=True) from None

    def fetches(self, path):
        return [call for call in self.calls if any(f"/contents/{urllib.parse.quote(path)}" in arg for arg in call)]


def build(script, monkeypatch, repo, *, since=date(2026, 8, 1), merge=None):
    repo.install(monkeypatch)
    rows, stats = script.build_rows(since, merge)
    return {row["source_id"]: row for row in rows}, stats


# 三個月份（8、9、10 月），每月多個版本；時間用 UTC 04:00（台北中午），不跨日。
JIA = Kg("甲", address="[800]甲路1號")
YI = Kg("乙", address="[800]乙路2號")
BING = Kg("丙", address="[800]丙路3號", reg_date="2012/3/4", capacity="120")


def three_months(repo, *, bing_features_v2=None):
    """8/15 v1、8/31 v2（8 月底）、9/5 v2b、9/10 v3 都有丙；9/20 v4 起丙不見；9/30 v5（9 月底）、10/10 v6（最新）都沒有丙。"""
    base = [JIA.feature(), YI.feature()]
    repo.add("v1", "2026-08-15T04:00:00Z", [JIA, YI, BING], base + [BING.feature(count_approved="90")])
    repo.add("v2", "2026-08-31T04:00:00Z", [JIA, YI, BING], base + (bing_features_v2 or [BING.feature(count_approved="95")]))
    repo.add("v2b", "2026-09-05T04:00:00Z", [JIA, YI, BING], base + [BING.feature(count_approved="100")])
    repo.add("v3", "2026-09-10T04:00:00Z", [JIA, YI, BING], base + [BING.feature(count_approved="120")])
    repo.add("v4", "2026-09-20T04:00:00Z", [JIA, YI], base)
    repo.add("v5", "2026-09-30T04:00:00Z", [JIA, YI], base)
    repo.add("v6", "2026-10-10T04:00:00Z", [JIA, YI], base)


def test_left_on_refined_within_month(script, monkeypatch):
    """9 月底版本少了丙，但 9/10 的 v3 還有、9/20 的 v4 沒有：離開日是最新含它的版本（v3）的下一版（v4）。"""
    repo = FakeRepo(script)
    three_months(repo)
    rows, _ = build(script, monkeypatch, repo)
    assert set(rows) == {BING.id}
    assert rows[BING.id]["left_on"] == "2026-09-20"
    assert rows[BING.id]["reason"] == "closed"
    assert rows[BING.id]["name"] == "丙"


def test_only_month_end_versions_and_the_departure_interval_are_downloaded(script, monkeypatch):
    """樣本是最舊版 v1 與每月最後一版 v2、v5、v6；丙在 v2 到 v5 之間離開，所以只再掃 v4、v3（找到 v3 就停）。
    9/5 的 v2b 比 v3 舊，沒必要抓。"""
    repo = FakeRepo(script)
    three_months(repo)
    build(script, monkeypatch, repo)
    scanned = [call[-1].split("?ref=")[1] for call in repo.fetches(REG)]
    assert sorted(scanned) == ["v1", "v2", "v3", "v4", "v5", "v6"]  # v2b 沒抓；每個版本只抓一次


def test_fields_from_last_preschools_version(script, monkeypatch):
    """名稱、核定、座標、類型取自丙「離開前最後一版」（v3）的 preschools.json，不是 8 月底（v2）也不是最新版。"""
    repo = FakeRepo(script)
    moved = BING.feature(count_approved="95")
    moved["geometry"]["coordinates"] = [120.31, 22.61]
    three_months(repo, bing_features_v2=[moved])
    repo.files[(PRE, "v3")] = preschools_text(
        [JIA.feature(), YI.feature(), BING.feature(count_approved="120", pre_public="無")]
    )
    rows, _ = build(script, monkeypatch, repo)
    row = rows[BING.id]
    assert (row["approved_capacity"], row["lat"], row["lng"], row["kind"]) == ("120", "22.6", "120.3", "private")


def test_quasi_public_kind_follows_the_school_year_of_the_departure(script, monkeypatch):
    """準公共期間 113-115：2026-09 離開（115 學年）算準公共；2024-03 離開（112 學年）還是私立。"""
    repo = FakeRepo(script)
    late = Kg("晚", pre_public="113-115")
    early = Kg("早", pre_public="113-115")
    feats = lambda *extra: [JIA.feature(), *extra]  # noqa: E731
    repo.add("a1", "2024-02-10T04:00:00Z", [JIA, early], feats(early.feature()))
    repo.add("a2", "2024-03-10T04:00:00Z", [JIA], feats())
    repo.add("a3", "2026-08-31T04:00:00Z", [JIA, late], feats(late.feature()))
    repo.add("a4", "2026-09-15T04:00:00Z", [JIA], feats())
    rows, _ = build(script, monkeypatch, repo, since=date(2024, 1, 1))
    assert rows[early.id]["left_on"] == "2024-03-10"
    assert rows[early.id]["kind"] == "private"
    assert rows[late.id]["left_on"] == "2026-09-15"
    assert rows[late.id]["kind"] == "quasi_public"


def test_fields_are_blank_but_the_row_stays_when_the_coordinates_are_unusable(script, monkeypatch):
    repo = FakeRepo(script)
    bad = Kg("壞", lat=0.0, lng=0.0)  # 座標不在高雄外框，parse_preschools 不收這一筆
    repo.add("b1", "2026-08-31T04:00:00Z", [JIA, bad], [JIA.feature(), bad.feature()])
    repo.add("b2", "2026-09-15T04:00:00Z", [JIA], [JIA.feature()])
    rows, _ = build(script, monkeypatch, repo)
    row = rows[bad.id]
    assert row["left_on"] == "2026-09-15"
    assert (row["approved_capacity"], row["lat"], row["lng"], row["kind"]) == ("", "", "", "")


def test_a_departed_kindergarten_with_no_preschools_feature_is_skipped_and_counted(script, monkeypatch):
    """preschools.json 從沒有它（最後一版、最新版都找不到）＝沒有 source_id，寫不出一列；只計數。"""
    repo = FakeRepo(script)
    ghost = Kg("無影")
    repo.add("c1", "2026-08-31T04:00:00Z", [JIA, ghost], [JIA.feature()])
    repo.add("c2", "2026-09-15T04:00:00Z", [JIA], [JIA.feature()])
    rows, stats = build(script, monkeypatch, repo)
    assert rows == {}
    assert stats.unmatched == 1


def test_a_version_without_preschools_json_falls_back_to_the_latest_one(script, monkeypatch):
    """離開前最後一版沒有 preschools.json（404）時，改用最新版的那一筆（幽靈：kiang 還標營業中）。"""
    repo = FakeRepo(script)
    ghost = Kg("幽靈", capacity="77")
    repo.add("d1", "2026-08-31T04:00:00Z", [JIA, ghost])  # 沒有 preschools.json
    repo.add("d2", "2026-09-15T04:00:00Z", [JIA], [JIA.feature(), ghost.feature()])
    rows, _ = build(script, monkeypatch, repo)
    assert rows[ghost.id]["approved_capacity"] == "77"
    assert rows[ghost.id]["left_on"] == "2026-09-15"


def test_a_failed_download_is_not_mistaken_for_a_missing_file(script, monkeypatch):
    """404 以外的失敗（限流、斷線）不能當成「找不到」靜默留空。"""
    repo = FakeRepo(script)
    three_months(repo)
    repo.install(monkeypatch)
    real = repo.gh

    def flaky(*args):
        if PRE in "".join(urllib.parse.unquote(arg) for arg in args) and args[-1].endswith("?ref=v3"):
            raise script.GhError("gh api 失敗：HTTP 502")
        return real(*args)

    monkeypatch.setattr(script, "gh", flaky)
    with pytest.raises(script.GhError, match="502"):
        script.build_rows(date(2026, 8, 1), None)


# ---- 改名 ----


def test_rename_same_address_within_three_months(script, monkeypatch):
    """乙離開名單的同一個月，同地址冒出一所新的（不同設立日）：改名或換承辦，不是停辦。"""
    repo = FakeRepo(script)
    old = Kg("舊名", address="[800]同路9號", reg_date="2001/1/1")
    new = Kg("新名", address="[800]同路9號", reg_date="2026/9/20")
    repo.add("r1", "2026-08-31T04:00:00Z", [JIA, old], [JIA.feature(), old.feature()])
    repo.add("r2", "2026-09-15T04:00:00Z", [JIA], [JIA.feature()])
    repo.add("r3", "2026-09-30T04:00:00Z", [JIA, new], [JIA.feature(), new.feature()])
    rows, _ = build(script, monkeypatch, repo)
    assert rows[old.id]["reason"] == "renamed"
    assert rows[old.id]["left_on"] == "2026-09-15"


def test_rename_counts_a_new_kindergarten_that_appeared_before_the_old_one_left(script, monkeypatch):
    """先進後出也算（同址一進一出）：新的在 8 月底版本出現，舊的 9 月中才離開。"""
    repo = FakeRepo(script)
    old = Kg("舊名", address="[800]同路9號", reg_date="2001/1/1")
    new = Kg("新名", address="[800]同路9號", reg_date="2026/8/20")
    repo.add("s0", "2026-07-31T04:00:00Z", [JIA, old], [JIA.feature(), old.feature()])
    repo.add("s1", "2026-08-31T04:00:00Z", [JIA, old, new], [JIA.feature(), old.feature(), new.feature()])
    repo.add("s2", "2026-09-15T04:00:00Z", [JIA, new], [JIA.feature(), new.feature()])
    rows, _ = build(script, monkeypatch, repo, since=date(2026, 7, 1))
    assert rows[old.id]["reason"] == "renamed"


def _replaced_months_later(script, monkeypatch, new_reg_date):
    """舊園所 8/15 離開，同地址的新園所到隔年 1 月底才出現（中間每月底都有一版，沒有新的）。"""
    repo = FakeRepo(script)
    old = Kg("舊名", address="[800]同路9號", reg_date="2001/1/1")
    new = Kg("新名", address="[800]同路9號", reg_date=new_reg_date)
    repo.add("t0", "2026-07-31T04:00:00Z", [JIA, old], [JIA.feature(), old.feature()])
    repo.add("t1", "2026-08-15T04:00:00Z", [JIA], [JIA.feature()])
    months = ["2026-08-31", "2026-09-30", "2026-10-31", "2026-11-30", "2026-12-31"]
    for index, stamp in enumerate(months):
        repo.add(f"t{index + 2}", f"{stamp}T04:00:00Z", [JIA], [JIA.feature()])
    repo.add("t7", "2027-01-31T04:00:00Z", [JIA, new], [JIA.feature(), new.feature()])
    rows, _ = build(script, monkeypatch, repo, since=date(2026, 7, 1))
    return rows[old.id]


def test_not_renamed_when_the_new_one_at_the_same_address_comes_months_later(script, monkeypatch):
    """同地址的新園所半年後才出現：超過 3 個月，仍是停辦。"""
    row = _replaced_months_later(script, monkeypatch, "2027/1/5")
    assert row["left_on"] == "2026-08-15"
    assert row["reason"] == "closed"


def test_rename_by_the_same_address_and_registration_date_in_the_current_list(script, monkeypatch):
    """10-15 的規則照舊：現行名單上有同地址、同設立日的另一所（換了名稱），只下架；時間上離多遠都算。"""
    row = _replaced_months_later(script, monkeypatch, "2001/1/1")
    assert row["left_on"] == "2026-08-15"
    assert row["reason"] == "renamed"


def test_a_postal_prefix_does_not_hide_the_same_address(script, monkeypatch):
    repo = FakeRepo(script)
    old = Kg("舊名", address="[800]同路9號", reg_date="2001/1/1")
    new = Kg("新名", address="同路9號", reg_date="2026/9/20")  # 沒有郵遞區號前綴
    repo.add("p1", "2026-08-31T04:00:00Z", [JIA, old], [JIA.feature(), old.feature()])
    repo.add("p2", "2026-09-15T04:00:00Z", [JIA, new], [JIA.feature(), new.feature()])
    rows, _ = build(script, monkeypatch, repo)
    assert rows[old.id]["reason"] == "renamed"


# ---- 殘缺版本 ----


def test_a_truncated_month_end_version_is_not_used_as_the_sample(script, monkeypatch):
    """9 月底那版只剩零頭（歷史上有過 351 列的殘缺版），目標其實 10/20 才離開：不能拿殘缺版當 9 月樣本，
    否則「最後含它的樣本」退回 8 月底，離開日變成殘缺版那天（9/30）。"""
    repo = FakeRepo(script)
    target = Kg("目標")
    repo.add("e1", "2026-08-31T04:00:00Z", [target], [target.feature()])
    repo.add("e2", "2026-09-10T04:00:00Z", [target], [target.feature()])
    repo.add("e3", "2026-09-30T04:00:00Z", [], [], registry=registry_text(PAD[:5]))  # 殘缺：只有 5 列
    repo.add("e4", "2026-10-15T04:00:00Z", [target], [target.feature()])
    repo.add("e5", "2026-10-20T04:00:00Z", [], [PAD[0].feature()])
    rows, stats = build(script, monkeypatch, repo)
    assert rows[target.id]["left_on"] == "2026-10-20"
    assert stats.samples == 3  # 最舊 e1（也是 8 月底）、9 月改用 e2、最新 e5


def test_an_unreadable_old_version_counts_as_absent_instead_of_stopping_the_run(script, monkeypatch):
    """歷史上欄位不同或抓到 HTML 錯誤頁的版本：不丟例外，記數。"""
    repo = FakeRepo(script)
    repo.add("f1", "2026-08-31T04:00:00Z", [JIA, YI], [JIA.feature(), YI.feature()])
    repo.add("f2", "2026-09-10T04:00:00Z", [], registry="<html>Not Found</html>")
    repo.add("f3", "2026-09-20T04:00:00Z", [JIA], [JIA.feature(), YI.feature()])
    rows, stats = build(script, monkeypatch, repo)
    assert rows[YI.id]["left_on"] == "2026-09-10"  # f1 是最新讀得到又含它的版本
    assert stats.unreadable == 1


def test_a_truncated_latest_version_stops_the_run(script, monkeypatch):
    """最新一版只剩零頭（kiang 剛好抓壞）：不然所有不在這版的園所都會被當成剛離開。"""
    repo = FakeRepo(script)
    repo.add("h1", "2026-08-31T04:00:00Z", [JIA], [JIA.feature()])
    repo.add("h2", "2026-09-30T04:00:00Z", [JIA], [JIA.feature()])
    repo.add("h3", "2026-10-10T04:00:00Z", [], [PAD[0].feature()], registry=registry_text(PAD[:5]))
    with pytest.raises(SystemExit, match="最新一版.*疑似殘缺"):
        build(script, monkeypatch, repo)


def test_a_latest_version_that_lost_a_few_rows_is_fine(script, monkeypatch):
    repo = FakeRepo(script)
    repo.add("h1", "2026-08-31T04:00:00Z", [JIA, YI], [JIA.feature(), YI.feature()])
    repo.add("h2", "2026-10-10T04:00:00Z", [JIA], [JIA.feature()])
    rows, _ = build(script, monkeypatch, repo)
    assert set(rows) == {YI.id}


# ---- 合併舊檔 ----

OLD_HEADER = "source_id,name,left_on,reason\n"


def test_merge_keeps_old_dates(script, monkeypatch, tmp_path):
    """同 source_id 以舊檔的 left_on、reason 為準；舊檔沒有日期的補上新掃描的日期；掃描不到的舊列照留。"""
    repo = FakeRepo(script)
    three_months(repo)
    ghost = Kg("舊幽靈", capacity="55", type_="公立")  # 舊檔有、名單歷史裡沒有，preschools.json 最新版還有
    undated = Kg("沒日期")
    repo.add("g1", "2026-10-11T04:00:00Z", [JIA, YI], [JIA.feature(), YI.feature(), ghost.feature(), undated.feature()])
    # 沒日期那所在新掃描範圍內（8 月底有、9 月起沒有）
    repo.files[(REG, "v2")] = reg(JIA, YI, BING, undated)
    repo.files[(PRE, "v2")] = preschools_text([JIA.feature(), YI.feature(), BING.feature(), undated.feature()])
    merge = tmp_path / "old.csv"
    merge.write_text(
        OLD_HEADER
        + f"{BING.id},舊檔的丙名稱,2026-09-25,closed\n"  # 新掃描是 09-20，但以舊檔為準
        + f"{ghost.id},舊幽靈,,closed\n"
        + f"{undated.id},沒日期,,renamed\n",
        encoding="utf-8",
    )
    rows, stats = build(script, monkeypatch, repo, merge=merge)
    assert rows[BING.id]["left_on"] == "2026-09-25"
    assert rows[BING.id]["name"] == "舊檔的丙名稱"
    assert rows[BING.id]["approved_capacity"] == "120"  # 新欄位從 preschools.json 補上
    assert rows[ghost.id]["left_on"] == ""  # 掃描不到的舊列：日期維持空白
    assert (rows[ghost.id]["approved_capacity"], rows[ghost.id]["kind"]) == ("55", "public")  # 最新版的 preschools.json
    assert rows[undated.id]["reason"] == "renamed"  # reason 以舊檔為準
    assert rows[undated.id]["left_on"] == "2026-09-05"  # 舊檔空白的日期補上新掃描的（最後含它的是 v2，下一版 v2b）
    assert stats.old_rows == 3
    assert stats.date_differs == 1  # 丙：舊檔 09-25、新掃描 09-20
    assert stats.date_filled == 1


def test_merge_accepts_the_new_eight_column_file_and_keeps_its_values(script, monkeypatch, tmp_path):
    repo = FakeRepo(script)
    three_months(repo)
    merge = tmp_path / "old.csv"
    merge.write_text(
        "source_id,name,left_on,reason,approved_capacity,lat,lng,kind\n"
        f"{BING.id},丙,2026-09-25,closed,33,22.65,120.31,nonprofit\n",
        encoding="utf-8",
    )
    rows, _ = build(script, monkeypatch, repo, merge=merge)
    row = rows[BING.id]
    assert (row["approved_capacity"], row["lat"], row["lng"], row["kind"]) == ("33", "22.65", "120.31", "nonprofit")


def test_merge_rejects_a_file_without_the_required_columns(script, monkeypatch, tmp_path):
    repo = FakeRepo(script)
    three_months(repo)
    merge = tmp_path / "old.csv"
    merge.write_text("id,name\nx,y\n", encoding="utf-8")
    with pytest.raises(SystemExit):
        build(script, monkeypatch, repo, merge=merge)


# ---- 命令列、輸出檔、快取 ----


def test_main_writes_a_file_the_loader_accepts(script, monkeypatch, tmp_path, capsys):
    repo = FakeRepo(script)
    three_months(repo)
    repo.install(monkeypatch)
    out = tmp_path / "closures.csv"
    script.main(["--since", "2026-08-01", "--out", str(out)])
    entries = load_closure_backfill(out)
    assert entries == {BING.id: ClosureBackfill("closed", date(2026, 9, 20), "丙", 120, 22.6, 120.3, "private")}
    assert out.read_text(encoding="utf-8").splitlines()[0] == "source_id,name,left_on,reason,approved_capacity,lat,lng,kind"
    assert "回補 1 筆" in capsys.readouterr().out


def test_main_since_limits_the_history(script, monkeypatch, tmp_path):
    """--since 之前的 commit 不看：丙在 9/20 離開，但窗口從 9/25 起，兩邊都沒有它。"""
    repo = FakeRepo(script)
    three_months(repo)
    repo.install(monkeypatch)
    out = tmp_path / "closures.csv"
    script.main(["--since", "2026-09-25", "--out", str(out)])
    assert load_closure_backfill(out) == {}


def test_cache_dir_avoids_downloading_the_same_file_twice(script, monkeypatch, tmp_path):
    repo = FakeRepo(script)
    three_months(repo)
    repo.install(monkeypatch)
    cache = tmp_path / "cache"
    argv = ["--since", "2026-08-01", "--out", str(tmp_path / "a.csv"), "--cache", str(cache)]
    script.main(argv)
    first = len(repo.fetches(REG)) + len(repo.fetches(PRE))
    assert first > 0 and any(cache.iterdir())
    repo.calls.clear()
    script.main(["--since", "2026-08-01", "--out", str(tmp_path / "b.csv"), "--cache", str(cache)])
    assert repo.fetches(REG) == [] and repo.fetches(PRE) == []  # 重跑不重抓
    assert (tmp_path / "a.csv").read_text(encoding="utf-8") == (tmp_path / "b.csv").read_text(encoding="utf-8")


def test_a_gh_failure_becomes_a_clean_exit(script, monkeypatch, tmp_path):
    def broken(*args):
        raise script.GhError("gh api 失敗：boom")

    monkeypatch.setattr(script, "gh", broken)
    with pytest.raises(SystemExit, match="boom"):
        script.main(["--since", "2026-08-01", "--out", str(tmp_path / "x.csv")])


# ---- 輸出自檢、負的核定、排序 ----


def test_a_negative_approved_capacity_is_left_blank(script, monkeypatch, tmp_path):
    """來源偶爾有負數（parse_preschools 收 int4 範圍內的整數），載入器不收；留空而不是整個檔讀不了。"""
    repo = FakeRepo(script)
    weird = Kg("負數", capacity="-5")
    repo.add("n1", "2026-08-31T04:00:00Z", [JIA, weird], [JIA.feature(), weird.feature()])
    repo.add("n2", "2026-09-15T04:00:00Z", [JIA], [JIA.feature()])
    repo.install(monkeypatch)
    out = tmp_path / "closures.csv"
    script.main(["--since", "2026-08-01", "--out", str(out)])
    entry = load_closure_backfill(out)[weird.id]
    assert (entry.approved_capacity, entry.lat, entry.kind) == (None, 22.6, "private")


def test_main_deletes_an_output_the_loader_cannot_read(script, monkeypatch, tmp_path):
    """舊檔八欄裡有不合法的類型：腳本照抄會產生同步讀不了的檔，自檢要擋下並刪掉輸出。"""
    repo = FakeRepo(script)
    three_months(repo)
    repo.install(monkeypatch)
    merge = tmp_path / "old.csv"
    merge.write_text(
        "source_id,name,left_on,reason,approved_capacity,lat,lng,kind\n"
        f"{BING.id},丙,2026-09-25,closed,33,22.65,120.31,charter\n",
        encoding="utf-8",
    )
    out = tmp_path / "closures.csv"
    with pytest.raises(SystemExit, match="載入器讀不了"):
        script.main(["--since", "2026-08-01", "--merge", str(merge), "--out", str(out)])
    assert not out.exists()


def test_rows_with_the_same_date_and_name_are_ordered_by_source_id(script, monkeypatch):
    """同一天離開、名稱相同的園所：順序由 source_id 決定，不隨雜湊順序變，輸出檔每次跑都一樣。"""
    repo = FakeRepo(script)
    twins = []
    for suffix in "fcaebd":
        kg = Kg("同名")
        kg.docno, kg.id = f"文號-{suffix}", f"id-{suffix}"
        twins.append(kg)
    repo.add("s1", "2026-08-31T04:00:00Z", [JIA, *twins], [JIA.feature(), *[kg.feature() for kg in twins]])
    repo.add("s2", "2026-09-15T04:00:00Z", [JIA], [JIA.feature()])
    repo.install(monkeypatch)
    rows, _ = script.build_rows(date(2026, 8, 1), None)
    assert [row["source_id"] for row in rows] == [f"id-{suffix}" for suffix in "abcdef"]
