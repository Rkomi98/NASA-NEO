from datetime import date
from pathlib import Path

import pytest

from app.core.config import Settings
from app.services.cache_service import CacheService
from app.services.neo_service import NeoService


class StubNasaClient:
    def __init__(self) -> None:
        self.feed_calls = 0
        self.upstream_state = {
            "last_rate_limit_limit": 1000,
            "last_rate_limit_remaining": 999,
            "request_id": "req-1",
        }

    async def fetch_feed(self, *, start_date: str, end_date: str):
        self.feed_calls += 1
        return (
            {
                "near_earth_objects": {
                    start_date: [
                        {
                            "id": "1",
                            "neo_reference_id": "1",
                            "name": "Test NEO",
                            "designation": "2025 AB",
                            "nasa_jpl_url": "https://example.com",
                            "absolute_magnitude_h": 21.2,
                            "is_potentially_hazardous_asteroid": True,
                            "is_sentry_object": False,
                            "estimated_diameter": {
                                "kilometers": {
                                    "estimated_diameter_min": 0.1,
                                    "estimated_diameter_max": 0.2,
                                }
                            },
                            "orbital_data": {"orbit_class": {"type": "APO", "name": "Apollo"}},
                            "close_approach_data": [
                                {
                                    "close_approach_date": start_date,
                                    "epoch_date_close_approach": 1735689600000,
                                    "relative_velocity": {"kilometers_per_second": "12.4"},
                                    "miss_distance": {"kilometers": "12345", "lunar": "0.3"},
                                    "orbiting_body": "Earth",
                                }
                            ],
                        }
                    ]
                }
            },
            dict(self.upstream_state),
        )

    async def fetch_neo(self, neo_id: str):
        return (
            {
                "id": neo_id,
                "neo_reference_id": neo_id,
                "name": "Test NEO",
                "designation": "2025 AB",
                "nasa_jpl_url": "https://example.com",
                "absolute_magnitude_h": 21.2,
                "is_potentially_hazardous_asteroid": True,
                "is_sentry_object": False,
                "estimated_diameter": {},
                "orbital_data": {},
                "close_approach_data": [],
            },
            dict(self.upstream_state),
        )


@pytest.mark.asyncio
async def test_feed_uses_cache(tmp_path: Path) -> None:
    settings = Settings(
        nasa_api_key="test",
        cache_dir=tmp_path,
    )
    cache_service = CacheService(tmp_path)
    nasa = StubNasaClient()
    service = NeoService(settings=settings, cache_service=cache_service, nasa_client=nasa)

    payload_one = await service.get_feed(
        start=date(2025, 1, 1),
        end=date(2025, 1, 1),
        requested_days=1,
    )
    payload_two = await service.get_feed(
        start=date(2025, 1, 1),
        end=date(2025, 1, 1),
        requested_days=1,
    )

    assert payload_one["stats"]["total"] == 1
    assert payload_two["stats"]["total"] == 1
    assert nasa.feed_calls == 1


def test_settings_parse_allowed_origins_from_csv_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(
        "ALLOWED_ORIGINS",
        "https://nasa-neo-frontend.vercel.app,https://nasa-neo-preview.vercel.app",
    )

    settings = Settings(nasa_api_key="test")

    assert settings.allowed_origins == [
        "https://nasa-neo-frontend.vercel.app",
        "https://nasa-neo-preview.vercel.app",
    ]
