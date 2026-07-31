#!/usr/bin/env python3
"""Restore the YAML-configured Business 101 recording rehearsal.

Without --apply this is a read-only status check. With --apply it restores the
one-lecture published baseline and the cached two-lecture private revision.
It never changes another course.
"""

from __future__ import annotations

import argparse
import subprocess
from pathlib import Path
from uuid import UUID

import yaml


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--config",
        default="competition-demo.yaml",
        help="Competition demo YAML path.",
    )
    parser.add_argument("--apply", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = arguments()
    raw = yaml.safe_load(Path(args.config).read_text(encoding="utf-8"))
    demo = raw["business_101"]
    values = {
        key: str(UUID(str(demo[key])))
        for key in (
            "course_id",
            "baseline_revision_id",
            "prepared_revision_id",
            "template_video_id",
            "prepared_unit_logical_id",
        )
    }
    status = psql(
        "select concat_ws('|', c.title, c.active_revision_id, "
        "coalesce(c.working_revision_id::text, ''), "
        "(select count(*) from course_units where revision_id = "
        f"'{values['prepared_revision_id']}'::uuid and review_status <> 'dismissed')) "
        f"from courses c where c.id = '{values['course_id']}'::uuid"
    )
    if not status or not status.startswith("Business 101|"):
        raise RuntimeError("The configured Business 101 course was not found.")
    print(f"Business 101: {status}")
    if not args.apply:
        print("Read-only check complete. Re-run with --apply to reset.")
        return 0
    sql = f"""
    do $$
    declare current_video uuid;
    begin
      select video_id into current_video from course_units
      where revision_id = '{values["prepared_revision_id"]}'::uuid
        and logical_id = '{values["prepared_unit_logical_id"]}'::uuid
      for update;
      if current_video is null then
        raise exception 'The cached demo lecture unit is missing.';
      end if;
      update topics set video_id = '{values["template_video_id"]}'::uuid,
        updated_at = now()
      where revision_id = '{values["prepared_revision_id"]}'::uuid
        and video_id = current_video;
      update course_units set video_id = '{values["template_video_id"]}'::uuid,
        updated_at = now()
      where revision_id = '{values["prepared_revision_id"]}'::uuid
        and logical_id = '{values["prepared_unit_logical_id"]}'::uuid;
      update course_revisions set status = case
        when id = '{values["baseline_revision_id"]}'::uuid
          then 'published'::course_revision_status
        when id = '{values["prepared_revision_id"]}'::uuid
          then 'superseded'::course_revision_status
        else status end, updated_at = now()
      where course_id = '{values["course_id"]}'::uuid
        and id in ('{values["baseline_revision_id"]}'::uuid,
                   '{values["prepared_revision_id"]}'::uuid);
      update courses set
        active_revision_id = '{values["baseline_revision_id"]}'::uuid,
        working_revision_id = null, status = 'published', updated_at = now()
      where id = '{values["course_id"]}'::uuid;
    end $$;
    """
    psql(sql)
    print("Reset complete: Business 101 now opens with its one-lecture baseline.")
    return 0


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


if __name__ == "__main__":
    raise SystemExit(main())
