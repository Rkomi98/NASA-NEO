from fastapi import Request

from app.services.cache_service import CacheService
from app.services.nasa_client import NasaNeoClient
from app.services.neo_service import NeoService


def get_cache_service(request: Request) -> CacheService:
    return request.app.state.cache_service


def get_nasa_client(request: Request) -> NasaNeoClient:
    return request.app.state.nasa_client


def get_neo_service(request: Request) -> NeoService:
    return request.app.state.neo_service
