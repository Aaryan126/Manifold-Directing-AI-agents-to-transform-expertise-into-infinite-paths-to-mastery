#!/usr/bin/env python3
"""Reset one learner to the competition course's misconception-check moment.

The script is deliberately exact and recoverable:
- it requires an explicit course UUID;
- it only resets the selected learner inside that course;
- it uses the running learning API to build and advance the new session;
- without --apply it performs a read-only readiness check.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import urllib.error
import urllib.request
from typing import Any
from uuid import UUID


DEFAULT_LEARNER_EMAIL = "dev-learner@coursefoundry.local"


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description=__doc__)
    value.add_argument("--course-id", required=True, type=UUID)
    value.add_argument(
        "--concept",
        required=True,
        help="Exact concept name used for the misconception demonstration.",
    )
    value.add_argument("--learner-email", default=DEFAULT_LEARNER_EMAIL)
    value.add_argument("--api-base", default="http://localhost:8000")
    value.add_argument(
        "--apply",
        action="store_true",
        help="Actually reset learner evidence and create the prepared session.",
    )
    return value


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


def literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def request_json(
    api_base: str,
    path: str,
    learner_id: str,
    *,
    method: str = "GET",
    body: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(
        f"{api_base.rstrip('/')}{path}",
        data=payload,
        method=method,
        headers={
            "Content-Type": "application/json",
            "X-User-ID": learner_id,
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode())
    except urllib.error.HTTPError as error:
        detail = error.read().decode()
        raise RuntimeError(
            f"{method} {path} failed ({error.code}): {detail}"
        ) from error


def readiness(course_id: UUID, learner_email: str, concept_name: str) -> dict[str, str]:
    course = psql(
        "select concat_ws('|', id, title, status, "
        "coalesce(active_revision_id, working_revision_id)) "
        f"from courses where id = {literal(str(course_id))}::uuid"
    )
    if not course:
        raise RuntimeError("The exact course does not exist.")
    course_uuid, title, status, revision_id = course.split("|", 3)
    if title.strip().lower() in {"untitled course", "development course"}:
        raise RuntimeError("Competition reset refuses placeholder courses.")
    if not revision_id:
        raise RuntimeError("The course has no usable revision.")

    learner = psql(
        "select id from users "
        f"where email = {literal(learner_email)} and role = 'learner'"
    )
    if not learner:
        raise RuntimeError("The selected learner account does not exist.")

    concept = psql(
        "select c.id from concepts c "
        f"where c.course_id = {literal(course_uuid)}::uuid "
        f"and c.revision_id = {literal(revision_id)}::uuid "
        f"and c.name = {literal(concept_name)} "
        "and c.review_status in ('accepted', 'edited') "
        "limit 1"
    )
    if not concept:
        raise RuntimeError(
            "The exact reviewed misconception concept was not found in the selected revision."
        )
    coverage = psql(
        "select concat_ws('|', "
        "(select count(*) from clips cl "
        " join clip_concepts cc on cc.clip_id = cl.id "
        f" where cc.concept_id = {literal(concept)}::uuid "
        " and cl.status = 'active'), "
        "(select count(*) from question_concepts qc "
        " join questions q on q.id = qc.question_id "
        f" where qc.concept_id = {literal(concept)}::uuid "
        " and q.review_status in ('accepted', 'edited')))"
    )
    clips, questions = coverage.split("|", 1)
    if int(clips) < 1 or int(questions) < 1:
        raise RuntimeError(
            "The selected concept needs at least one reviewed clip and one reviewed question."
        )
    return {
        "course_id": course_uuid,
        "course_title": title,
        "course_status": status,
        "revision_id": revision_id,
        "learner_id": learner,
        "concept_id": concept,
        "clips": clips,
        "questions": questions,
    }


def reset_rows(state: dict[str, str], learner_email: str) -> None:
    learner_id = literal(state["learner_id"])
    course_id = literal(state["course_id"])
    revision_id = literal(state["revision_id"])
    # All predicates are scoped to this learner, course, and selected revision.
    psql(
        "begin; "
        f"update users set is_simulated = true where id = {learner_id}::uuid; "
        f"delete from learner_guide_messages where learner_id = {learner_id}::uuid "
        f"and course_id = {course_id}::uuid; "
        f"delete from learner_help_requests where learner_id = {learner_id}::uuid "
        f"and course_id = {course_id}::uuid; "
        f"delete from learner_course_preferences where learner_id = {learner_id}::uuid "
        f"and course_id = {course_id}::uuid; "
        f"delete from learner_placement_checks where learner_id = {learner_id}::uuid "
        f"and course_id = {course_id}::uuid; "
        f"delete from learner_review_schedules where learner_id = {learner_id}::uuid "
        f"and course_id = {course_id}::uuid; "
        f"delete from learner_unit_progress where learner_id = {learner_id}::uuid "
        f"and course_id = {course_id}::uuid; "
        f"delete from learner_watch_events where learner_id = {learner_id}::uuid "
        "and clip_id in (select id from clips "
        f"where revision_id = {revision_id}::uuid); "
        f"delete from learner_study_sessions where learner_id = {learner_id}::uuid "
        f"and course_id = {course_id}::uuid; "
        f"delete from attempts where learner_id = {learner_id}::uuid "
        "and question_id in (select id from questions "
        f"where revision_id = {revision_id}::uuid); "
        f"delete from learner_concept_mastery where learner_id = {learner_id}::uuid "
        "and concept_id in (select id from concepts "
        f"where revision_id = {revision_id}::uuid); "
        f"insert into enrollments (learner_id, course_id, revision_id) "
        f"values ({learner_id}::uuid, {course_id}::uuid, {revision_id}::uuid) "
        "on conflict (learner_id, course_id) do update "
        "set revision_id = excluded.revision_id; "
        "commit;"
    )
    print(f"Reset learner evidence for {learner_email}.")


def prepare_session(state: dict[str, str], api_base: str) -> dict[str, Any]:
    learner_id = state["learner_id"]
    course_id = state["course_id"]
    request_json(
        api_base,
        f"/learn/courses/{course_id}/orientation",
        learner_id,
        method="PUT",
        body={"entry_choice": "recommended"},
    )
    session = request_json(
        api_base,
        f"/learn/courses/{course_id}/sessions",
        learner_id,
        method="POST",
        body={
            "mode": "continue_path",
            "idempotency_key": "competition-demo-before-misconception",
            "concept_id": state["concept_id"],
        },
    )
    session = request_json(
        api_base,
        f"/learn/courses/{course_id}/sessions/{session['id']}/start",
        learner_id,
        method="POST",
    )
    # Advance only reviewed watch steps. Stop at the first active question so
    # the recorded answer creates real evidence and a real routing event.
    while True:
        active = next(
            (step for step in session["steps"] if step["status"] == "active"),
            None,
        )
        if active is None:
            raise RuntimeError("Prepared session has no active step.")
        if active["kind"] == "question":
            return session
        if active["kind"] != "watch":
            raise RuntimeError(
                f"Expected a watch or question step, found {active['kind']}."
            )
        session = request_json(
            api_base,
            (
                f"/learn/courses/{course_id}/sessions/{session['id']}"
                f"/steps/{active['id']}/watch"
            ),
            learner_id,
            method="POST",
        )


def main() -> int:
    args = parser().parse_args()
    try:
        state = readiness(args.course_id, args.learner_email, args.concept)
        print(
            "Ready:",
            f"{state['course_title']} ({state['course_status']});",
            f"{state['clips']} reviewed clip(s);",
            f"{state['questions']} reviewed question(s).",
        )
        if not args.apply:
            print("Read-only check complete. Add --apply to reset and prepare the learner.")
            return 0
        reset_rows(state, args.learner_email)
        session = prepare_session(state, args.api_base)
        active = next(
            step for step in session["steps"] if step["status"] == "active"
        )
        print("Prepared learner state:")
        print(json.dumps({
            "course_id": state["course_id"],
            "learner_id": state["learner_id"],
            "session_id": session["id"],
            "active_step": active["kind"],
            "active_question_id": active["question_id"],
            "concept": active["concept_name"],
        }, indent=2))
        return 0
    except (RuntimeError, subprocess.CalledProcessError) as error:
        print(f"Competition reset failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
