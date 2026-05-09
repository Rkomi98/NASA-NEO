from fastapi import APIRouter, Depends

from app.dependencies import get_cache_service
from app.models.schemas import CacheInvalidateRequest, CacheInvalidateResponse
from app.services.cache_service import CacheService


router = APIRouter(tags=["cache"])


@router.post("/api/cache/invalidate", response_model=CacheInvalidateResponse)
async def invalidate_cache(
    payload: CacheInvalidateRequest,
    cache_service: CacheService = Depends(get_cache_service),
) -> CacheInvalidateResponse:
    deleted = cache_service.invalidate(
        scope=payload.scope,
        start_date=payload.start_date,
        end_date=payload.end_date,
        neo_id=payload.neo_id,
    )
    return CacheInvalidateResponse(deleted=deleted, scope=payload.scope)
