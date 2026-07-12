import asyncio
import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from time import perf_counter
from uuid import UUID, uuid4

import psycopg
from psycopg.types.json import Jsonb

from app.access.postgres_repository import PostgresAccessRepository
from app.access.service import AccessService
from app.config import get_settings
from app.dashboard.postgres_repository import PostgresDashboardRepository
from app.dashboard.service import DashboardService
from app.db.pool import close_connection_pools
from app.routing.models import AttemptSubmission
from app.routing.postgres_repository import PostgresRoutingRepository
from app.routing.service import RoutingService


@dataclass(frozen=True)
class Fixture:
    instructor_id: UUID
    course_id: UUID
    learner_ids: tuple[UUID, ...]
    question_id: UUID
    mastered_ids: frozenset[UUID]


TARGETS = {
    "graph_eligibility": {"p50": 50.0, "p95": 150.0, "p99": 300.0},
    "learner_routing": {"p50": 150.0, "p95": 400.0, "p99": 800.0},
    "dashboard_aggregation": {"p50": 250.0, "p95": 750.0, "p99": 1500.0},
}


async def main() -> None:
    database_url = get_settings().database_url
    fixture = await seed_profile(database_url)
    routing_repository = PostgresRoutingRepository(database_url)
    routing_service = RoutingService(
        routing_repository,
        AccessService(PostgresAccessRepository(database_url)),
    )
    dashboard_service = DashboardService(PostgresDashboardRepository(database_url))
    try:
        await routing_repository.eligible_next_concepts(
            fixture.course_id,
            fixture.mastered_ids,
        )
        await dashboard_service.refresh_dashboard(fixture.course_id)

        results = {
            "graph_eligibility": await measure(
                lambda _: routing_repository.eligible_next_concepts(
                    fixture.course_id,
                    fixture.mastered_ids,
                ),
                iterations=200,
                concurrency=20,
            ),
            "learner_routing": await measure(
                lambda index: routing_service.submit_attempt(
                    AttemptSubmission(
                        learner_id=fixture.learner_ids[index % len(fixture.learner_ids)],
                        question_id=fixture.question_id,
                        answer={"answer": "benchmark"},
                        correctness=True,
                        confidence=4,
                        wrong_answer_pattern=None,
                    ),
                ),
                iterations=100,
                concurrency=20,
            ),
            "dashboard_aggregation": await measure(
                lambda _: dashboard_service.refresh_dashboard(fixture.course_id),
                iterations=30,
                concurrency=3,
            ),
        }
        dashboard_components = {
            "learner_count": await measure(
                lambda _: dashboard_service._repository.learner_count(fixture.course_id),
                iterations=5,
                concurrency=1,
            ),
            "attempt_count": await measure(
                lambda _: dashboard_service._repository.attempt_count(fixture.course_id),
                iterations=5,
                concurrency=1,
            ),
            "concept_stats": await measure(
                lambda _: dashboard_service._repository.concept_stats(fixture.course_id),
                iterations=5,
                concurrency=1,
            ),
            "question_stats": await measure(
                lambda _: dashboard_service._repository.question_stats(fixture.course_id),
                iterations=5,
                concurrency=1,
            ),
            "clip_stats": await measure(
                lambda _: dashboard_service._repository.clip_stats(fixture.course_id),
                iterations=5,
                concurrency=1,
            ),
            "open_signals": await measure(
                lambda _: dashboard_service._repository.open_signals(fixture.course_id),
                iterations=5,
                concurrency=1,
            ),
        }
        report = {
            "profile": {
                "courses": 1,
                "videos": 10,
                "topics": 60,
                "concepts": 300,
                "edges": 450,
                "clips": 600,
                "questions": 60,
                "learners": 100,
                "seeded_attempts": 20_000,
                "mastery_rows": 30_000,
                "dashboard_signals": 500,
            },
            "environment": "warm local service/database; setup and seeding excluded",
            "results_ms": results,
            "dashboard_component_diagnostics_ms": dashboard_components,
            "targets_ms": TARGETS,
        }
        print(json.dumps(report, indent=2))
        failures = [
            f"{name} {percentile}={values[percentile]:.2f}ms > {target:.2f}ms"
            for name, values in results.items()
            for percentile, target in TARGETS[name].items()
            if values[percentile] > target
        ]
        if failures:
            raise SystemExit("Performance targets failed: " + "; ".join(failures))
    finally:
        await cleanup_profile(database_url, fixture)
        await close_connection_pools()


async def measure(
    operation: Callable[[int], Awaitable[object]],
    *,
    iterations: int,
    concurrency: int,
) -> dict[str, float]:
    semaphore = asyncio.Semaphore(concurrency)

    async def timed(index: int) -> float:
        async with semaphore:
            started = perf_counter()
            await operation(index)
            return (perf_counter() - started) * 1000

    samples = sorted(await asyncio.gather(*(timed(index) for index in range(iterations))))
    return {
        "p50": percentile(samples, 0.50),
        "p95": percentile(samples, 0.95),
        "p99": percentile(samples, 0.99),
        "max": samples[-1],
    }


def percentile(samples: list[float], quantile: float) -> float:
    index = min(max(round((len(samples) - 1) * quantile), 0), len(samples) - 1)
    return round(samples[index], 2)


async def seed_profile(database_url: str) -> Fixture:
    suffix = uuid4().hex
    instructor_id = uuid4()
    course_id = uuid4()
    video_ids = tuple(uuid4() for _ in range(10))
    topic_ids = tuple(uuid4() for _ in range(60))
    concept_ids = tuple(uuid4() for _ in range(300))
    clip_ids = tuple(uuid4() for _ in range(600))
    question_ids = tuple(uuid4() for _ in range(60))
    learner_ids = tuple(uuid4() for _ in range(100))

    async with await psycopg.AsyncConnection.connect(database_url) as conn:
        cursor = conn.cursor()
        await conn.execute(
            "insert into users (id, email, display_name, role) values (%s, %s, %s, 'instructor')",
            (instructor_id, f"perf-instructor-{suffix}@example.test", "Performance Instructor"),
        )
        await conn.execute(
            """
            insert into courses (id, instructor_id, title, status, published_at)
            values (%s, %s, %s, 'published', now())
            """,
            (course_id, instructor_id, f"Phase 10 performance {suffix}"),
        )
        await cursor.executemany(
            """
            insert into videos (
              id, course_id, source_kind, source_uri, transcript, duration_seconds
            ) values (%s, %s, 'upload', %s, '{}'::jsonb, 7200)
            """,
            [(video_id, course_id, f"/tmp/{video_id}.mp4") for video_id in video_ids],
        )
        await cursor.executemany(
            """
            insert into topics (
              id, course_id, video_id, title, start_seconds, end_seconds,
              review_status, approved_at
            ) values (%s, %s, %s, %s, %s, %s, 'accepted', now())
            """,
            [
                (
                    topic_id,
                    course_id,
                    video_ids[index // 6],
                    f"Topic {index}",
                    (index % 6) * 1200,
                    ((index % 6) + 1) * 1200,
                )
                for index, topic_id in enumerate(topic_ids)
            ],
        )
        await cursor.executemany(
            """
            insert into concepts (
              id, course_id, name, description, review_status, approved_at
            ) values (%s, %s, %s, %s, 'accepted', now())
            """,
            [
                (concept_id, course_id, f"Concept {index} {suffix}", "Benchmark concept")
                for index, concept_id in enumerate(concept_ids)
            ],
        )
        edge_pairs = [(index, index + 1) for index in range(299)] + [
            (index, index + 2) for index in range(151)
        ]
        await cursor.executemany(
            """
            insert into concept_edges (
              from_concept_id, to_concept_id, review_status, approved_at
            ) values (%s, %s, 'accepted', now())
            """,
            [(concept_ids[source], concept_ids[target]) for source, target in edge_pairs],
        )
        await cursor.executemany(
            "insert into topic_concepts (topic_id, concept_id) values (%s, %s)",
            [
                (topic_ids[index % len(topic_ids)], concept_id)
                for index, concept_id in enumerate(concept_ids)
            ],
        )
        await cursor.executemany(
            """
            insert into clips (
              id, topic_id, start_seconds, end_seconds, type, difficulty, status
            ) values (%s, %s, %s, %s, 'explanation', 'standard', 'active')
            """,
            [
                (
                    clip_id,
                    topic_ids[index // 10],
                    (index % 10) * 120,
                    ((index % 10) + 1) * 120,
                )
                for index, clip_id in enumerate(clip_ids)
            ],
        )
        await cursor.executemany(
            "insert into clip_concepts (clip_id, concept_id) values (%s, %s)",
            [
                (clip_id, concept_ids[index % len(concept_ids)])
                for index, clip_id in enumerate(clip_ids)
            ],
        )
        await cursor.executemany(
            """
            insert into questions (
              id, topic_id, body, type, correct_answer, confidence_prompt,
              review_status, approved_at
            ) values (%s, %s, %s, 'mcq', %s::jsonb, %s, 'accepted', now())
            """,
            [
                (
                    question_id,
                    topic_ids[index],
                    f"Question {index}",
                    Jsonb({"answer": "A"}),
                    "How confident are you?",
                )
                for index, question_id in enumerate(question_ids)
            ],
        )
        await cursor.executemany(
            """
            insert into users (id, email, display_name, role)
            values (%s, %s, %s, 'learner')
            """,
            [
                (learner_id, f"perf-learner-{index}-{suffix}@example.test", f"Learner {index}")
                for index, learner_id in enumerate(learner_ids)
            ],
        )
        await cursor.executemany(
            "insert into enrollments (learner_id, course_id) values (%s, %s)",
            [(learner_id, course_id) for learner_id in learner_ids],
        )
        await cursor.executemany(
            """
            insert into learner_concept_mastery (learner_id, concept_id, state)
            values (%s, %s, %s)
            """,
            [
                (
                    learner_id,
                    concept_id,
                    "mastered" if concept_index < 10 else "not_started",
                )
                for learner_id in learner_ids
                for concept_index, concept_id in enumerate(concept_ids)
            ],
        )
        await cursor.executemany(
            """
            insert into attempts (
              learner_id, question_id, answer, correctness, confidence
            ) values (%s, %s, %s::jsonb, %s, %s)
            """,
            [
                (
                    learner_ids[index % 100],
                    question_ids[index % 60],
                    Jsonb({"answer": "benchmark"}),
                    index % 4 != 0,
                    (index % 4) + 1,
                )
                for index in range(20_000)
            ],
        )
        await cursor.executemany(
            """
            insert into dashboard_signals (
              course_id, type, related_entity_type, related_entity_id,
              ai_diagnosis, status
            ) values (%s, 'graph_drift', 'concept', %s, %s::jsonb, 'open')
            """,
            [
                (
                    course_id,
                    concept_ids[index % len(concept_ids)],
                    Jsonb({"summary": f"Benchmark signal {index}"}),
                )
                for index in range(500)
            ],
        )

    await maintain_benchmark_tables(database_url)

    return Fixture(
        instructor_id=instructor_id,
        course_id=course_id,
        learner_ids=learner_ids,
        question_id=question_ids[0],
        mastered_ids=frozenset(concept_ids[:10]),
    )


async def cleanup_profile(database_url: str, fixture: Fixture) -> None:
    async with await psycopg.AsyncConnection.connect(database_url) as conn:
        await conn.execute("delete from courses where id = %s", (fixture.course_id,))
        await conn.execute(
            "delete from users where id = %s or id = any(%s::uuid[])",
            (fixture.instructor_id, list(fixture.learner_ids)),
        )


async def maintain_benchmark_tables(database_url: str) -> None:
    tables = (
        "attempts",
        "learner_concept_mastery",
        "dashboard_signals",
        "concepts",
        "concept_edges",
        "topic_concepts",
        "questions",
        "clips",
        "clip_concepts",
        "remediation_rules",
        "enrollments",
    )
    async with await psycopg.AsyncConnection.connect(database_url, autocommit=True) as conn:
        for table in tables:
            await conn.execute(f"vacuum analyze {table}")


if __name__ == "__main__":
    asyncio.run(main())
