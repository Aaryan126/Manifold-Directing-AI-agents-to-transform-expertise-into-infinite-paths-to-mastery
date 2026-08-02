from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql://coursefoundry:coursefoundry@localhost:5432/coursefoundry"
    asr_provider: str = "openai"
    segmentation_provider: str = "openai"
    graph_agent_provider: str = "openai"
    clip_agent_provider: str = "openai"
    assessment_agent_provider: str = "openai"
    llm_model: str = "gpt-5.4"
    course_director_provider: str = "openai"
    dashboard_assistant_provider: str = "openai"
    learning_guide_provider: str = "openai"
    agnes_api_key: str | None = Field(default=None)
    agnes_base_url: str = "https://apihub.agnes-ai.com/v1"
    agnes_agent_model: str = "agnes-2.5-flash"
    agnes_fast_model: str = "agnes-2.5-flash"
    agnes_fallback_to_openai: bool = True
    video_provider: str = "local"
    force_local_video_delivery: bool = False
    local_video_storage_path: str = "/data/video"
    local_clip_ffmpeg_timeout_seconds: float = 1800.0
    direct_url_download_timeout_seconds: float = 30.0
    openai_api_key: str | None = Field(default=None)
    mux_token_id: str | None = Field(default=None)
    mux_token_secret: str | None = Field(default=None)
    mux_max_stored_videos: int = 10
    mux_poll_interval_seconds: float = 2.0
    mux_poll_timeout_seconds: float = 600.0
    demo_video_path: str = "../test_video.mp4"
    demo_transcript_path: str = "demo/transcript.json"
    competition_demo_config_path: str | None = None
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    generation_worker_enabled: bool = True
    generation_worker_poll_seconds: float = 1.0
    generation_worker_lease_seconds: int = 900
    intelligence_worker_enabled: bool = True
    intelligence_worker_poll_seconds: float = 1.0
    intelligence_worker_lease_seconds: int = 900
    document_max_bytes: int = 50_000_000
    document_max_pages: int = 200


@lru_cache
def get_settings() -> Settings:
    return Settings()
