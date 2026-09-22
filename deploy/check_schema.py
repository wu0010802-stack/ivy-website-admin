"""Read the database revision before API startup; never run migrations."""
import asyncio


def validate_revision(actual: list[str], expected: list[str]) -> None:
    if len(expected) != 1 or sorted(actual) != sorted(expected):
        raise RuntimeError(
            f"Database revision {actual!r} does not match application {expected!r}. "
            "An explicitly approved migration is required before this API can start."
        )


async def check() -> None:
    from alembic.config import Config
    from alembic.script import ScriptDirectory
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import create_async_engine
    from sqlalchemy.pool import NullPool

    from app.config import get_settings

    expected = ScriptDirectory.from_config(Config("alembic.ini")).get_heads()
    engine = create_async_engine(get_settings().active_database_url(), poolclass=NullPool)
    try:
        async with engine.connect() as connection:
            # PostgreSQL enforces that this check cannot change application data.
            await connection.execute(text("SET TRANSACTION READ ONLY"))
            actual = list((await connection.execute(text("SELECT version_num FROM alembic_version"))).scalars())
        validate_revision(actual, expected)
        print(f"Database schema ready: {actual[0]}", flush=True)
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(asyncio.wait_for(check(), timeout=30))
