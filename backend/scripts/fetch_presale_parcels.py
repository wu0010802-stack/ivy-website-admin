"""在本機查預售建案的地號座標（2026-10-20 預售建案規格 P6），輸出 presale_parcels.csv。

讀最新的預售建案檔（--cases 指定本機檔，沒指定就從內政部下載），把每個建案「坐落基地」的第一筆地號解成（區, 段名, 地號），
用國土測繪中心的段清單對到所碼與段碼，再查地號座標。**只查輸出檔裡還沒有的地號**（重跑會接著做；查無的寫空座標，下次不重查，
除非加 --retry-missing）。每次請求之間至少隔 1 秒、User-Agent 是 `ivy-website/1.0 (+presale-parcels)`、不帶任何帳號。
第一次約 660 次查詢（至少 11 分鐘），每查 25 個就存檔一次，中斷也不會白做。

國土測繪中心的兩個服務沒有公開文件與授權（使用者 2026-10-20 選擇照用），所以只在本機、低頻跑；正式站不連它們。
不需要資料庫、不需要任何環境變數。

用法（在 backend/，台灣網路）：
  uv run python scripts/fetch_presale_parcels.py [--cases e_lvr_buildcase.csv] [--out presale_parcels.csv] \\
      [--delay 1.0] [--retry-missing] [--limit 50]

接著打包上傳（步驟見 deploy/README.md「公開地理資料同步」）：
  uv run python scripts/fetch_geo_bundle.py --presale-parcels presale_parcels.csv
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import time
from datetime import date
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.admissions.geo import nlsc  # noqa: E402
from app.admissions.geo import presale as presale_io  # noqa: E402
from app.admissions.geo import presale_parcels as parcels_io  # noqa: E402
from app.admissions.geo import sync  # noqa: E402

SAVE_EVERY = 25


def load_cases(path: Path | None) -> presale_io.PresaleBatch:
    """建案檔：指定本機檔，或從內政部下載（單檔約 180 KB）。"""
    if path is not None:
        body = path.read_bytes()
    else:
        async def download() -> bytes:
            async with sync.new_client() as client:
                return await sync._fetch_retrying(client, presale_io.SOURCE_URL, max_bytes=presale_io.MAX_BYTES)

        body = asyncio.run(download())
    text = presale_io.decode(body)
    if text is None:
        raise SystemExit("不是預售建案檔（可能是錯誤頁）")
    return presale_io.parse_csv(text)


def write_atomic(path: Path, rows: dict) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(parcels_io.render_csv(list(rows.values())), encoding="utf-8")
    temporary.replace(path)


def main(argv: list[str] | None = None, *, transport: httpx.BaseTransport | None = None, sleep=None, today: date | None = None) -> int:
    parser = argparse.ArgumentParser(description="查預售建案的地號座標（國土測繪中心），輸出 presale_parcels.csv")
    parser.add_argument("--cases", type=Path, default=None, help="本機的預售建案檔（沒指定就下載）")
    parser.add_argument("--out", type=Path, default=Path("presale_parcels.csv"), help="輸出（也是已查過的紀錄）")
    parser.add_argument("--delay", type=float, default=nlsc.MIN_DELAY_SECONDS, help="每次請求之間的秒數（最少 1 秒）")
    parser.add_argument("--retry-missing", action="store_true", help="重查之前查無的地號")
    parser.add_argument("--limit", type=int, default=None, help="這次最多查幾個（試跑用）")
    args = parser.parse_args(argv)

    batch = load_cases(args.cases)
    wanted = [(row.district, row.parcel_section, row.parcel_no) for row in batch.rows if row.parcel_section and row.parcel_no]
    existing = (
        {row.key: row for row in parcels_io.parse_csv(args.out.read_text(encoding="utf-8-sig"))} if args.out.exists() else {}
    )
    print(f"建案 {len(batch.rows)} 案，有地號 {len(wanted)} 個；輸出檔已有 {len(existing)} 筆")

    def save(result: nlsc.CollectResult) -> None:
        if result.queried % SAVE_EVERY == 0:
            write_atomic(args.out, result.rows)
            print(f"  已查 {result.queried}（有座標 {result.found}、查無 {result.missing}、失敗 {result.errors}）")

    with nlsc.new_client(transport=transport) as client:
        result = nlsc.collect(
            client, wanted, existing, today=today or date.today(), delay=args.delay, retry_missing=args.retry_missing,
            limit=args.limit, sleep=sleep or time.sleep, on_progress=save,
        )
    write_atomic(args.out, result.rows)
    print(
        f"完成：這次查 {result.queried} 個（有座標 {result.found}、查無 {result.missing}、失敗 {result.errors}），"
        f"對不到段清單 {len(result.unresolved)} 個；輸出 {args.out}（共 {len(result.rows)} 筆）"
    )
    if result.aborted:
        print("連續失敗太多次，已停手；稍後再跑（已查到的都存了）", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
