from pathlib import Path

from app.db.migrations import (
    _DATA_ONLY_MIGRATIONS,
    _LEGACY_MIGRATION_MARKERS,
    _POST_BASELINE_MIGRATIONS,
)


def test_initial_migration_contains_prd_phase_zero_entities() -> None:
    migration = Path("migrations/001_initial_schema.sql").read_text(encoding="utf-8")
    topic_review_migration = Path("migrations/003_topic_review_status.sql").read_text(
        encoding="utf-8"
    )
    graph_review_migration = Path("migrations/004_graph_review_status.sql").read_text(
        encoding="utf-8"
    )
    clip_review_migration = Path("migrations/005_clip_review_status.sql").read_text(
        encoding="utf-8"
    )
    question_review_migration = Path("migrations/006_question_review_status.sql").read_text(
        encoding="utf-8"
    )
    audit_migration = Path("migrations/007_audit_events.sql").read_text(encoding="utf-8")
    phase10_migration = Path("migrations/008_phase10_access_and_performance.sql").read_text(
        encoding="utf-8",
    )
    dashboard_index_migration = Path("migrations/010_dashboard_fingerprint_index.sql").read_text(
        encoding="utf-8",
    )
    simulated_learner_migration = Path("migrations/011_simulated_learners.sql").read_text(
        encoding="utf-8",
    )
    course_os_migration = Path("migrations/015_agent_course_os.sql").read_text(
        encoding="utf-8",
    )
    revision_uniqueness_migration = Path("migrations/016_revision_scoped_uniqueness.sql").read_text(
        encoding="utf-8"
    )
    revision_briefs_migration = Path("migrations/017_revision_briefs.sql").read_text(
        encoding="utf-8"
    )
    course_delete_migration = Path("migrations/018_course_delete_fk_lifecycle.sql").read_text(
        encoding="utf-8"
    )
    intelligence_migration = Path("migrations/019_course_intelligence_and_sources.sql").read_text(
        encoding="utf-8"
    )
    blueprint_migration = Path("migrations/020_unified_adaptive_blueprint.sql").read_text(
        encoding="utf-8"
    )
    course_creation_migration = Path("migrations/022_course_creation_idempotency.sql").read_text(
        encoding="utf-8"
    )
    learner_migration = Path("migrations/023_agentic_learner_experience.sql").read_text(
        encoding="utf-8"
    )
    mode_migration = Path("migrations/024_intent_driven_learning_modes.sql").read_text(
        encoding="utf-8"
    )
    guide_migration = Path("migrations/025_learner_guide_conversation.sql").read_text(
        encoding="utf-8"
    )

    for table_name in [
        "users",
        "courses",
        "videos",
        "ingestion_jobs",
        "topics",
        "concepts",
        "concept_edges",
        "clips",
        "questions",
        "remediation_rules",
        "enrollments",
        "learner_concept_mastery",
        "attempts",
        "dashboard_signals",
        "routing_policies",
        "audit_events",
    ]:
        assert (
            f"create table {table_name}" in migration
            or f"create table {table_name}"
            in Path("migrations/002_ingestion_jobs.sql").read_text(encoding="utf-8")
            or f"create table if not exists {table_name}" in audit_migration
        )

    assert "concept_edges_no_self_loop" in migration
    assert "ai_proposal jsonb" in migration
    assert "instructor_revision jsonb" in migration
    assert "topics_review_status" in topic_review_migration
    assert "review_status" in topic_review_migration
    assert "concepts_review_status" in graph_review_migration
    assert "concept_edges_review_status" in graph_review_migration
    assert "clips_status" in clip_review_migration
    assert "superseded_by_clip_id" in clip_review_migration
    assert "questions_review_status" in question_review_migration
    assert "review_status" in question_review_migration
    assert "audit_events_artifact_idx" in audit_migration
    assert "dashboard_signal_id" in audit_migration
    assert "scope text not null" in audit_migration
    assert "course_publish_status" in phase10_migration
    assert "learner_watch_events" in phase10_migration
    assert "dashboard_signals_course_status_idx" in phase10_migration
    assert "dashboard_signals_open_fingerprint_idx" in dashboard_index_migration
    assert "is_simulated boolean not null default false" in simulated_learner_migration
    assert "demo-learner-%@coursefoundry.local" in simulated_learner_migration
    for table_name in [
        "course_revisions",
        "generation_runs",
        "generation_tasks",
        "review_bundles",
        "review_items",
        "course_conversations",
        "course_messages",
        "course_proposals",
    ]:
        assert f"create table {table_name}" in course_os_migration
    assert "active_revision_id" in course_os_migration
    assert "working_revision_id" in course_os_migration
    assert "logical_id" in course_os_migration
    assert "lease_expires_at" in course_os_migration
    assert "enrollments_revision_idx" in course_os_migration
    assert "concepts_revision_name_idx" in revision_uniqueness_migration
    assert "routing_policies_revision_concept_idx" in revision_uniqueness_migration
    assert "add column brief jsonb" in revision_briefs_migration
    assert "nulls not distinct" in revision_uniqueness_migration
    assert "remediation_rules_target_concept_id_fkey" in course_delete_migration
    assert "remediation_rules_target_clip_id_fkey" in course_delete_migration
    assert "enrollments_revision_id_fkey" in course_delete_migration
    assert course_delete_migration.count("deferrable initially deferred") == 6
    for table_name in [
        "course_sources",
        "course_revision_sources",
        "source_sections",
        "source_citations",
        "course_agent_tasks",
        "course_map_layouts",
    ]:
        assert f"create table {table_name}" in intelligence_migration
    assert "revision_source_visibility_reviewed" in intelligence_migration
    assert "add column sequence_rank integer" in blueprint_migration
    assert "create table question_concepts" in blueprint_migration
    assert "question_concepts_one_primary_idx" in blueprint_migration
    assert "create table learner_route_events" in blueprint_migration
    assert "evidence_snapshot jsonb" in blueprint_migration
    assert "courses_instructor_creation_request_unique" in course_creation_migration
    assert "brief->>'creation_request_id'" in course_creation_migration
    for table_name in [
        "question_hint_ladders",
        "learner_course_preferences",
        "learner_placement_checks",
        "learner_placement_items",
        "learner_study_sessions",
        "learner_session_steps",
        "learner_reflections",
        "learner_review_schedules",
        "learner_help_requests",
    ]:
        assert f"create table {table_name}" in learner_migration
    assert "purpose in ('lesson', 'placement', 'review')" in learner_migration
    assert "learner_study_sessions_one_open_idx" in learner_migration
    assert "question_hint_ladders_array" in learner_migration
    assert "add column mode text" in mode_migration
    assert "strengthen_weak_areas" in mode_migration
    assert "alter column budget_minutes drop not null" in mode_migration
    assert "alter column estimated_minutes drop not null" in mode_migration
    assert "create table learner_guide_messages" in guide_migration
    assert "learner_guide_messages_conversation_idx" in guide_migration


def test_legacy_schema_baseline_covers_every_migration() -> None:
    migration_names = {path.name for path in Path("migrations").glob("*.sql")}

    assert (
        set(_LEGACY_MIGRATION_MARKERS) | _DATA_ONLY_MIGRATIONS | _POST_BASELINE_MIGRATIONS
    ) == migration_names


def test_compose_leaves_migration_ownership_to_pipeline() -> None:
    compose = Path("../docker-compose.yml").read_text(encoding="utf-8")

    assert "/docker-entrypoint-initdb.d" not in compose
