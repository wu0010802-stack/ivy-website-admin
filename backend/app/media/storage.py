from __future__ import annotations

import asyncio
import re
import secrets
import shutil
from datetime import timezone
from email.utils import format_datetime
from pathlib import Path
from typing import Protocol

from starlette.background import BackgroundTask
from starlette.requests import Request
from starlette.responses import FileResponse, Response, StreamingResponse


class MediaFileMissing(Exception):
    """DB 有記錄但儲存空間裡沒有這個檔案。"""


def validate_key(storage_key: str) -> str:
    # storage_key 只能是 generate_key 產生的值（無 '/'、無 '..'），再加一層
    # 防呆，拒絕任何看起來像路徑穿越的輸入。
    if not storage_key or "/" in storage_key or "\\" in storage_key or ".." in storage_key:
        raise ValueError("非法的 storage key")
    return storage_key


def generate_key(extension: str) -> str:
    """所有檔名都是伺服器產生的隨機 key，絕不使用使用者上傳的原始檔名。"""
    return f"{secrets.token_hex(16)}{extension}"


class MediaStorage(Protocol):
    """素材原檔與衍生檔的儲存。寫入、刪除是阻塞 I/O，呼叫端一律丟到 thread。"""

    def generate_key(self, extension: str) -> str: ...
    def write_bytes(self, storage_key: str, data: bytes) -> None: ...
    def write_file(self, storage_key: str, path: Path) -> None: ...
    def read_bytes(self, storage_key: str) -> bytes: ...
    def exists(self, storage_key: str) -> bool: ...
    def delete(self, storage_key: str) -> None: ...
    async def file_response(
        self, storage_key: str, *, request: Request, media_type: str, headers: dict[str, str]
    ) -> Response: ...


class LocalMediaStorage:
    """本機檔案系統（Railway volume）。api 只能單一實例，因為檔案只在那顆 volume 上。"""

    def __init__(self, root: str) -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def generate_key(self, extension: str) -> str:
        return generate_key(extension)

    def path_for(self, storage_key: str) -> Path:
        return self.root / validate_key(storage_key)

    def write_bytes(self, storage_key: str, data: bytes) -> None:
        self.path_for(storage_key).write_bytes(data)

    def write_file(self, storage_key: str, path: Path) -> None:
        """從暫存檔複製進來（逐塊複製，不整份讀進記憶體）。"""
        shutil.copyfile(path, self.path_for(storage_key))

    def exists(self, storage_key: str) -> bool:
        return self.path_for(storage_key).is_file()

    def read_bytes(self, storage_key: str) -> bytes:
        return self.path_for(storage_key).read_bytes()

    def delete(self, storage_key: str) -> None:
        path = self.path_for(storage_key)
        if path.exists():
            path.unlink()

    async def file_response(
        self, storage_key: str, *, request: Request, media_type: str, headers: dict[str, str]
    ) -> Response:
        path = self.path_for(storage_key)
        if not await asyncio.to_thread(path.is_file):
            raise MediaFileMissing(storage_key)
        # FileResponse 串流送檔並自己處理 Range（影片拖曳、iOS 播放都需要 206）。
        return FileResponse(path, media_type=media_type, headers=headers)


# 只轉送單一區段的 Range；多段或格式不對就當作沒有 Range，回整個檔案（HTTP 允許）。
_SINGLE_RANGE = re.compile(r"^bytes=(\d+-\d*|-\d+)$")
_CHUNK = 64 * 1024


class S3MediaStorage:
    """S3 相容物件儲存（Cloudflare R2、AWS S3、MinIO…）。檔案不再綁在某一台
    機器的 volume 上，api 可以多實例，耐久性交給儲存服務。

    讀檔經 API 串流（不轉址到 presigned URL）：網址、權限檢查、快取標頭都跟
    本機儲存一模一樣，web 端與 CSP 不用動；Range 原樣轉給儲存服務。"""

    def __init__(
        self,
        *,
        bucket: str,
        access_key_id: str,
        secret_access_key: str,
        endpoint_url: str | None = None,
        region: str | None = None,
        prefix: str = "",
    ) -> None:
        import boto3
        from botocore.config import Config

        self.bucket = bucket
        self.prefix = prefix
        self._client = boto3.client(
            "s3",
            endpoint_url=endpoint_url,
            region_name=region,
            aws_access_key_id=access_key_id,
            aws_secret_access_key=secret_access_key,
            config=Config(
                signature_version="s3v4",
                retries={"max_attempts": 3, "mode": "standard"},
                connect_timeout=10,
                read_timeout=60,
            ),
        )

    def _object_key(self, storage_key: str) -> str:
        return f"{self.prefix}{validate_key(storage_key)}"

    @staticmethod
    def _error_code(exc: Exception) -> str | None:
        from botocore.exceptions import ClientError

        if not isinstance(exc, ClientError):
            return None
        return exc.response.get("Error", {}).get("Code")

    @classmethod
    def _is_missing(cls, exc: Exception) -> bool:
        return cls._error_code(exc) in {"404", "NoSuchKey", "NotFound"}

    def generate_key(self, extension: str) -> str:
        return generate_key(extension)

    def write_bytes(self, storage_key: str, data: bytes) -> None:
        self._client.put_object(Bucket=self.bucket, Key=self._object_key(storage_key), Body=data)

    def read_bytes(self, storage_key: str) -> bytes:
        try:
            obj = self._client.get_object(Bucket=self.bucket, Key=self._object_key(storage_key))
        except Exception as exc:
            if self._is_missing(exc):
                raise MediaFileMissing(storage_key) from exc
            raise
        with obj["Body"] as body:
            return body.read()

    def size(self, storage_key: str) -> int | None:
        """物件大小；不存在回 None。"""
        try:
            head = self._client.head_object(Bucket=self.bucket, Key=self._object_key(storage_key))
        except Exception as exc:
            if self._is_missing(exc):
                return None
            raise
        return int(head["ContentLength"])

    def exists(self, storage_key: str) -> bool:
        return self.size(storage_key) is not None

    def upload_file(self, storage_key: str, path: Path) -> None:
        """大檔用分段上傳串流送出，不整個讀進記憶體（上傳與搬遷 volume 都用）。"""
        self._client.upload_file(str(path), self.bucket, self._object_key(storage_key))

    def write_file(self, storage_key: str, path: Path) -> None:
        self.upload_file(storage_key, path)

    def delete(self, storage_key: str) -> None:
        # S3 刪除不存在的物件也回成功，與本機版的語意一致。
        self._client.delete_object(Bucket=self.bucket, Key=self._object_key(storage_key))

    def _get(self, storage_key: str, byte_range: str | None) -> dict:
        kwargs = {"Bucket": self.bucket, "Key": self._object_key(storage_key)}
        if byte_range:
            kwargs["Range"] = byte_range
        return self._client.get_object(**kwargs)

    async def file_response(
        self, storage_key: str, *, request: Request, media_type: str, headers: dict[str, str]
    ) -> Response:
        requested = (request.headers.get("range") or "").strip()
        byte_range = requested if _SINGLE_RANGE.match(requested) else None
        try:
            obj = await asyncio.to_thread(self._get, storage_key, byte_range)
        except Exception as exc:
            if self._is_missing(exc):
                raise MediaFileMissing(storage_key) from exc
            if self._error_code(exc) == "InvalidRange":
                size = await asyncio.to_thread(self.size, storage_key)
                return Response(
                    status_code=416,
                    headers={**headers, "Content-Range": f"bytes */{size if size is not None else '*'}"},
                )
            raise

        body = obj["Body"]
        response_headers = {
            **headers,
            "Accept-Ranges": "bytes",
            "Content-Length": str(obj["ContentLength"]),
        }
        status_code = 200
        if byte_range and obj.get("ContentRange"):
            status_code = 206
            response_headers["Content-Range"] = obj["ContentRange"]
        if obj.get("ETag"):
            response_headers["ETag"] = obj["ETag"]
        if obj.get("LastModified"):
            # botocore 給的是 dateutil 的 tzutc，format_datetime(usegmt=True) 只收 timezone.utc。
            response_headers["Last-Modified"] = format_datetime(
                obj["LastModified"].astimezone(timezone.utc), usegmt=True
            )
        # 同步 iterator 由 Starlette 丟到 threadpool 逐塊讀，不把整個檔案讀進記憶體。
        return StreamingResponse(
            body.iter_chunks(_CHUNK),
            status_code=status_code,
            media_type=media_type,
            headers=response_headers,
            background=BackgroundTask(body.close),
        )
