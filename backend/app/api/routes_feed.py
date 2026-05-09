from fastapi import APIRouter, Depends, Query

from app.core.config import Settings, get_settings
from app.dependencies import get_neo_service
from app.models.schemas import FeedResponse
from app.services.neo_service import NeoService
from app.utils.dates import parse_iso_date, validate_range


router = APIRouter(tags=["feed"])


@router.get("/api/feed", response_model=FeedResponse)
async def get_feed(
    start_date: str = Query(..., description="YYYY-MM-DD"),
    end_date: str = Query(..., description="YYYY-MM-DD"),
    settings: Settings = Depends(get_settings),
    neo_service: NeoService = Depends(get_neo_service),
) -> FeedResponse:
    start = parse_iso_date(start_date)
    end = parse_iso_date(end_date)
    requested_days = validate_range(start, end, settings.max_days)
    payload = await neo_service.get_feed(start=start, end=end, requested_days=requested_days)
    return FeedResponse(**payload)
