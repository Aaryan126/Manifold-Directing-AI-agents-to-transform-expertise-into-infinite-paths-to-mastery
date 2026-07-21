from pathlib import Path

import psycopg

_LEGACY_MIGRATION_MARKERS: dict[str, tuple[tuple[str, str | None], ...]] = {
    "001_initial_schema.sql": (("users", None), ("videos", None)),
    "002_ingestion_jobs.sql": (("ingestion_jobs", None),),
    "003_topic_review_status.sql": (("topics", "review_status"),),
    "004_graph_review_status.sql": (
        ("concepts", "review_status"),
        ("concept_edges", "review_status"),
    ),
    "005_clip_review_status.sql": (("clips", "status"),),
    "006_question_review_status.sql": (("questions", "review_status"),),
    "007_audit_events.sql": (("audit_events", None),),
    "008_phase10_access_and_performance.sql": (
        ("courses", "status"),
        ("users", "display_name"),
        ("learner_watch_events", None),
    ),
    "009_phase10_query_indexes.sql": (("remediation_rules_target_clip_idx", None),),
    "010_dashboard_fingerprint_index.sql": (("dashboard_signals_open_fingerprint_idx", None),),
    "011_simulated_learners.sql": (("users", "is_simulated"),),
    "012_local_clip_materialization.sql": (("clips", "materialization_status"),),
    "015_agent_course_os.sql": (
        ("course_revisions", None),
        ("generation_runs", None),
        ("course_conversations", None),
    ),
    "016_revision_scoped_uniqueness.sql": (
        ("concepts_revision_name_idx", None),
        ("routing_policies_revision_concept_idx", None),
    ),
    "017_revision_briefs.sql": (("course_revisions", "brief"),),
}

_DATA_ONLY_MIGRATIONS = frozenset(
    {
        "013_inherit_split_topic_concepts.sql",
        "014_backfill_renamed_split_topic_concepts.sql",
    }
)


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
    for version, markers in _LEGACY_MIGRATION_MARKERS.items():
        if not (migrations_dir / version).exists():
            continue
        marker_results = [
            await _schema_marker_exists(conn, table_name, column_name)
            for table_name, column_name in markers
        ]
        if not all(marker_results):
            continue
        await conn.execute(
            "insert into schema_migrations (version) values (%s) on conflict do nothing",
            (version,),
        )


async def _schema_marker_exists(
    conn: psycopg.AsyncConnection[tuple[object, ...]],
    table_name: str,
    column_name: str | None,
) -> bool:
    if column_name is None:
        row = await (
            await conn.execute("select to_regclass(%s)", (f"public.{table_name}",))
        ).fetchone()
        return row is not None and row[0] is not None

    row = await (
        await conn.execute(
            """
            select exists (
              select 1
              from information_schema.columns
              where table_schema = 'public'
                and table_name = %s
                and column_name = %s
            )
            """,
            (table_name, column_name),
        )
    ).fetchone()
    return row is not None and row[0] is True
