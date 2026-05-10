from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes_cache import router as cache_router
from app.api.routes_feed import router as feed_router
from app.api.routes_health import router as health_router
from app.api.routes_metrics import router as metrics_router
from app.api.routes_neo import router as neo_router
from app.core.config import get_settings
from app.core.errors import APIError
from app.observability import MetricsMiddleware
from app.services.cache_service import CacheService
from app.services.nasa_client import NasaNeoClient
from app.services.neo_service import NeoService


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    cache_service = CacheService(settings.cache_dir)
    nasa_client = NasaNeoClient(
        base_url=settings.nasa_base_url,
        api_key=settings.nasa_api_key,
        timeout_seconds=settings.upstream_timeout_seconds,
    )
    await nasa_client.startup()
    neo_service = NeoService(
        settings=settings,
        cache_service=cache_service,
        nasa_client=nasa_client,
    )
    app.state.cache_service = cache_service
    app.state.nasa_client = nasa_client
    app.state.neo_service = neo_service
    yield
    await nasa_client.shutdown()


app = FastAPI(title="Arkemis NEO Backend", version="1.0.0", lifespan=lifespan)
settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_origin_regex=settings.allowed_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(MetricsMiddleware)


@app.exception_handler(APIError)
async def api_error_handler(_: Request, exc: APIError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": {
                "code": exc.code,
                "message": exc.message,
                "details": exc.details,
            }
        },
    )


@app.get("/")
async def root() -> dict:
    return {"name": settings.app_name, "status": "ok"}


@app.head("/", include_in_schema=False)
async def root_head() -> Response:
    return Response(status_code=200)


app.include_router(feed_router)
app.include_router(neo_router)
app.include_router(health_router)
app.include_router(cache_router)
app.include_router(metrics_router)
