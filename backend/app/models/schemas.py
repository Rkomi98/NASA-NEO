from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel


class RateLimitState(BaseModel):
    limit: Optional[int] = None
    remaining: Optional[int] = None
    request_id: Optional[str] = None


class FeedMeta(BaseModel):
    start_date: str
    end_date: str
    requested_days: int
    chunk_count: int
    generated_at: str
    cache: Dict[str, Any]
    last_upstream_rate_limit: RateLimitState


class FeedStats(BaseModel):
    total: int
    hazardous: int
    non_hazardous: int
    closest_miss_km: Optional[float]
    largest_diameter_km: Optional[float]
    fastest_kps: Optional[float]


class FeedEvent(BaseModel):
    event_id: str
    id: str
    neo_reference_id: str
    name: str
    designation: Optional[str] = None
    nasa_jpl_url: str
    absolute_magnitude_h: Optional[float] = None
    is_potentially_hazardous_asteroid: bool
    is_sentry_object: bool = False
    estimated_diameter: Dict[str, Any]
    orbital_data: Dict[str, Any]
    close_approach: Dict[str, Any]


class FeedResponse(BaseModel):
    meta: FeedMeta
    stats: FeedStats
    near_earth_objects: List[FeedEvent]


class NeoDetailResponse(BaseModel):
    id: str
    neo_reference_id: str
    name: str
    designation: Optional[str] = None
    nasa_jpl_url: str
    absolute_magnitude_h: Optional[float] = None
    is_potentially_hazardous_asteroid: bool
    is_sentry_object: bool = False
    estimated_diameter: Dict[str, Any]
    orbital_data: Dict[str, Any]
    close_approach_data: List[Dict[str, Any]]


class CacheStats(BaseModel):
    entries: int
    size_bytes: int
    hit_ratio: float
    expired_entries: int


class UpstreamStats(BaseModel):
    last_status: Optional[int] = None
    last_rate_limit_limit: Optional[int] = None
    last_rate_limit_remaining: Optional[int] = None
    last_request_at: Optional[str] = None


class HealthResponse(BaseModel):
    status: Literal["ok"]
    cache: CacheStats
    upstream: UpstreamStats


class CacheInvalidateRequest(BaseModel):
    scope: Literal["all", "feed", "neo"]
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    neo_id: Optional[str] = None


class CacheInvalidateResponse(BaseModel):
    deleted: int
    scope: str
