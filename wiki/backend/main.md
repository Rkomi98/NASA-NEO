---
tags: [backend, entrypoint]
updated: 2026-05-12
related: [config, nasa-client, cache-service, neo-service, observability, routes]
---

# main.py

**Percorso**: `backend/app/main.py`

## Purpose

Punto di ingresso del backend FastAPI. Crea l'app, registra middleware, gestisce il ciclo di vita dei servizi (startup/shutdown) e include i router.

---

## Key symbols

### `lifespan(app)` — async context manager
Eseguito all'avvio e allo spegnimento del server. Istanzia nell'ordine:
1. `Settings` → `get_settings()`
2. `CacheService(settings.cache_dir)`
3. `NasaNeoClient(base_url, api_key, timeout_seconds)`
4. `await nasa_client.startup()` → crea `httpx.AsyncClient`
5. `NeoService(settings, cache_service, nasa_client)`
6. Assegna tutto a `app.state.*`

Al teardown: `await nasa_client.shutdown()` → chiude il client HTTP.

### `app` — FastAPI instance
```python
app = FastAPI(title="Arkemis NEO Backend", version="1.0.0", lifespan=lifespan)
```

### Middleware (ordine di registrazione)
1. `CORSMiddleware` — origini da `settings.allowed_origins` + regex `localhost:*`
2. `MetricsMiddleware` — Prometheus Counter + Histogram su ogni request

### `api_error_handler` — exception handler per `APIError`
Serializza tutte le eccezioni `APIError` come:
```json
{ "error": { "code": "...", "message": "...", "details": {} } }
```

### Router inclusi
| Router | Tag | Prefisso |
|--------|-----|---------|
| feed_router | feed | /api/feed |
| neo_router | neo | /api/neo/{id} |
| health_router | health | /api/health, /health |
| cache_router | cache | /api/cache/invalidate |
| metrics_router | - | /metrics |

---

## Dependencies

- [[config]] — `get_settings()`
- [[cache-service]] — `CacheService`
- [[nasa-client]] — `NasaNeoClient`
- [[neo-service]] — `NeoService`
- [[observability]] — `MetricsMiddleware`
- `app.core.errors` — `APIError`

## Used by

- Uvicorn come ASGI app: `uvicorn app.main:app`
- [[routes]] — tutti i router importano `app.state` via `dependencies.py`

---

## Notes

- `app.state` è il meccanismo DI: i router accedono ai servizi via `request.app.state` in `dependencies.py`.
- Il `lifespan` pattern è preferito a `@app.on_event("startup")` (deprecato in FastAPI recente).
- CORS è configurato sia per lista statica che per regex, per supportare porte arbitrarie su localhost.
