from pathlib import Path

import psycopg


async def run_migrations(database_url: str, migrations_dir: Path) -> None:
    async with await psycopg.AsyncConnection.connect(database_url) as conn:
        await conn.execute(
            """
            create table if not exists schema_migrations (
              version text primary key,
              applied_at timestamptz not null default now()
            )
            """
        )
        await _baseline_existing_schema(conn, migrations_dir)
        for path in sorted(migrations_dir.glob("*.sql")):
            version = path.name
            applied = await conn.execute(
                "select 1 from schema_migrations where version = %s",
                (version,),
            )
            if await applied.fetchone() is not None:
                continue
            await conn.execute(path.read_text(encoding="utf-8"))
            await conn.execute(
                "insert into schema_migrations (version) values (%s)",
                (version,),
            )


async def _baseline_existing_schema(
    conn: psycopg.AsyncConnection[tuple[object, ...]],
    migrations_dir: Path,
) -> None:
    existing = await (
        await conn.execute("select to_regclass('public.users'), to_regclass('public.videos')")
    ).fetchone()
    has_initial_schema = (
        existing is not None
        and existing[0] is not None
        and existing[1] is not None
    )
    initial_migration = migrations_dir / "001_initial_schema.sql"
    if not has_initial_schema or not initial_migration.exists():
        return

    applied = await (
        await conn.execute(
            "select 1 from schema_migrations where version = %s",
            (initial_migration.name,),
        )
    ).fetchone()
    if applied is None:
        await conn.execute(
            "insert into schema_migrations (version) values (%s)",
            (initial_migration.name,),
        )
