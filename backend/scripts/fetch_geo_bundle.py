"""在台灣的電腦抓齊公開資料、打包成一個 zip（2026-10-14 里的變化規格 §4.6），給正式站連不到來源時用。

照同步的規則抓：各里出生（ODRP061，往回 72 個月）、遷入遷出（ODRP011，往回 25 個月）各抓最新月份往回的視窗（來源查無資料的月份跳過），
各里人口（ODRP014）最新月份與一年前，全部帶 COUNTY=高雄市；各里所得（財政資訊中心）最新年度；新成屋（實價登錄
高雄市買賣季檔）最新季往回 8 季；預售建案（實價登錄預售屋建案備查單檔）一個；地號座標（--presale-parcels 指定本機腳本
fetch_presale_parcels.py 的輸出，沒指定就不附）。ris.gov.tw 每個請求之間隔 3 秒（連續快速請求會回擋頁），出生抓 72 個月，要幾分鐘；實際大小打包時看 zip。不需要資料庫、不需要任何環境變數，不送出任何家長資料。

用法（在 backend/）：
  uv run python scripts/fetch_geo_bundle.py [--out geo-bundle-11509.zip] [--presale-parcels presale_parcels.csv]

接著上傳到 api volume，`python -m app.cli geo-sync --bundle /data/geo-bundle-11509.zip`，用完刪掉（步驟見
deploy/README.md「公開地理資料同步」）。"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.admissions.geo import income as income_io  # noqa: E402
from app.admissions.geo import new_homes as new_homes_io  # noqa: E402
from app.admissions.geo import population as population_io  # noqa: E402
from app.admissions.geo import presale as presale_io  # noqa: E402
from app.admissions.geo import presale_parcels as parcels_io  # noqa: E402
from app.admissions.geo import sync  # noqa: E402
from app.admissions.geo import village_series as series_io  # noqa: E402
from app.admissions.geo.bundle import BundleFile, write_bundle  # noqa: E402


def _check(text: str, what: str) -> dict | None:
    """回應要是內政部的 JSON；查無資料回 None，其他（擋頁、錯誤代碼）丟錯。"""
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"{what}：回應不是 JSON（可能被擋），稍後再跑") from exc
    code = data.get("responseCode") if isinstance(data, dict) else None
    if code == population_io.RESPONSE_NO_DATA:
        return None
    if code != population_io.RESPONSE_OK:
        raise SystemExit(f"{what}：回應不是「處理完成」")
    return data


async def _get(client, url: str) -> str:
    """同步用的同一條路：請求間隔 3 秒、大小上限（人口一頁的上限最大，三種資料共用）。"""
    return await sync._ris_text(client, url, max_bytes=sync.POPULATION_PAGE_MAX_BYTES)


async def _month_pages(client, url_of, yyymm: str, what: str) -> list[bytes] | None:
    """一個月份的全部頁（回應原文，UTF-8）；查無資料回 None。"""
    text = await _get(client, url_of(yyymm, 1))
    first = _check(text, f"{what} {yyymm}")
    if first is None:
        return None
    pages = [text.encode("utf-8")]
    for page in range(2, int(first.get("totalPage", "1")) + 1):
        text = await _get(client, url_of(yyymm, page))
        if _check(text, f"{what} {yyymm} 第 {page} 頁") is None:
            raise SystemExit(f"{what} {yyymm} 下載到一半變成查無資料")
        pages.append(text.encode("utf-8"))
    return pages


async def _latest(client, url_of, what: str) -> str:
    for yyymm in sync.recent_months():
        if _check(await _get(client, url_of(yyymm, 1)), f"{what} {yyymm}") is not None:
            return yyymm
    raise SystemExit(f"找不到最近幾個月的{what}")


async def build(out: Path | None, presale_parcels: Path | None = None) -> Path:
    files: list[BundleFile] = []
    async with sync.new_client() as client:
        for kind, series in (("births", series_io.BIRTHS), ("migration", series_io.MIGRATION)):
            def url_of(yyymm: str, page: int, series=series) -> str:
                return series_io.page_url(series, yyymm, page)

            latest = series_io.label_of(await _latest(client, url_of, series.name))
            for label in reversed(series_io.window(latest, series.keep_months)):
                yyymm = series_io.yyymm_of(label)
                pages = await _month_pages(client, url_of, yyymm, series.name)
                if pages is None:
                    print(f"{series.name} {label}：來源查無資料，跳過")
                    continue
                for index, content in enumerate(pages, start=1):
                    files.append(BundleFile(f"{kind}-{yyymm}-{index}.json", kind, label, url_of(yyymm, index), content))
                print(f"{series.name} {label}：{len(pages)} 頁")
        population_latest = await _latest(client, population_io.page_url, "各里人口")
        for yyymm in (population_latest, series_io.yyymm_of(series_io.shift(series_io.label_of(population_latest), -12))):
            pages = await _month_pages(client, population_io.page_url, yyymm, "各里人口")
            if pages is None:
                print(f"各里人口 {yyymm}：來源查無資料，跳過")
                continue
            for index, content in enumerate(pages, start=1):
                files.append(
                    BundleFile(
                        f"population-{yyymm}-{index}.json", "population", series_io.label_of(yyymm),
                        population_io.page_url(yyymm, index), content,
                    )
                )
            print(f"各里人口 {series_io.label_of(yyymm)}：{len(pages)} 頁")
        # 各里所得：同步的同一條路（data.gov.tw 找最新年度，讀不到就直接試財政資訊中心；連線被 reset 會重試）。
        found = await sync._discover_income(client, None, force=False)
        if found is None:  # pragma: no cover - active 是 None 時找不到會丟錯
            raise SystemExit("找不到各里所得")
        year, body = found
        income_io.parse_csv(income_io.decode(body), year)  # 先驗證，壞檔不打包
        files.append(BundleFile(f"{year}_165-E.csv", "income", str(year), income_io.csv_url(year), body))
        print(f"各里所得：{year} 年度")
        # 新成屋：同步的同一條路（從今天所在的季往回找最新季，再往回 8 季；錯誤頁＝那一季沒有檔）。
        latest, fetched = await sync.discover_new_home_seasons(client, None)
        for season in new_homes_io.window(latest):
            text_ = fetched.get(season) or await sync._new_homes_text(client, season)
            if text_ is None:
                print(f"新成屋 {season}：來源沒有檔，跳過")
                continue
            batch = new_homes_io.parse_csv(text_, season)  # 先驗證，壞檔不打包
            files.append(
                BundleFile(
                    f"{season}_e_lvr_land_a.csv", "new_homes", season, new_homes_io.season_url(season),
                    text_.encode("utf-8"),
                )
            )
            print(f"新成屋 {season}：{len(batch.rows)} 筆")
        # 預售建案：同步的同一條路（單檔，約 180 KB；壞檔不打包）。檔名帶月份，匯入時版本月份取檔名。
        body = await sync._fetch_retrying(client, presale_io.SOURCE_URL, max_bytes=presale_io.MAX_BYTES)
        text_ = presale_io.decode(body)
        if text_ is None:
            raise SystemExit("預售建案：下載到的不是預售建案檔（可能是錯誤頁）")
        cases = presale_io.parse_csv(text_)
        label = sync.current_label()
        files.append(BundleFile(f"presale-buildcases-{label}.csv", "presale_buildcases", label, presale_io.SOURCE_URL, body))
        print(f"預售建案：{len(cases.rows)} 案（壞行 {cases.failed}）")
    if presale_parcels is not None:
        # 地號座標：本機腳本查好的檔，先驗證再打包。
        raw = presale_parcels.read_bytes()
        located = parcels_io.parse_csv(raw.decode("utf-8-sig"))
        files.append(BundleFile("presale-parcels.csv", "presale_parcels", "parcels", "local:fetch_presale_parcels.py", raw))
        print(f"地號座標：{len(located)} 列（有座標 {sum(row.lon is not None for row in located)} 列）")
    target = out or Path(f"geo-bundle-{population_latest}.zip")
    write_bundle(target, files)
    print(f"已寫入 {target}（{len(files)} 個檔，{target.stat().st_size / 1024 / 1024:.1f} MB）")
    return target


def main() -> None:
    parser = argparse.ArgumentParser(description="抓齊各里出生、遷入遷出、人口、所得、新成屋，打包給 geo-sync --bundle")
    parser.add_argument("--out", type=Path, default=None, help="輸出的 zip（預設 geo-bundle-<人口月份>.zip）")
    parser.add_argument(
        "--presale-parcels", type=Path, default=None, help="fetch_presale_parcels.py 輸出的地號座標 CSV（沒給就不附）"
    )
    args = parser.parse_args()
    asyncio.run(build(args.out, args.presale_parcels))


if __name__ == "__main__":
    main()
