import asyncio
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Tuple

from app.core.config import Settings
from app.models.schemas import RateLimitState
from app.services.cache_service import CacheService
from app.services.nasa_client import NasaNeoClient
from app.utils.dates import chunk_date_range, date_in_range


class NeoService:
    def __init__(
        self,
        *,
        settings: Settings,
        cache_service: CacheService,
        nasa_client: NasaNeoClient,
    ) -> None:
        self.settings = settings
        self.cache_service = cache_service
        self.nasa_client = nasa_client

    async def get_feed(self, *, start: date, end: date, requested_days: int) -> Dict[str, Any]:
        chunks = chunk_date_range(start, end, self.settings.chunk_days)
        semaphore = asyncio.Semaphore(self.settings.upstream_concurrency)
        chunk_results = await asyncio.gather(
            *[
                self._fetch_chunk(chunk_start, chunk_end, semaphore)
                for chunk_start, chunk_end in chunks
            ]
        )

        flattened: List[Dict[str, Any]] = []
        cache_hits = 0
        for payload, cache_hit in chunk_results:
            cache_hits += 1 if cache_hit else 0
            flattened.extend(self._flatten_chunk(payload, start, end))

        flattened.sort(key=lambda item: item["close_approach"]["epoch_date_close_approach"])
        stats = self._build_stats(flattened)
        upstream = self.nasa_client.upstream_state

        return {
            "meta": {
                "start_date": start.isoformat(),
                "end_date": end.isoformat(),
                "requested_days": requested_days,
                "chunk_count": len(chunks),
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "cache": {
                    "hits": cache_hits,
                    "misses": len(chunks) - cache_hits,
                },
                "last_upstream_rate_limit": RateLimitState(
                    limit=upstream.get("last_rate_limit_limit"),
                    remaining=upstream.get("last_rate_limit_remaining"),
                    request_id=upstream.get("request_id"),
                ).dict(),
            },
            "stats": stats,
            "near_earth_objects": flattened,
        }

    async def _fetch_chunk(
        self,
        start: date,
        end: date,
        semaphore: asyncio.Semaphore,
    ) -> Tuple[Dict[str, Any], bool]:
        key = f"{start.isoformat()}_{end.isoformat()}"

        async def factory() -> Dict[str, Any]:
            async with semaphore:
                return await self.nasa_client.fetch_feed(
                    start_date=start.isoformat(),
                    end_date=end.isoformat(),
                )

        return await self.cache_service.get_or_set(
            namespace="feed",
            key=key,
            ttl_seconds=self.settings.feed_ttl_seconds,
            factory=factory,
        )

    async def get_neo_detail(self, neo_id: str) -> Dict[str, Any]:
        async def factory() -> Dict[str, Any]:
            return await self.nasa_client.fetch_neo(neo_id)

        payload, _ = await self.cache_service.get_or_set(
            namespace="neo",
            key=neo_id,
            ttl_seconds=self.settings.neo_ttl_seconds,
            factory=factory,
        )
        return {
            "id": payload["id"],
            "neo_reference_id": payload["neo_reference_id"],
            "name": payload["name"],
            "designation": payload.get("designation"),
            "nasa_jpl_url": payload["nasa_jpl_url"],
            "absolute_magnitude_h": payload.get("absolute_magnitude_h"),
            "is_potentially_hazardous_asteroid": payload["is_potentially_hazardous_asteroid"],
            "is_sentry_object": payload.get("is_sentry_object", False),
            "estimated_diameter": payload["estimated_diameter"],
            "orbital_data": payload.get("orbital_data", {}),
            "close_approach_data": payload.get("close_approach_data", []),
        }

    def _flatten_chunk(self, payload: Dict[str, Any], start: date, end: date) -> List[Dict[str, Any]]:
        items: List[Dict[str, Any]] = []
        near_objects = payload.get("near_earth_objects", {})
        for bucket_date, asteroids in near_objects.items():
            if not date_in_range(bucket_date, start, end):
                continue
            for asteroid in asteroids:
                approach = self._select_approach(asteroid, bucket_date)
                if approach is None:
                    continue
                items.append(
                    {
                        "event_id": f"{asteroid['id']}:{approach['epoch_date_close_approach']}",
                        "id": asteroid["id"],
                        "neo_reference_id": asteroid["neo_reference_id"],
                        "name": asteroid["name"],
                        "designation": asteroid.get("designation"),
                        "nasa_jpl_url": asteroid["nasa_jpl_url"],
                        "absolute_magnitude_h": asteroid.get("absolute_magnitude_h"),
                        "is_potentially_hazardous_asteroid": asteroid["is_potentially_hazardous_asteroid"],
                        "is_sentry_object": asteroid.get("is_sentry_object", False),
                        "estimated_diameter": asteroid["estimated_diameter"],
                        "orbital_data": self._compact_orbital_data(asteroid.get("orbital_data", {})),
                        "close_approach": approach,
                    }
                )
        return items

    def _select_approach(self, asteroid: Dict[str, Any], bucket_date: str) -> Dict[str, Any]:
        for entry in asteroid.get("close_approach_data", []):
            if entry.get("close_approach_date") == bucket_date:
                return entry
        approaches = asteroid.get("close_approach_data", [])
        return approaches[0] if approaches else None

    def _compact_orbital_data(self, orbital_data: Dict[str, Any]) -> Dict[str, Any]:
        keys = [
            "orbit_class",
            "semi_major_axis",
            "eccentricity",
            "inclination",
            "orbital_period",
            "first_observation_date",
            "last_observation_date",
            "observations_used",
            "minimum_orbit_intersection",
            "perihelion_distance",
            "aphelion_distance",
        ]
        return {key: orbital_data[key] for key in keys if key in orbital_data}

    def _build_stats(self, items: List[Dict[str, Any]]) -> Dict[str, Any]:
        if not items:
            return {
                "total": 0,
                "hazardous": 0,
                "non_hazardous": 0,
                "closest_miss_km": None,
                "largest_diameter_km": None,
                "fastest_kps": None,
            }
        hazardous = sum(1 for item in items if item["is_potentially_hazardous_asteroid"])
        distances = [float(item["close_approach"]["miss_distance"]["kilometers"]) for item in items]
        diameters = [
            float(item["estimated_diameter"]["kilometers"]["estimated_diameter_max"])
            for item in items
        ]
        velocities = [
            float(item["close_approach"]["relative_velocity"]["kilometers_per_second"])
            for item in items
        ]
        return {
            "total": len(items),
            "hazardous": hazardous,
            "non_hazardous": len(items) - hazardous,
            "closest_miss_km": min(distances),
            "largest_diameter_km": max(diameters),
            "fastest_kps": max(velocities),
        }
