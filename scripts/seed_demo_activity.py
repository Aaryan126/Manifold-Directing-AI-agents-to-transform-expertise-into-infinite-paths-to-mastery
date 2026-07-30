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
ACTIVITY_PATTERN = (1, 2, 1, 3, 2, 3, 2)


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
            "At least three enrolled simulated learners with reviewed questions are required."
        )
    return result


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
