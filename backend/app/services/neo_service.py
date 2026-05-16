import asyncio
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

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
        snapshots: List[Dict[str, Any]] = []
        for payload, cache_hit, snapshot in chunk_results:
            cache_hits += 1 if cache_hit else 0
            flattened.extend(self._flatten_chunk(payload, start, end))
            if snapshot is not None:
                snapshots.append(snapshot)

        flattened.sort(key=lambda item: item["close_approach"]["epoch_date_close_approach"])
        stats = self._build_stats(flattened)
        worst = self._worst_remaining(snapshots) or self.nasa_client.upstream_state

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
                    limit=worst.get("last_rate_limit_limit"),
                    remaining=worst.get("last_rate_limit_remaining"),
                    request_id=worst.get("request_id"),
                ).dict(),
            },
            "stats": stats,
            "near_earth_objects": flattened,
        }

    @staticmethod
    def _worst_remaining(snapshots: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        if not snapshots:
            return None

        def remaining(snapshot: Dict[str, Any]) -> float:
            value = snapshot.get("last_rate_limit_remaining")
            return float(value) if value is not None else float("inf")

        return min(snapshots, key=remaining)

    async def _fetch_chunk(
        self,
        start: date,
        end: date,
        semaphore: asyncio.Semaphore,
    ) -> Tuple[Dict[str, Any], bool, Optional[Dict[str, Any]]]:
        key = f"{start.isoformat()}_{end.isoformat()}"
        captured: Dict[str, Optional[Dict[str, Any]]] = {"snapshot": None}

        async def factory() -> Dict[str, Any]:
            async with semaphore:
                payload, snapshot = await self.nasa_client.fetch_feed(
                    start_date=start.isoformat(),
                    end_date=end.isoformat(),
                )
                captured["snapshot"] = snapshot
                return payload

        payload, hit = await self.cache_service.get_or_set(
            namespace="feed",
            key=key,
            ttl_seconds=self.settings.feed_ttl_seconds,
            factory=factory,
        )
        return payload, hit, captured["snapshot"]

    async def get_neo_detail(self, neo_id: str) -> Dict[str, Any]:
        async def factory() -> Dict[str, Any]:
            payload, _snapshot = await self.nasa_client.fetch_neo(neo_id)
            return payload

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

    def _select_approach(
        self, asteroid: Dict[str, Any], bucket_date: str
    ) -> Optional[Dict[str, Any]]:
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
            "ascending_node_longitude",
            "perihelion_argument",
            "mean_anomaly",
            "epoch_osculation",
            "equinox",
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
        hazardous = sum(
            1 for item in items if item.get("is_potentially_hazardous_asteroid")
        )
        distances = [
            d for d in (self._extract_distance_km(item) for item in items) if d is not None
        ]
        diameters = [
            d for d in (self._extract_diameter_km(item) for item in items) if d is not None
        ]
        velocities = [
            v for v in (self._extract_velocity_kps(item) for item in items) if v is not None
        ]
        return {
            "total": len(items),
            "hazardous": hazardous,
            "non_hazardous": len(items) - hazardous,
            "closest_miss_km": min(distances) if distances else None,
            "largest_diameter_km": max(diameters) if diameters else None,
            "fastest_kps": max(velocities) if velocities else None,
        }

    @staticmethod
    def _safe_float(value: Any) -> Optional[float]:
        if value is None:
            return None
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    def _extract_distance_km(self, item: Dict[str, Any]) -> Optional[float]:
        approach = item.get("close_approach") or {}
        miss = approach.get("miss_distance") or {}
        return self._safe_float(miss.get("kilometers"))

    def _extract_diameter_km(self, item: Dict[str, Any]) -> Optional[float]:
        diameter = item.get("estimated_diameter") or {}
        km = diameter.get("kilometers") or {}
        return self._safe_float(km.get("estimated_diameter_max"))

    def _extract_velocity_kps(self, item: Dict[str, Any]) -> Optional[float]:
        approach = item.get("close_approach") or {}
        velocity = approach.get("relative_velocity") or {}
        return self._safe_float(velocity.get("kilometers_per_second"))
