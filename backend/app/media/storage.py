from __future__ import annotations

import secrets
from pathlib import Path


class LocalMediaStorage:
    """本機檔案系統 storage adapter。所有檔名都是伺服器產生的隨機 key，
    絕不使用使用者上傳的原始檔名或任何使用者輸入拼路徑，避免路徑穿越。"""

    def __init__(self, root: str) -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def generate_key(self, extension: str) -> str:
        return f"{secrets.token_hex(16)}{extension}"

    def path_for(self, storage_key: str) -> Path:
        # storage_key 只能是本地 generate_key 產生的值（無 '/'、無 '..'），
        # 這裡再加一層防呆，拒絕任何看起來像路徑穿越的輸入。
        if "/" in storage_key or "\\" in storage_key or ".." in storage_key:
            raise ValueError("非法的 storage key")
        return self.root / storage_key

    def write_bytes(self, storage_key: str, data: bytes) -> None:
        self.path_for(storage_key).write_bytes(data)

    def read_bytes(self, storage_key: str) -> bytes:
        return self.path_for(storage_key).read_bytes()

    def delete(self, storage_key: str) -> None:
        path = self.path_for(storage_key)
        if path.exists():
            path.unlink()
