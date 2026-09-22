"""官網 CI/CD：固定 commit 快照、Railway 狀態核對及唯讀公開 smoke。"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import subprocess
import tarfile
import time
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


PROJECT = "d606df61-445a-4e65-9c5f-7e94a0766572"
ENVIRONMENT = "cf5631c7-05b9-4f16-9358-c81d2650eb55"
SERVICES = {
    "api": "9124b9c0-4ddf-4445-bd2f-798b277f44ec",
    "web": "e0851ec5-3bc0-4b5c-9471-9d9131616c26",
}
ORIGIN = "https://web-production-04caa.up.railway.app"
SOURCE_PATHS = ("web", "admin", "backend", "content", "contracts", "deploy", ".dockerignore")
EXCLUDED_PARTS = {"node_modules", ".nuxt", ".output", "dist", ".venv", "__pycache__", ".pytest_cache", "var"}
RELEASE_PATH = "web/public/release.json"


def command(args: list[str], *, cwd: Path | None = None, timeout: int = 120) -> str:
    # 不使用 shell，不列印環境變數或任何 token。
    return subprocess.run(args, cwd=cwd, check=True, text=True, stdout=subprocess.PIPE, timeout=timeout).stdout


def snapshot_hash(root: Path) -> str:
    entries = []
    for path in sorted(root.rglob("*")):
        relative = path.relative_to(root).as_posix()
        if path.is_file() and relative != RELEASE_PATH:
            entries.append(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  ./{relative}\n")
    return hashlib.sha256("".join(entries).encode()).hexdigest()


def prepare(repo: Path, ref: str, destination: Path) -> dict:
    commit = command(["git", "rev-parse", "--verify", f"{ref}^{{commit}}"], cwd=repo).strip()
    archive = subprocess.run(
        ["git", "archive", commit, "--", *SOURCE_PATHS], cwd=repo,
        check=True, stdout=subprocess.PIPE, timeout=120,
    ).stdout
    destination.mkdir(parents=True, exist_ok=False)
    with tarfile.open(fileobj=io.BytesIO(archive)) as bundle:
        for member in bundle:
            path = PurePosixPath(member.name)
            if member.isdir():
                continue
            if path.is_absolute() or ".." in path.parts or not member.isfile():
                raise RuntimeError(f"快照含不支援的路徑或連結：{path}")
            if (str(path) == RELEASE_PATH or any(p in EXCLUDED_PARTS or p.startswith(".env") for p in path.parts)
                    or path.suffix == ".log"):
                continue
            output = destination.joinpath(*path.parts)
            output.parent.mkdir(parents=True, exist_ok=True)
            with bundle.extractfile(member) as source:
                output.write_bytes(source.read())
            output.chmod(member.mode & 0o777)
    release = {
        "snapshot": snapshot_hash(destination),
        "base_commit": commit,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "source": "GitHub Actions: committed production snapshot",
        "service": "web+api",
    }
    release_path = destination / RELEASE_PATH
    release_path.parent.mkdir(parents=True, exist_ok=True)
    release_path.write_text(json.dumps(release, indent=2) + "\n")
    print(json.dumps(release), flush=True)
    return release


def target(service: str) -> list[str]:
    return ["--project", PROJECT, "--environment", ENVIRONMENT, "--service", SERVICES[service]]


def railway_json(args: list[str], *, timeout: int = 120):
    return json.loads(command(["railway", *args, "--json"], timeout=timeout))


def wait_for_deployment(service: str, deployment_id: str, timeout: int = 900) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        deployments = railway_json(["deployment", "list", *target(service), "--limit", "100"])
        current = next((item for item in deployments if item["id"] == deployment_id), None)
        status = current["status"] if current else "NOT_VISIBLE"
        print(f"{service} {deployment_id}: {status}", flush=True)
        if status == "SUCCESS":
            return
        if status in {"FAILED", "CRASHED", "REMOVED", "REMOVING", "SKIPPED"}:
            raise RuntimeError(f"{service} deployment {deployment_id}: {status}")
        time.sleep(10)
    raise RuntimeError(f"等待 {service} deployment {deployment_id} 逾時")


def deploy_service(snapshot: Path, service: str) -> None:
    result = railway_json([
        "up", str(snapshot.resolve()), "--path-as-root", *target(service), "--detach",
        "--message", f"GitHub Actions {os.environ.get('GITHUB_SHA', '')}",
    ], timeout=600)
    deployment_id = result.get("deploymentId")
    if not deployment_id:
        raise RuntimeError("Railway 未回傳 deploymentId，不能確認部署結果")
    wait_for_deployment(service, deployment_id)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a") as stream:
            stream.write(f"- {service}: `{deployment_id}` SUCCESS\n")


def read_public(path: str) -> tuple[bytes, str]:
    request = Request(f"{ORIGIN}{path}", headers={"Cache-Control": "no-cache"})
    for attempt in range(3):
        try:
            with urlopen(request, timeout=30) as response:
                return response.read(), response.headers.get("Content-Type", "")
        except (URLError, TimeoutError) as error:
            if attempt == 2 or (isinstance(error, HTTPError) and error.code < 500 and error.code != 429):
                raise
            print(f"Retry public GET {path}: {error}", flush=True)
            time.sleep(attempt + 1)
    raise RuntimeError(f"公開 GET 失敗：{path}")


def get_json(path: str) -> dict:
    body, _ = read_public(path)
    return json.loads(body)


def smoke(release: dict) -> None:
    actual = get_json(f"/release.json?commit={release['base_commit']}")
    if any(actual.get(key) != release[key] for key in ("snapshot", "base_commit")):
        raise RuntimeError("線上 release 與本次部署不符")
    health = get_json("/api/website/v1/health")
    if health.get("status") != "ok" or health.get("environment") != "production" or health.get("fixture_enabled") is not False:
        raise RuntimeError("API production/live health 檢查失敗")
    # 公開 CMS 讀取會走 DB，補足不查 DB 的 health handler。
    content = get_json("/api/public-site")
    if not content.get("release_id") or not content.get("content"):
        raise RuntimeError("公開 CMS 尚無已發布內容")
    for path in ("/", "/admin/login", "/campuses/yihua", "/campuses/minghua", "/campuses/chongde", "/campuses/international", "/campuses/renwu"):
        print(f"Check public page: {path}", flush=True)
        body, content_type = read_public(path)
        if not body or "text/html" not in content_type:
            raise RuntimeError(f"公開頁面檢查失敗：{path}")
    print("Public smoke passed: release, live API, CMS, homepage, five campuses, admin entry", flush=True)


def deploy(snapshot: Path) -> None:
    # API 啟動時會在 healthcheck 通過前唯讀核對實際 DB schema。
    deploy_service(snapshot, "api")
    deploy_service(snapshot, "web")
    smoke(json.loads((snapshot / RELEASE_PATH).read_text()))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="action", required=True)
    prepare_parser = subparsers.add_parser("prepare")
    prepare_parser.add_argument("destination", type=Path)
    prepare_parser.add_argument("--ref", default="HEAD")
    deploy_parser = subparsers.add_parser("deploy")
    deploy_parser.add_argument("snapshot", type=Path)
    args = parser.parse_args()
    if args.action == "prepare":
        prepare(Path(__file__).resolve().parents[1], args.ref, args.destination)
    else:
        if os.environ.get("GITHUB_REF") != "refs/heads/main" or not os.environ.get("RAILWAY_TOKEN"):
            parser.error("deploy 只允許 main branch，且必須設定 RAILWAY_TOKEN")
        release = json.loads((args.snapshot / RELEASE_PATH).read_text())
        if release["base_commit"] != os.environ.get("GITHUB_SHA") or release["snapshot"] != snapshot_hash(args.snapshot):
            parser.error("快照 commit 或 hash 與這次 GitHub Actions 不符")
        deploy(args.snapshot)


if __name__ == "__main__":
    main()
