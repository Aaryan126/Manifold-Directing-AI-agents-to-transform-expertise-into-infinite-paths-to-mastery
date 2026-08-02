from collections.abc import Callable

import pytest

from app.config import Settings
from app.course_os.course_director import AgnesCourseDirector
from app.course_os.dashboard_assistant import AgnesDashboardAssistant
from app.dependencies import (
    _build_course_director,
    _build_dashboard_assistant,
    _build_learning_guide,
)
from app.learning.guide import AgnesLearningGuideInterpreter


def _agnes_settings(**overrides: object) -> Settings:
    values: dict[str, object] = {
        "agnes_api_key": "test-agnes-key",
        "course_director_provider": "agnes",
        "dashboard_assistant_provider": "agnes",
        "learning_guide_provider": "agnes",
    }
    values.update(overrides)
    return Settings(**values)


def test_selected_interactive_agents_use_agnes() -> None:
    settings = _agnes_settings()

    assert isinstance(_build_course_director(settings), AgnesCourseDirector)
    assert isinstance(_build_dashboard_assistant(settings), AgnesDashboardAssistant)
    assert isinstance(_build_learning_guide(settings), AgnesLearningGuideInterpreter)


@pytest.mark.parametrize(
    ("field", "builder", "message"),
    (
        (
            "course_director_provider",
            _build_course_director,
            "COURSE_DIRECTOR_PROVIDER=agnes",
        ),
        (
            "dashboard_assistant_provider",
            _build_dashboard_assistant,
            "DASHBOARD_ASSISTANT_PROVIDER=agnes",
        ),
        (
            "learning_guide_provider",
            _build_learning_guide,
            "LEARNING_GUIDE_PROVIDER=agnes",
        ),
    ),
)
def test_agnes_provider_requires_key(
    field: str,
    builder: Callable[[Settings], object],
    message: str,
) -> None:
    settings = Settings(**{field: "agnes", "agnes_api_key": None})

    with pytest.raises(ValueError, match=message):
        builder(settings)


def test_unknown_interactive_provider_is_rejected() -> None:
    settings = Settings(course_director_provider="unknown")

    with pytest.raises(ValueError, match="Unsupported COURSE_DIRECTOR_PROVIDER"):
        _build_course_director(settings)
