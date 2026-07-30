#!/usr/bin/env python3
"""Seed an honest seven-day activity curve from explicitly simulated learners."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import UTC, datetime, timedelta
from typing import NamedTuple
from uuid import NAMESPACE_URL, UUID, uuid5

DEFAULT_INSTRUCTOR_EMAIL = "dev-instructor@coursefoundry.local"
SEED_KEY = "portfolio-activity-v1"
SEEDED_LEARNER_COUNT = 12
NEW_LEARNER_COUNT = 5
ACTIVITY_PATTERN = (5, 8, 6, 11, 9, 12, 10)


class Assignment(NamedTuple):
    learner_id: UUID
    question_id: UUID
    learner_email: str
    course_title: str


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description=__doc__)
    value.add_argument("--instructor-email", default=DEFAULT_INSTRUCTOR_EMAIL)
    value.add_argument(
        "--apply",
        action="store_true",
        help="Replace the prior labelled demo seed with the seven-day curve.",
    )
    return value


def literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def psql(query: str) -> str:
    result = subprocess.run(
        [
            "docker",
            "compose",
            "exec",
            "-T",
            "postgres",
            "psql",
            "-U",
            "coursefoundry",
            "-d",
            "coursefoundry",
            "-At",
            "-v",
            "ON_ERROR_STOP=1",
            "-c",
            query,
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or "Postgres command failed.")
    return result.stdout.strip()


def assignments(instructor_email: str) -> tuple[Assignment, ...]:
    instructor_id = psql(
        "select id from users "
        f"where email = {literal(instructor_email)} and role = 'instructor'"
    )
    if not instructor_id:
        raise RuntimeError("The selected instructor account does not exist.")
    rows = psql(
        "select distinct on (e.learner_id) "
        "e.learner_id, q.id, u.email, c.title "
        "from enrollments e "
        "join users u on u.id = e.learner_id and u.is_simulated "
        "join courses c on c.id = e.course_id and c.status = 'published' "
        "join lateral ("
        " select q.id from questions q "
        " join topics t on t.id = q.topic_id "
        " where q.revision_id = c.active_revision_id "
        " and t.revision_id = c.active_revision_id "
        " and q.review_status in ('accepted', 'edited') "
        " order by q.created_at limit 1"
        ") q on true "
        f"where c.instructor_id = {literal(instructor_id)}::uuid "
        "order by e.learner_id, c.title"
    )
    result = tuple(
        Assignment(
            learner_id=UUID(parts[0]),
            question_id=UUID(parts[1]),
            learner_email=parts[2],
            course_title=parts[3],
        )
        for row in rows.splitlines()
        if (parts := row.split("|", 3)) and len(parts) == 4
    )
    if len(result) < max(ACTIVITY_PATTERN):
        raise RuntimeError(
            f"At least {max(ACTIVITY_PATTERN)} enrolled simulated learners with "
            "reviewed questions are required."
        )
    return result


def seed_learners(instructor_email: str) -> int:
    target = psql(
        "select c.id, c.active_revision_id "
        "from courses c "
        "join users i on i.id = c.instructor_id "
        "where i.email = "
        f"{literal(instructor_email)} "
        "and c.status = 'published' "
        "and exists ("
        " select 1 from questions q "
        " join topics t on t.id = q.topic_id "
        " where q.revision_id = c.active_revision_id "
        " and t.revision_id = c.active_revision_id "
        " and q.review_status in ('accepted', 'edited')"
        ") "
        "order by c.title, c.id "
        "limit 1"
    )
    if not target:
        raise RuntimeError(
            "No published instructor course with a reviewed question is available."
        )
    course_id, revision_id = target.split("|", 1)
    user_values: list[str] = []
    enrollment_values: list[str] = []
    for index in range(1, SEEDED_LEARNER_COUNT + 1):
        email = f"portfolio-activity-{index:02d}@coursefoundry.local"
        learner_id = uuid5(NAMESPACE_URL, f"{SEED_KEY}:learner:{email}")
        enrollment_id = uuid5(
            NAMESPACE_URL,
            f"{SEED_KEY}:enrollment:{learner_id}:{course_id}",
        )
        user_values.append(
            "("
            f"{literal(str(learner_id))}::uuid,"
            f"{literal(email)},"
            "'learner',"
            f"{literal(f'Demo learner {index:02d}')},"
            "true"
            ")"
        )
        created_at = (
            f"(now() at time zone 'UTC')::date - interval '{index - 1} days' "
            "+ interval '9 hours'"
            if index <= NEW_LEARNER_COUNT
            else "(now() at time zone 'UTC')::date - interval '30 days'"
        )
        enrollment_values.append(
            "("
            f"{literal(str(enrollment_id))}::uuid,"
            f"{literal(str(learner_id))}::uuid,"
            f"{literal(course_id)}::uuid,"
            f"{literal(revision_id)}::uuid,"
            f"{created_at}"
            ")"
        )
    psql(
        "begin; "
        "insert into users (id, email, role, display_name, is_simulated) values "
        + ",".join(user_values)
        + " on conflict (email) do update set "
        "role = excluded.role, display_name = excluded.display_name, "
        "is_simulated = excluded.is_simulated; "
        "insert into enrollments (id, learner_id, course_id, revision_id, created_at) "
        "values "
        + ",".join(enrollment_values)
        + " on conflict (learner_id, course_id) do update set "
        "revision_id = excluded.revision_id, created_at = excluded.created_at; "
        "commit;"
    )
    return SEEDED_LEARNER_COUNT


def seed_rows(eligible: tuple[Assignment, ...]) -> int:
    today = datetime.now(UTC).date()
    values: list[str] = []
    for day_index, active_count in enumerate(ACTIVITY_PATTERN):
        activity_date = today - timedelta(days=6 - day_index)
        for learner_index, assignment in enumerate(eligible[:active_count]):
            attempt_id = uuid5(
                NAMESPACE_URL,
                f"{SEED_KEY}:{activity_date.isoformat()}:{assignment.learner_id}",
            )
            answer = json.dumps({
                "selected": "simulated-demo-answer",
                "demo_seed": SEED_KEY,
            })
            correctness = (day_index + learner_index) % 3 != 0
            values.append(
                "("
                f"{literal(str(attempt_id))}::uuid,"
                f"{literal(str(assignment.learner_id))}::uuid,"
                f"{literal(str(assignment.question_id))}::uuid,"
                f"{literal(answer)}::jsonb,"
                f"{str(correctness).lower()},"
                "3,"
                f"{literal(activity_date.isoformat())}::date + interval '12 hours',"
                "'lesson'"
                ")"
            )
    psql(
        "begin; "
        f"delete from attempts where answer->>'demo_seed' = {literal(SEED_KEY)}; "
        "insert into attempts ("
        "id, learner_id, question_id, answer, correctness, confidence, created_at, purpose"
        ") values "
        + ",".join(values)
        + "; commit;"
    )
    return len(values)


def main() -> int:
    args = parser().parse_args()
    try:
        if args.apply:
            learner_count = seed_learners(args.instructor_email)
            print(
                f"Seeded {learner_count} labelled simulated learners; "
                f"{NEW_LEARNER_COUNT} enrolled this week."
            )
        eligible = assignments(args.instructor_email)
        print(
            f"Ready: {len(eligible)} enrolled simulated learners have reviewed questions."
        )
        if not args.apply:
            print("Read-only check complete. Add --apply to replace the labelled demo seed.")
            return 0
        count = seed_rows(eligible)
        print(
            f"Seeded {count} labelled attempts with activity pattern "
            f"{list(ACTIVITY_PATTERN)}."
        )
        return 0
    except RuntimeError as error:
        print(f"Demo activity seed failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
