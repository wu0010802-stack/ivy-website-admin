"""備份與還原腳本的連線字串轉換（2026-10-13 深度掃描第 9 項）：TLS 要求不能被默默丟掉。"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

from app import libpq

SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"


def _load(name: str):
    spec = importlib.util.spec_from_file_location(f"scripts_{name}", SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_tls_requirements_map_to_libpq_environment_not_argv():
    url = (
        "postgresql+asyncpg://owner:p%40ss%2Fword@db.example.com:5433/website"
        "?ssl=verify-full&sslrootcert=/etc/ssl/ca.pem&sslcert=/etc/ssl/c.pem&sslkey=/etc/ssl/k.pem"
    )

    connection = libpq.parse(url)

    assert connection.host_args() == ["-h", "db.example.com", "-p", "5433", "-U", "owner"]
    assert connection.dbname == "website"
    assert connection.env == {
        "PGSSLMODE": "verify-full",
        "PGSSLROOTCERT": "/etc/ssl/ca.pem",
        "PGSSLCERT": "/etc/ssl/c.pem",
        "PGSSLKEY": "/etc/ssl/k.pem",
        "PGPASSWORD": "p@ss/word",
    }
    assert "p@ss/word" not in repr(connection)


@pytest.mark.parametrize(
    "query, mode",
    [("ssl=require", "require"), ("sslmode=verify-ca", "verify-ca"), ("ssl=true", "require"), ("ssl=false", "disable")],
)
def test_ssl_and_sslmode_spellings(query, mode):
    assert libpq.parse(f"postgresql+asyncpg://u@h/db?{query}").env["PGSSLMODE"] == mode


@pytest.mark.parametrize(
    "query",
    ["ssl=verify-everything", "ssl=require&sslmode=verify-full", "sslcompression=1", "ssl_min_protocol_version=TLSv1.3", "options=-c%20x=1"],
)
def test_unknown_or_conflicting_options_are_refused(query):
    with pytest.raises(libpq.UnsupportedDsn):
        libpq.parse(f"postgresql+asyncpg://u@h/db?{query}")


def test_refusal_message_does_not_echo_values():
    with pytest.raises(libpq.UnsupportedDsn) as raised:
        libpq.parse("postgresql://u:secret@h/db?sslpassword=hunter2")
    assert "hunter2" not in str(raised.value) and "secret" not in str(raised.value)


def test_plain_dsn_and_asyncpg_only_tuning_are_accepted():
    connection = libpq.parse("postgresql+asyncpg://localhost/ivy_website_test?prepared_statement_cache_size=0")
    assert connection.host_args() == ["-h", "localhost"]
    assert connection.env == {}


def test_unix_socket_directory_from_query():
    connection = libpq.parse("postgresql+asyncpg://u@/db?host=/var/run/postgresql")
    assert connection.host_args() == ["-h", "/var/run/postgresql", "-U", "u"]


def test_scripts_pass_tls_through_env_and_never_put_the_password_in_argv():
    url = "postgresql+asyncpg://owner:s3cret@db.example.com/website?sslmode=verify-full&sslrootcert=/ca.pem"
    dump_command, dump_env = _load("backup_website")._pg_dump_command(url)
    restore_command, restore_env = _load("restore_website")._psql_command(url)

    assert dump_command == ["pg_dump", "--no-owner", "--no-privileges", "-h", "db.example.com", "-U", "owner", "website"]
    assert restore_command == [
        "psql", "--quiet", "-v", "ON_ERROR_STOP=1", "--single-transaction",
        "-h", "db.example.com", "-U", "owner", "-d", "website",
    ]
    for env in (dump_env, restore_env):
        assert env["PGSSLMODE"] == "verify-full" and env["PGSSLROOTCERT"] == "/ca.pem" and env["PGPASSWORD"] == "s3cret"
    assert "s3cret" not in " ".join(dump_command + restore_command)


@pytest.mark.parametrize(
    "url",
    [
        # Settings 的「DSN 含 test」檢查會放行這幾種：test 只出現在帳號、密碼、主機或參數。
        "postgresql+asyncpg://website_test:pw@db.example.com/railway",
        "postgresql+asyncpg://owner:latest1@db.example.com/railway",
        "postgresql+asyncpg://owner@test-db.example.com/website",
        "postgresql+asyncpg://owner@db.example.com/website?application_name=test",
        # psql -d 會把含 = 的值展開成連線字串，實際連到 ivy_website_dev。
        "postgresql+asyncpg://localhost/dbname%3Divy_website_dev%20application_name%3Dtest",
        "postgresql+asyncpg://localhost/postgresql%3A%2F%2Fprod%2Frailway%3Ftest",
    ],
)
def test_restore_refuses_when_only_the_dsn_mentions_test(url):
    assert _load("restore_website")._refusal(url) is not None


def test_restore_accepts_database_named_as_test():
    assert _load("restore_website")._refusal("postgresql+asyncpg://localhost/ivy_website_test") is None
