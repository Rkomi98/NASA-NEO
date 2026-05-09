from functools import lru_cache
from pathlib import Path
from typing import List

from pydantic import BaseSettings, Field


class Settings(BaseSettings):
    app_name: str = "Arkemis NEO Backend"
    debug: bool = False
    nasa_api_key: str = Field(..., env="NASA_API_KEY")
    nasa_base_url: str = "https://api.nasa.gov/neo/rest/v1"
    allowed_origins: List[str] = Field(
        default_factory=lambda: [
            "http://localhost:3000",
            "http://127.0.0.1:3000",
        ]
    )
    feed_ttl_seconds: int = 60 * 60 * 12
    neo_ttl_seconds: int = 60 * 60 * 72
    max_days: int = 365
    chunk_days: int = 7
    upstream_timeout_seconds: float = 20.0
    upstream_concurrency: int = 2
    cache_dir: Path = Path(__file__).resolve().parents[2] / "cache"

    class Config:
        env_file = Path(__file__).resolve().parents[3] / ".env"
        env_file_encoding = "utf-8"
        case_sensitive = False


@lru_cache()
def get_settings() -> Settings:
    return Settings()
