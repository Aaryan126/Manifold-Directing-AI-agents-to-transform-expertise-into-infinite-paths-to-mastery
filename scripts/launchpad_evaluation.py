#!/usr/bin/env python3
"""Run the reproducible LaunchPad evidence harness and write JSON + Markdown."""

from __future__ import annotations

import argparse
import json
import math
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_JSON = ROOT / "competition" / "metrics.json"
DEFAULT_MARKDOWN = ROOT / "competition" / "metrics.md"
PIPELINE_URL = "http://localhost:8000"
WEB_URL = "http://localhost:3000"
TERMINAL_RUN_STATES = {"waiting_review", "complete", "failed", "cancelled"}
OPENAI_PRICES_PER_MILLION = {
    "gpt-5.4": {"input": 2.50, "cached_input": 0.25, "output": 15.00},
}

BASELINES = [
    {
        "method": "Articulate 360 AI",
        "verified_capability": (
            "Creates editable course drafts, lessons, interactive blocks, and knowledge "
            "checks from prompts or source documents."
        ),
        "difference": (
            "A direct authoring baseline. Its public page does not establish the same "
            "source-to-mastery-to-revision lineage measured by this harness."
        ),
        "commercial_context": "$1,449 personal or $1,749 teams per user/year (vendor list price).",
        "source": "https://www.articulate.com/features/ai-powered-authoring/",
        "pricing_source": "https://www.articulate.com/360/pricing/",
    },
    {
        "method": "H5P Interactive Video",
        "verified_capability": (
            "Authors overlays, quizzes, summaries, and Go To adaptivity on an existing video."
        ),
        "difference": (
            "A strong manual interactive-video baseline; the official tutorial describes "
            "placing interactions and adaptive jumps in the authoring UI."
        ),
        "commercial_context": "Open content format; hosting and authoring arrangement varies.",
        "source": "https://h5p.org/tutorial-interactive-video",
    },
    {
        "method": "Area9 Rhapsode",
        "verified_capability": (
            "An integrated adaptive learning platform that continuously personalizes paths "
            "toward mastery."
        ),
        "difference": (
            "A mature adaptive-platform baseline. Manifold's evaluated wedge begins with an "
            "instructor recording and makes every course-revision decision reviewable."
        ),
        "commercial_context": "No public price used in this comparison.",
        "source": "https://area9lyceum.com/",
    },
    {
        "method": "Traditional custom e-learning",
        "verified_capability": (
            "ATD notes that development time depends on content, interactivity, media, tools, "
            "expertise, and review cycles."
        ),
        "difference": (
            "No universal hour ratio is treated as ground truth. The defensible comparison is "
            "a matched manual build, which remains a follow-up experiment."
        ),
        "commercial_context": "Team and workflow dependent.",
        "source": "https://www.td.org/content/atd-blog/estimating-e-learning-development-time",
    },
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", type=Path, default=DEFAULT_JSON)
    parser.add_argument("--markdown", type=Path, default=DEFAULT_MARKDOWN)
    parser.add_argument("--trials", type=int, default=20)
    parser.add_argument("--skip-tests", action="store_true")
    parser.add_argument("--no-build", action="store_true")
    parser.add_argument(
        "--render-existing",
        action="store_true",
        help=(
            "Recalculate derived counts and regenerate Markdown from the existing JSON "
            "without rerunning tests, the application, or provider calls."
        ),
    )
    parser.add_argument(
        "--run-generation",
        action="store_true",
        help=(
            "Create a disposable course, clone one local transcript-backed source, run the "
            "real AI generation pipeline, capture its measurements, then delete the course."
        ),
    )
    parser.add_argument("--generation-timeout", type=int, default=1800)
    return parser.parse_args()


def run_command(
    name: str,
    command: list[str],
    *,
    cwd: Path = ROOT,
    timeout: int = 1800,
) -> dict[str, Any]:
    started = time.perf_counter()
    result = subprocess.run(
        command,
        cwd=cwd,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )
    output = "\n".join(part for part in (result.stdout, result.stderr) if part).strip()
    return {
        "name": name,
        "command": " ".join(command),
        "passed": result.returncode == 0,
        "exit_code": result.returncode,
        "duration_seconds": round(time.perf_counter() - started, 3),
        "test_count": extract_test_count(output),
        "output_tail": output[-2000:],
    }


def extract_test_count(output: str) -> int | None:
    workspace_counts = [
        int(value) for value in re.findall(r"Tests\s+(\d+)\s+passed", output)
    ]
    if workspace_counts:
        return sum(workspace_counts)
    suite_counts = [
        int(value)
        for value in re.findall(r"(?m)^\s*(\d+)\s+passed(?:\s|,|$)", output)
    ]
    return max(suite_counts) if suite_counts else None


def render_existing_report(json_path: Path, markdown_path: Path) -> None:
    data = json.loads(json_path.read_text())
    data["git_commit"] = current_git_commit()
    for command in data["commands"]:
        command["test_count"] = extract_test_count(command.get("output_tail", ""))
    data["quality_gates"] = quality_gates(
        data["commands"],
        data["endpoint_latency"],
        data["current_course"],
        data.get("generation"),
    )
    json_path.write_text(json.dumps(data, indent=2) + "\n")
    markdown_path.parent.mkdir(parents=True, exist_ok=True)
    markdown_path.write_text(markdown_report(data))


def current_git_commit() -> str:
    return subprocess.run(
        ["git", "rev-parse", "--short", "HEAD"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()


def api(
    path: str,
    *,
    method: str = "GET",
    user_id: str | None = None,
    payload: dict[str, Any] | None = None,
    timeout: float = 30,
) -> Any:
    headers = {"Accept": "application/json"}
    if user_id:
        headers["X-User-ID"] = user_id
    data = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(payload).encode()
    request = urllib.request.Request(
        f"{PIPELINE_URL}{path}",
        data=data,
        headers=headers,
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read()
            return json.loads(body) if body else None
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")
        raise RuntimeError(f"{method} {path} failed ({exc.code}): {detail}") from exc


def request_latency(
    url: str,
    *,
    trials: int,
    user_id: str | None = None,
) -> dict[str, Any]:
    headers = {"X-User-ID": user_id} if user_id else {}
    durations: list[float] = []
    for _ in range(3):
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=15):
            pass
    for _ in range(trials):
        started = time.perf_counter()
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=15):
            pass
        durations.append((time.perf_counter() - started) * 1000)
    return {
        "trials": trials,
        "p50_ms": round(percentile(durations, 50), 2),
        "p95_ms": round(percentile(durations, 95), 2),
        "min_ms": round(min(durations), 2),
        "max_ms": round(max(durations), 2),
    }


def percentile(values: list[float], percent: float) -> float:
    ordered = sorted(values)
    rank = max(0, math.ceil(percent / 100 * len(ordered)) - 1)
    return ordered[rank]


def wait_for_stack(timeout: int = 180) -> None:
    deadline = time.monotonic() + timeout
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(f"{PIPELINE_URL}/health", timeout=3):
                pass
            with urllib.request.urlopen(f"{WEB_URL}/api/health", timeout=3):
                return
        except Exception as exc:  # noqa: BLE001 - health polling records the last error.
            last_error = exc
            time.sleep(2)
    raise RuntimeError(f"Application stack did not become healthy: {last_error}")


def psql(sql: str) -> str:
    command = [
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
        "-F",
        "|",
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        sql,
    ]
    result = subprocess.run(
        command,
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or "PostgreSQL evaluation query failed.")
    return result.stdout.strip()


def choose_instructor() -> str:
    identities = api("/development/identities")
    instructors = [item for item in identities if item["role"] == "instructor"]
    if not instructors:
        raise RuntimeError("No development instructor identity is available.")
    preferred = next(
        (
            item
            for item in instructors
            if item["email"] == "dev-instructor@coursefoundry.local"
        ),
        instructors[0],
    )
    return str(preferred["id"])


def current_course_snapshot(instructor_id: str) -> dict[str, Any]:
    courses = api("/instructors/me/courses", user_id=instructor_id)
    candidates = [
        course
        for course in courses
        if course["active_revision_id"] and course["concept_count"] > 0
    ]
    if not candidates:
        return {
            "portfolio": {"course_count": len(courses)},
            "selected_course": None,
            "blueprint": None,
            "trace": None,
        }
    selected = max(
        candidates,
        key=lambda course: (
            course["concept_count"],
            course["topic_count"],
            course["updated_at"],
        ),
    )
    blueprint = api(
        f"/courses/{selected['id']}/blueprint?revision=active",
        user_id=instructor_id,
    )
    trace = api(
        f"/courses/{selected['id']}/decision-trace?revision=active",
        user_id=instructor_id,
    )
    kinds: dict[str, int] = {}
    statuses: dict[str, int] = {}
    for node in blueprint["nodes"]:
        kinds[node["kind"]] = kinds.get(node["kind"], 0) + 1
        statuses[node["status"]] = statuses.get(node["status"], 0) + 1
    edge_kinds: dict[str, int] = {}
    for edge in blueprint["edges"]:
        edge_kinds[edge["kind"]] = edge_kinds.get(edge["kind"], 0) + 1
    return {
        "portfolio": {
            "course_count": len(courses),
            "published_course_count": sum(
                course["status"] == "published" for course in courses
            ),
            "untitled_course_count": sum(
                course["title"].strip().lower() == "untitled course" for course in courses
            ),
        },
        "selected_course": selected,
        "blueprint": {
            "node_count": len(blueprint["nodes"]),
            "edge_count": len(blueprint["edges"]),
            "node_kinds": kinds,
            "node_statuses": statuses,
            "edge_kinds": edge_kinds,
            "coverage_gap_count": len(blueprint["uncovered_concept_ids"]),
        },
        "trace": {
            "concept_title": trace["concept_title"],
            "complete": trace["complete"],
            "available_stages": sum(
                stage["status"] == "available" for stage in trace["stages"]
            ),
            "total_stages": len(trace["stages"]),
            "stages": trace["stages"],
        },
    }


def clone_transcript_source(course_id: str) -> tuple[str, str]:
    if not re.fullmatch(r"[0-9a-f-]{36}", course_id):
        raise ValueError("Invalid disposable course id.")
    sql = f"""
    with source as (
      select *
      from videos
      where transcript is not null
      order by
        (coalesce(source_metadata ->> 'filename', '') ilike '%test_video%') desc,
        created_at
      limit 1
    ), cloned_video as (
      insert into videos (
        course_id, source_kind, source_uri, playback_provider, playback_id,
        duration_seconds, transcript, source_metadata
      )
      select
        '{course_id}'::uuid, source_kind, source_uri, playback_provider, playback_id,
        duration_seconds, transcript,
        source_metadata || '{{"evaluation_clone": true}}'::jsonb
      from source
      returning id, source_uri
    ), cloned_job as (
      insert into ingestion_jobs (
        video_id, course_id, source_kind, source_uri, status, progress, completed_at
      )
      select id, '{course_id}'::uuid, 'upload', source_uri, 'complete', 100, now()
      from cloned_video
      returning id, video_id
    )
    select video_id, id from cloned_job;
    """
    result = psql(sql)
    if not result or "|" not in result:
        raise RuntimeError("No transcript-backed local source was available to clone.")
    video_id, job_id = result.split("|", maxsplit=1)
    return video_id, job_id


def calculate_cost(ai_calls: list[dict[str, Any]]) -> dict[str, Any]:
    total = 0.0
    priced_calls = 0
    unpriced_calls: list[str] = []
    for call in ai_calls:
        prices = OPENAI_PRICES_PER_MILLION.get(str(call.get("model")))
        if not prices:
            unpriced_calls.append(str(call.get("model") or "unknown"))
            continue
        input_tokens = int(call.get("input_tokens", 0))
        cached = min(input_tokens, int(call.get("cached_input_tokens", 0)))
        output_tokens = int(call.get("output_tokens", 0))
        total += (
            (input_tokens - cached) * prices["input"]
            + cached * prices["cached_input"]
            + output_tokens * prices["output"]
        ) / 1_000_000
        priced_calls += 1
    return {
        "estimated_openai_usd": round(total, 6),
        "priced_call_count": priced_calls,
        "unpriced_models": sorted(set(unpriced_calls)),
        "pricing_basis": (
            "Actual provider-returned tokens multiplied by OpenAI GPT-5.4 standard "
            "pricing accessed 2026-07-28."
        ),
        "pricing_source": "https://developers.openai.com/api/docs/models/gpt-5.4",
    }


def run_generation_benchmark(
    instructor_id: str,
    timeout: int,
) -> dict[str, Any]:
    course = api(
        "/courses",
        method="POST",
        user_id=instructor_id,
        payload={
            "title": "LaunchPad disposable evaluation",
            "description": "Automatically removed after the measured generation run.",
            "brief": {"purpose": "launchpad_evaluation", "disposable": True},
        },
    )
    course_id = str(course["id"])
    started = time.perf_counter()
    try:
        video_id, ingestion_job_id = clone_transcript_source(course_id)
        run = api(
            f"/courses/{course_id}/generation-runs",
            method="POST",
            user_id=instructor_id,
            payload={
                "video_id": video_id,
                "ingestion_job_id": ingestion_job_id,
            },
        )
        deadline = time.monotonic() + timeout
        while run["status"] not in TERMINAL_RUN_STATES:
            if time.monotonic() >= deadline:
                raise TimeoutError(f"Generation exceeded {timeout} seconds.")
            time.sleep(2)
            run = api(
                f"/courses/{course_id}/generation-runs/{run['id']}",
                user_id=instructor_id,
            )
        blueprint = api(
            f"/courses/{course_id}/blueprint?revision=working",
            user_id=instructor_id,
        )
        def measurements(task: dict[str, Any]) -> list[dict[str, Any]]:
            output = task.get("output") or {}
            attempts = output.get("measurement_attempts")
            if isinstance(attempts, list):
                return attempts
            measurement = output.get("measurement")
            return [measurement] if isinstance(measurement, dict) else []

        ai_calls = [
            call
            for task in run["tasks"]
            for measurement in measurements(task)
            for call in measurement.get("ai_calls", [])
        ]
        task_metrics = [
            {
                "task_type": task["task_type"],
                "status": task["status"],
                "attempts": task["attempts"],
                "wall_time_ms": sum(
                    float(measurement.get("wall_time_ms", 0))
                    for measurement in measurements(task)
                ),
                "ai_calls": [
                    call
                    for measurement in measurements(task)
                    for call in measurement.get("ai_calls", [])
                ],
                "measurement_attempts": measurements(task),
            }
            for task in run["tasks"]
        ]
        kinds: dict[str, int] = {}
        for node in blueprint["nodes"]:
            kinds[node["kind"]] = kinds.get(node["kind"], 0) + 1
        return {
            "status": run["status"],
            "error_summary": run["error_summary"],
            "wall_time_seconds": round(time.perf_counter() - started, 3),
            "task_metrics": task_metrics,
            "ai_call_count": len(ai_calls),
            "input_tokens": sum(int(call.get("input_tokens", 0)) for call in ai_calls),
            "cached_input_tokens": sum(
                int(call.get("cached_input_tokens", 0)) for call in ai_calls
            ),
            "output_tokens": sum(int(call.get("output_tokens", 0)) for call in ai_calls),
            "artifact_counts": kinds,
            "coverage_gap_count": len(blueprint["uncovered_concept_ids"]),
            "cost": calculate_cost(ai_calls),
            "cleanup": "pending",
        }
    finally:
        api(f"/courses/{course_id}", method="DELETE", user_id=instructor_id)


def quality_gates(
    commands: list[dict[str, Any]],
    endpoints: dict[str, dict[str, Any]],
    snapshot: dict[str, Any],
    generation: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    blueprint = snapshot.get("blueprint") or {}
    trace = snapshot.get("trace") or {}
    gates = [
        {
            "gate": "Automated verification",
            "passed": all(command["passed"] for command in commands),
            "evidence": (
                f"{sum(command.get('test_count') or 0 for command in commands)} "
                "automated tests reported."
            ),
        },
        {
            "gate": "Application availability",
            "passed": "pipeline_health" in endpoints and "web_health" in endpoints,
            "evidence": "Pipeline and web health endpoints responded during the run.",
        },
        {
            "gate": "Warm API latency",
            "passed": all(metric["p95_ms"] < 250 for metric in endpoints.values()),
            "evidence": "All measured warm endpoint p95 values are below 250 ms.",
        },
        {
            "gate": "Adaptive course structure",
            "passed": (
                blueprint.get("node_kinds", {}).get("concept", 0) >= 4
                and blueprint.get("edge_kinds", {}).get("requires", 0) >= 1
                and blueprint.get("node_kinds", {}).get("clip", 0) >= 1
                and blueprint.get("node_kinds", {}).get("question", 0) >= 1
            ),
            "evidence": "Requires ≥4 concepts, one prerequisite, one clip, and one question.",
        },
        {
            "gate": "Decision lineage visibility",
            "passed": trace.get("available_stages", 0) >= 4,
            "evidence": (
                f"{trace.get('available_stages', 0)}/{trace.get('total_stages', 8)} "
                "trace stages currently have persisted evidence."
            ),
        },
    ]
    if generation is not None:
        gates.append(
            {
                "gate": "Measured AI generation",
                "passed": generation["status"] in {"waiting_review", "complete"},
                "evidence": (
                    f"{generation['ai_call_count']} provider calls captured with "
                    f"{generation['input_tokens'] + generation['output_tokens']} total tokens."
                ),
            }
        )
    return gates


def markdown_report(data: dict[str, Any]) -> str:
    commands = data["commands"]
    endpoints = data["endpoint_latency"]
    snapshot = data["current_course"]
    generation = data["generation"]
    gates = data["quality_gates"]
    selected = snapshot.get("selected_course") or {}
    blueprint = snapshot.get("blueprint") or {}
    trace = snapshot.get("trace") or {}
    lines = [
        "# LaunchPad competition evidence",
        "",
        f"Measured at **{data['measured_at']}** on git commit `{data['git_commit']}`.",
        "",
        "> This file is generated by `python scripts/launchpad_evaluation.py`. "
        "Measured values, calculated costs, vendor claims, and unmeasured gaps are kept separate.",
        "",
        "## Reproducible verification",
        "",
        "| Check | Result | Duration | Tests reported |",
        "|---|---:|---:|---:|",
    ]
    for command in commands:
        lines.append(
            f"| {command['name']} | {'Pass' if command['passed'] else 'Fail'} | "
            f"{command['duration_seconds']:.2f}s | {command['test_count'] or '—'} |"
        )
    lines.extend(
        [
            "",
            "## Warm application latency",
            "",
            "Measurements include localhost HTTP transport and use three warm-ups before "
            f"{data['trials']} recorded requests.",
            "",
            "| Endpoint | p50 | p95 | Min–max |",
            "|---|---:|---:|---:|",
        ]
    )
    for name, metric in endpoints.items():
        lines.append(
            f"| {name.replace('_', ' ').title()} | {metric['p50_ms']:.2f}ms | "
            f"{metric['p95_ms']:.2f}ms | {metric['min_ms']:.2f}–{metric['max_ms']:.2f}ms |"
        )
    lines.extend(
        [
            "",
            "## Current course evidence",
            "",
            f"- Selected course: **{selected.get('title', 'No eligible published course')}**.",
            f"- Blueprint: **{blueprint.get('node_count', 0)} nodes**, "
            f"**{blueprint.get('edge_count', 0)} edges**, "
            f"**{blueprint.get('coverage_gap_count', 0)} uncovered concepts**.",
            f"- Trace: **{trace.get('available_stages', 0)}/{trace.get('total_stages', 8)} "
            f"persisted stages** for {trace.get('concept_title', 'no selected concept')}.",
            "- Portfolio hygiene signal: "
            f"**{snapshot.get('portfolio', {}).get('untitled_course_count', 0)} "
            "instructor-owned course(s) named “Untitled course.”**",
            "",
        ]
    )
    if generation:
        cost = generation["cost"]
        lines.extend(
            [
                "## Measured course-generation run",
                "",
                "The harness created a disposable course, cloned an existing local "
                "transcript-backed source, ran the real configured AI pipeline, collected the "
                "result, and deleted the disposable course.",
                "",
                f"- Terminal state: **{generation['status']}**.",
                f"- Wall time: **{generation['wall_time_seconds']:.2f}s**.",
                f"- Provider calls: **{generation['ai_call_count']}**.",
                f"- Tokens: **{generation['input_tokens']:,} input**, "
                f"**{generation['cached_input_tokens']:,} cached input**, "
                f"**{generation['output_tokens']:,} output**.",
                f"- Calculated model cost: **${cost['estimated_openai_usd']:.4f} USD** "
                "(token cost only; local compute and labor excluded).",
                "- Generated artifacts: "
                f"`{json.dumps(generation['artifact_counts'], sort_keys=True)}`.",
                "",
                "| Durable task | State | Attempts | Wall time | AI calls |",
                "|---|---:|---:|---:|---:|",
            ]
        )
        for task in generation["task_metrics"]:
            wall = (
                f"{task['wall_time_ms'] / 1000:.2f}s"
                if task["wall_time_ms"] is not None
                else "—"
            )
            lines.append(
                f"| {task['task_type']} | {task['status']} | {task['attempts']} | "
                f"{wall} | {len(task['ai_calls'])} |"
            )
        lines.append("")
    else:
        lines.extend(
            [
                "## Measured course-generation run",
                "",
                "Not run in this invocation. Use `--run-generation` to execute one disposable "
                "real-provider generation and calculate token cost.",
                "",
            ]
        )
    lines.extend(
        [
            "## Competition quality gates",
            "",
            "| Gate | Result | Evidence |",
            "|---|---:|---|",
        ]
    )
    for gate in gates:
        lines.append(
            f"| {gate['gate']} | {'Pass' if gate['passed'] else 'Needs work'} | "
            f"{gate['evidence']} |"
        )
    lines.extend(
        [
            "",
            "## Competitor and traditional-method context",
            "",
            "This is a capability comparison, not a fabricated speed benchmark. Vendor "
            "claims are not treated as independent measurements. ATD explicitly warns that "
            "course-development time varies with content, interactivity, media, tools, "
            "expertise, and review cycles.",
            "",
            "| Baseline | Verified capability | Defensible comparison | Commercial context |",
            "|---|---|---|---|",
        ]
    )
    for baseline in BASELINES:
        source = baseline["source"]
        lines.append(
            f"| [{baseline['method']}]({source}) | {baseline['verified_capability']} | "
            f"{baseline['difference']} | {baseline['commercial_context']} |"
        )
    lines.extend(
        [
            "",
            "## Measurement limits",
            "",
            "- Wall time is measured; active instructor review time is not yet captured. "
            "A timed human review session is required before claiming the under-60-minute target.",
            "- Model cost uses provider-returned token counts and the current official GPT-5.4 "
            "[price](https://developers.openai.com/api/docs/models/gpt-5.4). It excludes labor, "
            "hosting, storage, video delivery, and unpriced models.",
            "- A matched manual build in H5P or a conventional authoring tool has not yet been "
            "run on the same source. No universal traditional-development ratio is substituted.",
            "- The current dataset is not a real cohort. Seeded learner history must be labelled "
            "as demonstration evidence; outcome claims require real learners.",
            "",
        ]
    )
    return "\n".join(lines)


def main() -> int:
    args = parse_args()
    if args.render_existing:
        render_existing_report(args.json, args.markdown)
        print(f"Re-rendered {args.json.relative_to(ROOT)}")
        print(f"Re-rendered {args.markdown.relative_to(ROOT)}")
        return 0
    if args.trials < 5:
        raise ValueError("--trials must be at least 5.")
    commands: list[dict[str, Any]] = []
    if not args.skip_tests:
        commands.extend(
            [
                run_command("Web/shared tests", ["npm", "test"]),
                run_command(
                    "Pipeline tests",
                    ["uv", "run", "pytest", "-q"],
                    cwd=ROOT / "pipeline",
                    timeout=1800,
                ),
                run_command("Lint", ["npm", "run", "lint"]),
                run_command("Typecheck", ["npm", "run", "typecheck"]),
            ]
        )
    stack_command = ["docker", "compose", "up", "-d"]
    if not args.no_build:
        stack_command.insert(3, "--build")
    stack = run_command("Application build/start", stack_command, timeout=1800)
    commands.append(stack)
    if not stack["passed"]:
        raise RuntimeError(stack["output_tail"])
    wait_for_stack()

    instructor_id = choose_instructor()
    snapshot = current_course_snapshot(instructor_id)
    endpoints = {
        "pipeline_health": request_latency(
            f"{PIPELINE_URL}/health",
            trials=args.trials,
        ),
        "web_health": request_latency(
            f"{WEB_URL}/api/health",
            trials=args.trials,
        ),
        "teacher_dashboard": request_latency(
            f"{PIPELINE_URL}/instructors/me/dashboard",
            trials=args.trials,
            user_id=instructor_id,
        ),
    }
    selected = snapshot.get("selected_course")
    if selected:
        endpoints["active_blueprint"] = request_latency(
            f"{PIPELINE_URL}/courses/{selected['id']}/blueprint?revision=active",
            trials=args.trials,
            user_id=instructor_id,
        )
        endpoints["decision_trace"] = request_latency(
            f"{PIPELINE_URL}/courses/{selected['id']}/decision-trace?revision=active",
            trials=args.trials,
            user_id=instructor_id,
        )

    generation = (
        run_generation_benchmark(instructor_id, args.generation_timeout)
        if args.run_generation
        else None
    )
    if generation is not None:
        generation["cleanup"] = "disposable course deleted"
    data = {
        "schema_version": 1,
        "measured_at": datetime.now(UTC).isoformat(),
        "git_commit": current_git_commit(),
        "trials": args.trials,
        "commands": commands,
        "endpoint_latency": endpoints,
        "current_course": snapshot,
        "generation": generation,
        "quality_gates": quality_gates(commands, endpoints, snapshot, generation),
        "baselines": BASELINES,
    }
    args.json.parent.mkdir(parents=True, exist_ok=True)
    args.markdown.parent.mkdir(parents=True, exist_ok=True)
    args.json.write_text(json.dumps(data, indent=2) + "\n")
    args.markdown.write_text(markdown_report(data))
    print(f"Wrote {args.json.relative_to(ROOT)}")
    print(f"Wrote {args.markdown.relative_to(ROOT)}")
    failed = [item for item in commands if not item["passed"]]
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
