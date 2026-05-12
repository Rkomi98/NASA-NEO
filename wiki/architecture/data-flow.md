---
tags: [architecture]
updated: 2026-05-12
related: [system-overview, neo-service, cache-service, nasa-client, routes]
---

# Data Flow

## Flusso 1: GET /api/feed (richiesta lista NEO)

```
1. DashboardClient.tsx
   └─ getFeed(startDate, endDate)          [frontend/lib/api.ts]
        └─ fetch("GET /api/feed?start_date=…&end_date=…")

2. routes_feed.py — router GET /api/feed
   ├─ parse_iso_date(start_date)           [utils/dates.py]
   ├─ parse_iso_date(end_date)
   ├─ validate_range(start, end, 365)      → error se > 365gg
   └─ neo_service.get_feed(start, end)

3. NeoService.get_feed()                   [services/neo_service.py]
   ├─ chunk_date_range(start, end, 7)      → lista di tuple (chunk_start, chunk_end)
   ├─ asyncio.Semaphore(2)
   └─ asyncio.gather(*[_fetch_chunk(...) for each chunk])

4. NeoService._fetch_chunk(start, end)
   └─ cache_service.get_or_set(
          namespace="feed",
          key="2025-01-01_2025-01-07",
          ttl=43200,
          factory=lambda: nasa_client.fetch_feed(...)
      )

5a. CACHE HIT → ritorna payload da file JSON
5b. CACHE MISS → NasaNeoClient.fetch_feed()
    └─ httpx GET https://api.nasa.gov/neo/rest/v1/feed
       └─ risposta raw NASA (near_earth_objects dict keyed by date)
       └─ CacheService scrive envelope JSON su disco

6. NeoService._flatten_chunk(payload, start, end)
   ├─ itera near_earth_objects[date][asteroid]
   ├─ _select_approach(asteroid, date)   → close_approach matching
   └─ _compact_orbital_data()            → whitelist 16 chiavi orbitali

7. Sort by epoch_date_close_approach
8. _build_stats() → { total, hazardous, closest_miss_km, largest_diameter_km, fastest_kps }
9. Return FeedResponse { meta, stats, near_earth_objects[] }
```

---

## Flusso 2: GET /api/neo/{id} (dettaglio asteroide)

```
1. DashboardClient.tsx
   └─ getNeo(neoId)                        [frontend/lib/api.ts]

2. routes_neo.py — router GET /api/neo/{neo_id}
   └─ neo_service.get_neo_detail(neo_id)

3. NeoService.get_neo_detail(neo_id)
   └─ cache_service.get_or_set(
          namespace="neo",
          key=neo_id,
          ttl=259200 (72h),
          factory=lambda: nasa_client.fetch_neo(neo_id)
      )

4. Ritorna NeoDetailResponse con:
   - close_approach_data[] (storico completo)
   - orbital_data (elementi orbitali Kepleriani)
   - is_potentially_hazardous_asteroid, is_sentry_object
```

---

## Flusso 3: GET /api/health

```
1. getHealth()                             [frontend/lib/api.ts]
2. routes_health.py
3. build_health_response()
   ├─ cache_service.get_stats()  → { entries, size_bytes, hit_ratio, expired_entries }
   └─ nasa_client.upstream_state → { last_status, last_rate_limit_*, last_request_at }
4. Return HealthResponse { status: "ok", cache, upstream }
```

---

## Gestione errori

| Errore | Origine | HTTP status | Codice |
|--------|---------|-------------|--------|
| Data non valida | dates.py | 400 | `invalid_date` |
| Range > 365gg | dates.py | 400 | `range_too_long` |
| Asteroide non trovato | nasa_client.py | 404 | `neo_not_found` |
| Rate limit NASA | nasa_client.py | 429 | `rate_limited` |
| Timeout NASA | nasa_client.py | 503 | `upstream_timeout` |
| NASA 5xx | nasa_client.py | 503 | `upstream_error` |

Tutti gli errori vengono trasformati in `APIError` e serializzati dall'handler in `main.py` come `{ error: { code, message, details } }`.

---

## Link correlati

- [[neo-service]] — orchestration principale
- [[cache-service]] — get-or-set, lock, envelope
- [[nasa-client]] — HTTP client, retry, headers
- [[routes]] — definizione degli endpoint
- [[date-chunking]] — logica del chunking
