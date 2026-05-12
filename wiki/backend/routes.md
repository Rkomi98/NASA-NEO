---
tags: [backend, routes]
updated: 2026-05-12
related: [main, neo-service, cache-service, schemas, observability, data-flow]
---

# Routes

**Percorsi**: `backend/app/api/routes_*.py`

## Purpose

Cinque router FastAPI che espongono le API REST del backend. Ogni router gestisce validazione input, delega al service layer e ritorna il response model Pydantic.

---

## Endpoint catalog

### `GET /api/feed` — `routes_feed.py`

**Query params**: `start_date` (YYYY-MM-DD), `end_date` (YYYY-MM-DD)
**Response**: `FeedResponse`
**Flow**:
1. `parse_iso_date(start_date)` + `parse_iso_date(end_date)`
2. `validate_range(start, end, settings.max_days)` → 400 se > 365gg
3. `neo_service.get_feed(start, end, requested_days)` → `FeedResponse`

---

### `GET /api/neo/{neo_id}` — `routes_neo.py`

**Path param**: `neo_id` (string)
**Response**: `NeoDetailResponse`
**Flow**:
1. `neo_service.get_neo_detail(neo_id)` → `NeoDetailResponse`
2. Propagazione 404 se NASA non trova l'asteroide

---

### `GET /api/health` — `routes_health.py`

**Response**: `HealthResponse`
**Also**: `GET /health` (compat, `include_in_schema=False`)
**Flow**:
```python
build_health_response(cache_service, nasa_client) → HealthResponse {
    status: "ok",
    cache: cache_service.get_stats(),
    upstream: nasa_client.upstream_state
}
```

---

### `POST /api/cache/invalidate` — `routes_cache.py`

**Body**: `CacheInvalidateRequest { scope: "all"|"feed"|"neo", ... }`
**Response**: `CacheInvalidateResponse { deleted: int, scope: str }`
**Flow**: `cache_service.invalidate(scope, ...)`

Esempi:
```json
{ "scope": "all" }
{ "scope": "feed", "start_date": "2025-01-01", "end_date": "2025-01-07" }
{ "scope": "neo", "neo_id": "3542519" }
```

---

### `GET /metrics` — `routes_metrics.py`

**Content-Type**: `text/plain; version=0.0.4` (Prometheus exposition format)
**Response**: output di `prometheus_client.generate_latest()`
**No schema** (non incluso in OpenAPI)

---

## Dependency injection pattern

Tutti i router usano `dependencies.py`:

```python
def get_cache_service(request: Request) → CacheService:
    return request.app.state.cache_service

def get_nasa_client(request: Request) → NasaNeoClient:
    return request.app.state.nasa_client

def get_neo_service(request: Request) → NeoService:
    return request.app.state.neo_service
```

Usati come `Depends(get_neo_service)` nei parametri delle route functions.

---

## Dependencies

- [[neo-service]] — `get_neo_service`
- [[cache-service]] — `get_cache_service`
- [[nasa-client]] — `get_nasa_client`
- [[schemas]] — response models
- `app.utils.dates` — parsing e validazione date

## Used by

- [[main]] — `app.include_router(...)`

---

## Notes

- `routes_health.py` duplica la logica in `build_health_response()` richiamata da entrambe le route (`/api/health` e `/health`) per DRY.
- Non c'è autenticazione su nessun endpoint. Il sistema è pensato per uso locale/interno.
- `/metrics` usa la registry globale di `prometheus_client`, che viene popolata da `MetricsMiddleware` in [[observability]].
