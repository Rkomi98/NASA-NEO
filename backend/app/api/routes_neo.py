from fastapi import APIRouter, Depends

from app.dependencies import get_neo_service
from app.models.schemas import NeoDetailResponse
from app.services.neo_service import NeoService


router = APIRouter(tags=["neo"])


@router.get("/api/neo/{neo_id}", response_model=NeoDetailResponse)
async def get_neo_detail(
    neo_id: str,
    neo_service: NeoService = Depends(get_neo_service),
) -> NeoDetailResponse:
    payload = await neo_service.get_neo_detail(neo_id)
    return NeoDetailResponse(**payload)
