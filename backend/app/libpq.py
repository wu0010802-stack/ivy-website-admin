"""SQLAlchemy／asyncpg 的連線字串 → libpq 命令列工具（pg_dump、psql）的連線設定。

備份與還原腳本原本只取 host、port、user、dbname，連線字串裡的 TLS 要求（ssl／sslmode、CA、客戶端
憑證）全部丟掉（2026-10-13 深度掃描第 9 項）：操作者明明要求 verify-full，pg_dump 卻落回 libpq 預設的
prefer，中間人可以降級或偽造資料庫。這裡把安全相關的參數對應成 libpq 的環境變數，**認得的才轉、
不認得的拒絕**（fail closed），密碼與憑證路徑只走環境變數，不進命令列，也不印出來。"""

from __future__ import annotations

from dataclasses import dataclass, field
from urllib.parse import parse_qsl, unquote, urlsplit

# libpq 的 sslmode 值。asyncpg 的 ssl= 用同一組字（另外接受 true／false）。
SSLMODES = frozenset({"disable", "allow", "prefer", "require", "verify-ca", "verify-full"})
_SSL_ALIASES = {"true": "require", "1": "require", "false": "disable", "0": "disable"}
# 路徑類 TLS 設定：連線字串的參數名 → libpq 環境變數。
_SSL_FILE_ENV = {
    "sslrootcert": "PGSSLROOTCERT",
    "sslcert": "PGSSLCERT",
    "sslkey": "PGSSLKEY",
    "sslcrl": "PGSSLCRL",
}
# 與安全無關、可以安全轉送的參數。
_PLAIN_ENV = {"application_name": "PGAPPNAME", "connect_timeout": "PGCONNECT_TIMEOUT"}
# asyncpg 自己的效能調校參數，libpq 沒有對應：直接略過。
_ASYNCPG_ONLY = frozenset(
    {
        "prepared_statement_cache_size",
        "statement_cache_size",
        "max_cached_statement_lifetime",
        "max_cacheable_statement_size",
        "command_timeout",
    }
)


class UnsupportedDsn(ValueError):
    """連線字串帶了這裡不會轉給 libpq 的參數：拒絕執行，不默默丟掉（可能是安全設定）。"""


@dataclass(frozen=True)
class LibpqConnection:
    host: str | None
    port: int | None
    user: str | None
    dbname: str
    # 密碼與 TLS 設定。蓋過行程環境裡繼承來的同名設定：連線字串要求的保護不能被較弱的環境變數降級。
    env: dict[str, str] = field(default_factory=dict, repr=False)

    def host_args(self) -> list[str]:
        args: list[str] = []
        if self.host:
            args += ["-h", self.host]
        if self.port:
            args += ["-p", str(self.port)]
        if self.user:
            args += ["-U", self.user]
        return args


def parse(database_url: str) -> LibpqConnection:
    parts = urlsplit(database_url.replace("+asyncpg", "", 1))
    params: dict[str, str] = {}
    for key, value in parse_qsl(parts.query, keep_blank_values=True):
        if key in params and params[key] != value:
            raise UnsupportedDsn(f"連線字串的參數 {key} 重複且值不同")
        params[key] = value

    env: dict[str, str] = {}
    host = parts.hostname
    if "host" in params:
        # 連線字串用 ?host=/path 指定 unix socket 目錄。
        host = host or params.pop("host")
        params.pop("host", None)

    modes = {
        _sslmode(name, params.pop(name)) for name in ("ssl", "sslmode") if name in params
    }
    if len(modes) > 1:
        raise UnsupportedDsn("連線字串同時有 ssl 與 sslmode，而且值不一致")
    if modes:
        env["PGSSLMODE"] = modes.pop()
    for name, variable in _SSL_FILE_ENV.items():
        if name in params:
            env[variable] = params.pop(name)
    for name, variable in _PLAIN_ENV.items():
        if name in params:
            env[variable] = params.pop(name)
    for name in _ASYNCPG_ONLY:
        params.pop(name, None)
    if params:
        # 只列參數名，不印值（可能含路徑或密碼）。
        raise UnsupportedDsn("連線字串有不支援的參數：" + "、".join(sorted(params)))

    if parts.password:
        env["PGPASSWORD"] = unquote(parts.password)
    return LibpqConnection(
        host=host,
        port=parts.port,
        user=unquote(parts.username) if parts.username else None,
        dbname=unquote(parts.path.lstrip("/")),
        env=env,
    )


def _sslmode(name: str, value: str) -> str:
    mode = _SSL_ALIASES.get(value.lower(), value.lower())
    if mode not in SSLMODES:
        raise UnsupportedDsn(f"連線字串的 {name} 不是 libpq 認得的 sslmode")
    return mode
