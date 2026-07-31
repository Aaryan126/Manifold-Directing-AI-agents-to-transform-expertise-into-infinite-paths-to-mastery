from pathlib import Path

from app.competition_demo import load_competition_demo_config


def test_disabled_competition_demo_uses_real_pipeline(tmp_path: Path) -> None:
    config = tmp_path / "demo.yaml"
    config.write_text("enabled: false\n", encoding="utf-8")
    assert load_competition_demo_config(str(config)) is None


def test_business_101_competition_demo_is_exactly_scoped(tmp_path: Path) -> None:
    config = tmp_path / "demo.yaml"
    config.write_text(
        """
enabled: true
business_101:
  course_id: 11111111-1111-1111-1111-111111111111
  baseline_revision_id: 22222222-2222-2222-2222-222222222222
  prepared_revision_id: 33333333-3333-3333-3333-333333333333
  template_video_id: 44444444-4444-4444-4444-444444444444
  prepared_unit_logical_id: 55555555-5555-5555-5555-555555555555
  step_delay_seconds: 2.25
""",
        encoding="utf-8",
    )
    loaded = load_competition_demo_config(str(config))
    assert loaded is not None
    assert loaded.matches_course(loaded.course_id)
    assert loaded.step_delay_seconds == 2.25
