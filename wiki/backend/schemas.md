---
tags: [backend, models]
updated: 2026-05-12
related: [neo-service, routes, api-layer]
---

# schemas.py

**Percorso**: `backend/app/models/schemas.py`

## Purpose

Definisce tutti i Pydantic models usati come response types dalle API e come contratto tra backend e frontend. I tipi TypeScript in `frontend/lib/types.ts` sono il mirror diretto di questi schema.

---

## Key symbols

### Response models API

```
FeedResponse
├── meta: FeedMeta
│   ├── start_date, end_date, requested_days, chunk_count, generated_at
│   ├── cache: { hits: int, misses: int }
│   └── last_upstream_rate_limit: RateLimitState
├── stats: FeedStats
│   ├── total, hazardous, non_hazardous
│   ├── closest_miss_km: Optional[float]
│   ├── largest_diameter_km: Optional[float]
│   └── fastest_kps: Optional[float]
└── near_earth_objects: List[FeedEvent]
    └── FeedEvent
        ├── event_id: str  ("3542519:1735689600000")
        ├── id, neo_reference_id, name, designation
        ├── nasa_jpl_url, absolute_magnitude_h
        ├── is_potentially_hazardous_asteroid, is_sentry_object
        ├── estimated_diameter: Dict (units: km, m, miles, feet)
        ├── orbital_data: Dict (16 chiavi whitelistate)
        └── close_approach: Dict
            ├── close_approach_date, close_approach_date_full
            ├── epoch_date_close_approach: int (ms timestamp)
            ├── relative_velocity: { km/s, km/h, mph }
            ├── miss_distance: { km, lunar, astronomical }
            └── orbiting_body: str
```

```
NeoDetailResponse
├── id, neo_reference_id, name, designation
├── nasa_jpl_url, absolute_magnitude_h
├── is_potentially_hazardous_asteroid, is_sentry_object
├── estimated_diameter: Dict
├── orbital_data: Dict (elementi Kepleriani completi)
└── close_approach_data: List[Dict]  (storico completo approcci)
```

```
HealthResponse
├── status: Literal["ok"]
├── cache: CacheStats
│   ├── entries: int
│   ├── size_bytes: int
│   ├── hit_ratio: float (0.0–1.0)
│   └── expired_entries: int
└── upstream: UpstreamStats
    ├── last_status: Optional[int]
    ├── last_rate_limit_limit: Optional[int]    (es. 1000)
    ├── last_rate_limit_remaining: Optional[int]
    └── last_request_at: Optional[str]  (ISO8601)
```

### Cache management models

```
CacheInvalidateRequest
├── scope: Literal["all", "feed", "neo"]
├── start_date: Optional[str]
├── end_date: Optional[str]
└── neo_id: Optional[str]

CacheInvalidateResponse
├── deleted: int
└── scope: str
```

### Utility models

```
RateLimitState
├── limit: Optional[int]
├── remaining: Optional[int]
└── request_id: Optional[str]
```

---

## Dependencies

- `pydantic.BaseModel` (v1)

## Used by

- [[routes]] — response_model nei decorator FastAPI
- [[neo-service]] — `RateLimitState.dict()` per il meta del feed
- [[api-layer]] — TypeScript mirror in `frontend/lib/types.ts`

---

## Notes

- `FeedEvent.event_id` è una chiave composita: `"{asteroid_id}:{epoch_ms}"`. Garantisce unicità anche se lo stesso asteroide appare più volte in range diversi.
- `orbital_data` e `estimated_diameter` sono `Dict[str, Any]` (non model annidati) perché la struttura NASA ha unità multiple (km, m, miles, feet) con nesting variabile.
- Il mirror TypeScript in `types.ts` deve essere aggiornato manualmente se cambiano questi schema.
