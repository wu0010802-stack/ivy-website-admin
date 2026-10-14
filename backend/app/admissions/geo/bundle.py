"""公開資料打包檔（docs/specs/2026-10-14-admissions-village-trends-design.md §4.6）。

正式站 api 連不到部分公開資料來源（高雄市資料平台已實測擋境外 IP）；出生、遷入遷出一次要回補 50 個月份檔，
一個一個上傳不實際。所以在台灣的電腦用 scripts/fetch_geo_bundle.py 照同步的規則抓齊、打包成一個 zip，
上傳到 api volume 後 `python -m app.cli geo-sync --bundle <zip>` 一次匯入（等於每個檔各自用 --…-file 指定，不連外）。

zip 內是 manifest.json 與原始回應檔：
    {"version": 1, "created_at": "2026-10-14T03:00:00+00:00",
     "files": [{"path": "births-11509.json", "kind": "births", "period": "115-09",
                "source": "https://www.ris.gov.tw/…", "sha256": "…"}]}
manifest 缺欄位、檔名不安全、種類不認得、sha256 不符、檔案太大、所得超過一個檔：整包不匯入。"""

from __future__ import annotations

import hashlib
import json
import re
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

MANIFEST = "manifest.json"
VERSION = 1
# 收的資料種類（A 段人口、出生、遷入遷出；C 段所得；B 段新成屋，檔名「115S3_e_lvr_land_a.csv」帶季別）。
KINDS = ("population", "births", "migration", "income", "new_homes")
# 只能有一個檔的種類：所得只存最新一個年度，年度取檔名（「112_165-E.csv」，sync 的 income.year_of_filename）。
SINGLE_KINDS = ("income",)
# 單檔上限（全國的人口一頁約 10 MB）與檔數上限（出生、遷入遷出各 25 個月＋人口兩個月份＋所得＋新成屋 8 季）。
MAX_FILE_BYTES = 64 * 1024 * 1024
MAX_FILES = 200
_SAFE_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,99}")


class BundleError(ValueError):
    """打包檔不對；訊息給 CLI 印出，不含檔案內容。"""


@dataclass(frozen=True)
class BundleFile:
    path: str
    kind: str
    period: str
    source: str
    content: bytes


def write_bundle(target: Path, files: list[BundleFile], *, created_at: datetime | None = None) -> None:
    """寫成 zip（deflate）：manifest.json 放第一個。"""
    manifest = {
        "version": VERSION,
        "created_at": (created_at or datetime.now(timezone.utc)).isoformat(),
        "files": [
            {
                "path": item.path, "kind": item.kind, "period": item.period, "source": item.source,
                "sha256": hashlib.sha256(item.content).hexdigest(),
            }
            for item in files
        ],
    }
    for item in files:
        if not _SAFE_NAME.fullmatch(item.path) or item.kind not in KINDS:
            raise BundleError(f"不能打包的檔案：{item.path}（{item.kind}）")
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(MANIFEST, json.dumps(manifest, ensure_ascii=False, indent=1))
        for item in files:
            archive.writestr(item.path, item.content)


def open_bundle(source: Path, destination: Path) -> dict[str, list[Path]]:
    """驗證整包後把檔案解到 destination，回傳「種類 → 檔案路徑」（依 manifest 的順序）。任何一項不對就丟
    BundleError、什麼都不回（呼叫端不會只匯入一部分）。"""
    try:
        archive = zipfile.ZipFile(source)
    except (OSError, zipfile.BadZipFile) as exc:
        raise BundleError("不是 zip 檔") from exc
    with archive:
        try:
            manifest = json.loads(archive.read(MANIFEST).decode("utf-8"))
        except KeyError as exc:
            raise BundleError("打包檔沒有 manifest.json") from exc
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise BundleError("manifest.json 不是 JSON") from exc
        if not isinstance(manifest, dict) or manifest.get("version") != VERSION:
            raise BundleError("manifest.json 的版本不對")
        entries = manifest.get("files")
        if not isinstance(entries, list) or not entries or len(entries) > MAX_FILES:
            raise BundleError("manifest.json 沒有檔案清單，或檔案太多")
        checked: list[tuple[str, str, bytes]] = []
        seen: set[str] = set()
        for entry in entries:
            if not isinstance(entry, dict):
                raise BundleError("manifest.json 的檔案清單格式不對")
            name, kind, digest = entry.get("path"), entry.get("kind"), entry.get("sha256")
            if not isinstance(name, str) or not _SAFE_NAME.fullmatch(name) or name == MANIFEST or name in seen:
                raise BundleError(f"manifest.json 裡的檔名不能用：{name!r}")
            if kind not in KINDS:
                raise BundleError(f"不認得的資料種類：{kind!r}（{name}）")
            if kind in SINGLE_KINDS and any(other == kind for _, other, _ in checked):
                raise BundleError(f"{kind} 只能有一個檔")
            if not isinstance(digest, str) or not isinstance(entry.get("period"), str):
                raise BundleError(f"{name} 缺少 sha256 或期間")
            try:
                info = archive.getinfo(name)
            except KeyError as exc:
                raise BundleError(f"打包檔裡沒有 {name}") from exc
            if info.file_size > MAX_FILE_BYTES:
                raise BundleError(f"{name} 太大")
            content = archive.read(info)
            if hashlib.sha256(content).hexdigest() != digest:
                raise BundleError(f"{name} 的 sha256 不符")
            seen.add(name)
            checked.append((name, kind, content))
    destination.mkdir(parents=True, exist_ok=True)
    grouped: dict[str, list[Path]] = {}
    for name, kind, content in checked:
        path = destination / name
        path.write_bytes(content)
        grouped.setdefault(kind, []).append(path)
    return grouped
