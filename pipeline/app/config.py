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
    video_provider: str = "local"
    local_video_storage_path: str = "/data/video"
    direct_url_download_timeout_seconds: float = 30.0
    openai_api_key: str | None = Field(default=None)
    mux_token_id: str | None = Field(default=None)
    mux_token_secret: str | None = Field(default=None)
    mux_max_stored_videos: int = 10
    mux_poll_interval_seconds: float = 2.0
    mux_poll_timeout_seconds: float = 600.0


@lru_cache
def get_settings() -> Settings:
    return Settings()
