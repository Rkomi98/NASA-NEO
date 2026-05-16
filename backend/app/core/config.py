from functools import lru_cache
from pathlib import Path
from typing import List

from pydantic import BaseSettings, Field, validator


DEFAULT_ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
]


class Settings(BaseSettings):
    app_name: str = "Arkemis NEO Backend"
    debug: bool = False
    nasa_api_key: str = Field(..., env="NASA_API_KEY")
    nasa_base_url: str = "https://api.nasa.gov/neo/rest/v1"
    allowed_origins: List[str] = Field(
        default_factory=lambda: DEFAULT_ALLOWED_ORIGINS.copy(),
        env="ALLOWED_ORIGINS",
    )
    allowed_origin_regex: str = Field(
        r"^https?://(localhost|127\.0\.0\.1):[0-9]+$",
        env="ALLOWED_ORIGIN_REGEX",
    )
    feed_ttl_seconds: int = Field(60 * 60 * 12, gt=0)
    neo_ttl_seconds: int = Field(60 * 60 * 72, gt=0)
    max_days: int = Field(365, gt=0)
    chunk_days: int = Field(7, ge=1, le=7)
    upstream_timeout_seconds: float = Field(20.0, gt=0)
    upstream_concurrency: int = Field(2, ge=1)
    enable_admin_endpoints: bool = Field(False, env="ENABLE_ADMIN_ENDPOINTS")
    cache_dir: Path = Path(__file__).resolve().parents[2] / "cache"

    class Config:
        env_file = Path(__file__).resolve().parents[3] / ".env"
        env_file_encoding = "utf-8"
        case_sensitive = False

        @classmethod
        def parse_env_var(cls, field_name: str, raw_val: str) -> object:
            if field_name == "allowed_origins":
                return raw_val
            return cls.json_loads(raw_val)

    @validator("allowed_origins", pre=True)
    def parse_allowed_origins(cls, value: object) -> List[str]:
        if value is None or value == "":
            return DEFAULT_ALLOWED_ORIGINS.copy()
        if isinstance(value, list):
            return [str(item).strip() for item in value if str(item).strip()]
        if isinstance(value, str):
            stripped = value.strip()
            if stripped.startswith("["):
                import json

                parsed = json.loads(stripped)
                if not isinstance(parsed, list):
                    raise ValueError("ALLOWED_ORIGINS JSON must be a list")
                return [str(item).strip() for item in parsed if str(item).strip()]
            return [item.strip() for item in stripped.split(",") if item.strip()]
        raise ValueError("ALLOWED_ORIGINS must be a comma-separated string or list")


@lru_cache()
def get_settings() -> Settings:
    return Settings()
