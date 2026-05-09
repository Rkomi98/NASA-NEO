from fastapi import APIRouter, Depends

from app.dependencies import get_cache_service, get_nasa_client
from app.models.schemas import HealthResponse
from app.services.cache_service import CacheService
from app.services.nasa_client import NasaNeoClient


router = APIRouter(tags=["health"])


@router.get("/api/health", response_model=HealthResponse)
async def get_health(
    cache_service: CacheService = Depends(get_cache_service),
    nasa_client: NasaNeoClient = Depends(get_nasa_client),
) -> HealthResponse:
    cache_stats = cache_service.get_stats()
    upstream = nasa_client.upstream_state
    return HealthResponse(
        status="ok",
        cache=cache_stats,
        upstream={
            "last_status": upstream.get("last_status"),
            "last_rate_limit_limit": upstream.get("last_rate_limit_limit"),
            "last_rate_limit_remaining": upstream.get("last_rate_limit_remaining"),
            "last_request_at": upstream.get("last_request_at"),
        },
    )
