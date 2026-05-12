---
tags: [backend, service]
updated: 2026-05-12
related: [cache-service, nasa-client, config, date-chunking, data-flow, schemas]
---

# neo_service.py

**Percorso**: `backend/app/services/neo_service.py`

## Purpose

Layer di orchestrazione principale del backend. Coordina chunking temporale, concorrenza verso NASA, caching, trasformazione dei dati grezzi e aggregazione delle statistiche.

---

## Key symbols

### `NeoService`

**Costruttore**:
```python
NeoService(settings, cache_service, nasa_client)
```

### `get_feed(*, start, end, requested_days) → Dict`

Flusso:
1. `chunk_date_range(start, end, chunk_days=7)` → lista di tuple
2. `asyncio.Semaphore(upstream_concurrency=2)` per limitare chiamate NASA
3. `asyncio.gather(...)` → esegue `_fetch_chunk` in parallelo per ogni chunk
4. Conta `cache_hits`
5. `_flatten_chunk(payload, start, end)` per ogni chunk
6. Sort by `epoch_date_close_approach`
7. `_build_stats(flattened)`
8. Assembla `FeedResponse` dict con meta (incluso rate limit NASA) + stats + near_earth_objects

### `_fetch_chunk(start, end, semaphore) → (payload, is_hit)`

Wrappa `cache_service.get_or_set`:
- namespace: `"feed"`
- key: `"2025-01-01_2025-01-07"`
- ttl: `settings.feed_ttl_seconds` (12h)
- factory: richiesta NASA dentro semaphore (garantisce ≤ 2 call simultanei)

### `get_neo_detail(neo_id) → Dict`

Wrappa `cache_service.get_or_set`:
- namespace: `"neo"`
- key: neo_id (es. `"3542519"`)
- ttl: `settings.neo_ttl_seconds` (72h)
- factory: `nasa_client.fetch_neo(neo_id)`

Ritorna un dict whitelistato (non il raw NASA payload):
```python
{
    "id", "neo_reference_id", "name", "designation",
    "nasa_jpl_url", "absolute_magnitude_h",
    "is_potentially_hazardous_asteroid", "is_sentry_object",
    "estimated_diameter", "orbital_data", "close_approach_data"
}
```

### `_flatten_chunk(payload, start, end) → List[Dict]`

Trasforma la struttura NASA `near_earth_objects: { "2025-01-01": [asteroid, ...] }` in un array flat di eventi.

Per ogni asteroide:
- filtra `bucket_date` fuori dal range `[start, end]` (chunk boundary può eccedere)
- `_select_approach(asteroid, bucket_date)` → sceglie `close_approach_data[0]` matching la data del bucket
- `_compact_orbital_data()` → whitelist di 16 chiavi

### `_compact_orbital_data(orbital_data) → Dict`

Conserva solo:
`orbit_class`, `semi_major_axis`, `eccentricity`, `inclination`, `orbital_period`,
`first_observation_date`, `last_observation_date`, `observations_used`,
`minimum_orbit_intersection`, `perihelion_distance`, `aphelion_distance`,
`ascending_node_longitude`, `perihelion_argument`, `mean_anomaly`,
`epoch_osculation`, `equinox`

### `_build_stats(items) → Dict`

Calcola dal flat array:
- `total`, `hazardous`, `non_hazardous`
- `closest_miss_km` → min `miss_distance.kilometers`
- `largest_diameter_km` → max `estimated_diameter.kilometers.estimated_diameter_max`
- `fastest_kps` → max `relative_velocity.kilometers_per_second`

---

## Dependencies

- [[cache-service]] — `get_or_set`
- [[nasa-client]] — `fetch_feed`, `fetch_neo`, `upstream_state`
- [[config]] — `Settings`
- `app.utils.dates` — `chunk_date_range`, `date_in_range`
- `app.models.schemas` — `RateLimitState`

## Used by

- [[routes]] — `routes_feed.py` e `routes_neo.py` via `Depends(get_neo_service)`

---

## Notes

- Il semaphore è creato **per ogni chiamata** a `get_feed`, non condiviso globalmente. Questo è corretto perché `asyncio.gather` crea un gruppo di task per ogni richiesta HTTP in arrivo.
- `_select_approach` fallback: se nessun `close_approach_data` matcha la `bucket_date`, usa il primo approccio disponibile. Può produrre date leggermente fuori range in edge case.
- Il flatten filtra `bucket_date` fuori range, necessario perché la NASA può restituire dati al di fuori dello stretto window richiesto quando i chunk si sovrappongono al confine.
