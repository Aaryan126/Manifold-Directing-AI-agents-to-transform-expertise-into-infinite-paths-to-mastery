from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from uuid import UUID

import yaml


@dataclass(frozen=True)
class CompetitionDemoConfig:
    enabled: bool
    course_id: UUID
    baseline_revision_id: UUID
    prepared_revision_id: UUID
    template_video_id: UUID
    prepared_unit_logical_id: UUID
    step_delay_seconds: float = 1.8

    def matches_course(self, course_id: UUID) -> bool:
        return self.enabled and self.course_id == course_id


def load_competition_demo_config(path: str | None) -> CompetitionDemoConfig | None:
    if not path:
        return None
    config_path = Path(path)
    if not config_path.is_file():
        return None
    raw = yaml.safe_load(config_path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict) or not raw.get("enabled", False):
        return None
    business = raw.get("business_101")
    if not isinstance(business, dict):
        raise ValueError("Competition demo config requires a business_101 mapping.")
    return CompetitionDemoConfig(
        enabled=True,
        course_id=UUID(str(business["course_id"])),
        baseline_revision_id=UUID(str(business["baseline_revision_id"])),
        prepared_revision_id=UUID(str(business["prepared_revision_id"])),
        template_video_id=UUID(str(business["template_video_id"])),
        prepared_unit_logical_id=UUID(str(business["prepared_unit_logical_id"])),
        step_delay_seconds=max(0.0, float(business.get("step_delay_seconds", 1.8))),
    )
