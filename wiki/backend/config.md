---
tags: [backend, config]
updated: 2026-05-12
related: [main, caching-strategy, date-chunking, nasa-client]
---

# config.py

**Percorso**: `backend/app/core/config.py`

## Purpose

Definisce `Settings`, il contenitore Pydantic per tutte le configurazioni del backend. Usa `BaseSettings` per leggere automaticamente le variabili d'ambiente e il file `.env`.

---

## Key symbols

### `Settings` (Pydantic BaseSettings)

| Campo | Default | Env var | Note |
|-------|---------|---------|------|
| `app_name` | `"Arkemis NEO Backend"` | — | nome display |
| `debug` | `False` | `DEBUG` | — |
| `nasa_api_key` | — | `NASA_API_KEY` | **obbligatoria** |
| `nasa_base_url` | `"https://api.nasa.gov/neo/rest/v1"` | — | — |
| `allowed_origins` | `["localhost:3000", "localhost:3001", ...]` | `ALLOWED_ORIGINS` | CSV o JSON |
| `allowed_origin_regex` | `^https?://(localhost\|127\.0\.0\.1):[0-9]+$` | `ALLOWED_ORIGIN_REGEX` | CORS wildcard locale |
| `feed_ttl_seconds` | `43200` (12h) | — | TTL cache feed |
| `neo_ttl_seconds` | `259200` (72h) | — | TTL cache neo detail |
| `max_days` | `365` | — | range massimo query feed |
| `chunk_days` | `7` | — | dimensione chunk NASA |
| `upstream_timeout_seconds` | `20.0` | — | timeout HTTP client |
| `upstream_concurrency` | `2` | — | semaphore NASA calls |
| `cache_dir` | `backend/cache/` | — | path relativa al package |

### `get_settings()` — factory con `@lru_cache`
Singleton: la stessa istanza di `Settings` viene riusata per tutta la durata del processo. Si invalida solo a riavvio.

---

## Dependencies

- `pydantic.BaseSettings` (Pydantic v1)

## Used by

- [[main]] — `get_settings()` nel lifespan
- [[routes]] — `Depends(get_settings)` in routes_feed
- [[neo-service]] — `self.settings.chunk_days`, `feed_ttl_seconds`, ecc.

---

## Notes

- `cache_dir` usa `Path(__file__).resolve().parents[2] / "cache"` — è relativa alla posizione del file, non alla CWD. Invariante al cambio di directory di lavoro.
- `allowed_origins` supporta tre formati in `ALLOWED_ORIGINS`: lista JSON `["a","b"]`, CSV `a,b`, stringa singola `a`.
- Pydantic v1: `BaseSettings` importato da `pydantic`, non da `pydantic_settings` (API cambiata in v2).
