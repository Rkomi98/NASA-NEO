# Arkemis NEO Backend — API Reference

Base URL (dev): `http://localhost:8000`

---

## Endpoint

### `GET /api/feed`

Restituisce il feed degli asteroidi in un range di date. Il backend spezza automaticamente range superiori a 7 giorni in chunk, li recupera in parallelo (con cache), e restituisce un array piatto di eventi ordinati per data di passaggio.

**Query parameters**

| Parametro | Tipo | Obbligatorio | Descrizione |
|-----------|------|-------------|-------------|
| `start_date` | `YYYY-MM-DD` | Sì | Data di inizio range |
| `end_date` | `YYYY-MM-DD` | Sì | Data di fine range (max consigliato: 60 giorni) |

**Response schema** (`FeedResponse`)

```json
{
  "meta": {
    "start_date": "2025-01-01",
    "end_date": "2025-01-30",
    "requested_days": 29,
    "chunk_count": 5,
    "generated_at": "2025-01-30T12:00:00Z",
    "cache": { "hits": 4, "misses": 1 },
    "last_upstream_rate_limit": {
      "limit": 2000,
      "remaining": 1987,
      "request_id": "abc-123"
    }
  },
  "stats": {
    "total": 142,
    "hazardous": 8,
    "non_hazardous": 134,
    "closest_miss_km": 123456.78,
    "largest_diameter_km": 0.95,
    "fastest_kps": 28.3
  },
  "near_earth_objects": [
    {
      "event_id": "3542519:1735689600000",
      "id": "3542519",
      "neo_reference_id": "3542519",
      "name": "(2011 AG5)",
      "designation": "2011 AG5",
      "nasa_jpl_url": "https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=3542519",
      "absolute_magnitude_h": 21.4,
      "is_potentially_hazardous_asteroid": true,
      "is_sentry_object": false,
      "estimated_diameter": {
        "kilometers": {
          "estimated_diameter_min": 0.1,
          "estimated_diameter_max": 0.25
        }
      },
      "orbital_data": { "orbit_class": { "orbit_class_type": "APO" }, "... altri campi": "..." },
      "close_approach": {
        "close_approach_date": "2025-01-15",
        "close_approach_date_full": "2025-Jan-15 14:32",
        "epoch_date_close_approach": 1736948000000,
        "relative_velocity": {
          "kilometers_per_second": "22.5",
          "kilometers_per_hour": "81000",
          "miles_per_hour": "50000"
        },
        "miss_distance": {
          "kilometers": "4500000",
          "lunar": "11.7",
          "astronomical": "0.030"
        },
        "orbiting_body": "Earth"
      }
    }
  ]
}
```

**Errori**

| Status | Descrizione |
|--------|-------------|
| `400` | Date mancanti, formato non valido, o range negativo |
| `502` | NASA API non raggiungibile o ha restituito errore |

---

### `GET /api/neo/{neo_id}`

Restituisce i dati completi di un singolo asteroide, incluso lo storico completo di close approach (passato e futuro). Risultato cachato 72 ore.

**Path parameters**

| Parametro | Tipo | Descrizione |
|-----------|------|-------------|
| `neo_id` | `string` | ID NASA dell'asteroide (es. `3542519`) |

**Response schema** (`NeoDetailResponse`)

```json
{
  "id": "3542519",
  "neo_reference_id": "3542519",
  "name": "(2011 AG5)",
  "designation": "2011 AG5",
  "nasa_jpl_url": "https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=3542519",
  "absolute_magnitude_h": 21.4,
  "is_potentially_hazardous_asteroid": true,
  "is_sentry_object": false,
  "estimated_diameter": {
    "kilometers": {
      "estimated_diameter_min": 0.1,
      "estimated_diameter_max": 0.25
    }
  },
  "orbital_data": {
    "orbit_id": "199",
    "orbit_determination_date": "2023-12-01",
    "first_observation_date": "2011-01-08",
    "last_observation_date": "2023-11-30",
    "data_arc_in_days": "4709",
    "observations_used": "672",
    "orbit_uncertainty": "0",
    "minimum_orbit_intersection": ".00051",
    "semi_major_axis": "1.4026",
    "eccentricity": ".3891",
    "inclination": "3.68",
    "ascending_node_longitude": "134.73",
    "orbital_period": "660.2",
    "perihelion_distance": ".856",
    "perihelion_argument": "184.5",
    "aphelion_distance": "1.948",
    "perihelion_time": "2459894.5",
    "mean_anomaly": "43.2",
    "mean_motion": ".545",
    "equinox": "J2000",
    "orbit_class": {
      "orbit_class_type": "APO",
      "orbit_class_description": "Near-Earth asteroid orbits...",
      "orbit_class_range": "...",
      "type": "APO"
    }
  },
  "close_approach_data": [
    {
      "close_approach_date": "2025-01-15",
      "close_approach_date_full": "2025-Jan-15 14:32",
      "epoch_date_close_approach": 1736948000000,
      "relative_velocity": {
        "kilometers_per_second": "22.5",
        "kilometers_per_hour": "81000"
      },
      "miss_distance": {
        "kilometers": "4500000",
        "lunar": "11.7"
      },
      "orbiting_body": "Earth"
    }
  ]
}
```

**Errori**

| Status | Descrizione |
|--------|-------------|
| `404` | Asteroide non trovato (NASA restituisce 404) |
| `502` | NASA API non raggiungibile |

---

### `GET /api/health`

Restituisce lo stato del backend: statistiche sulla cache e rate limit residuo verso la NASA.

**Response schema** (`HealthResponse`)

```json
{
  "status": "ok",
  "cache": {
    "entries": 47,
    "size_bytes": 2048000,
    "hit_ratio": 0.87,
    "expired_entries": 3
  },
  "upstream": {
    "last_status": 200,
    "last_rate_limit_limit": 2000,
    "last_rate_limit_remaining": 1850,
    "last_request_at": "2025-01-30T11:58:00Z"
  }
}
```

---

### `GET /health`

Alias di `/api/health` per compatibilità con health probe di orchestratori (Kubernetes, Docker Compose). Non esposto nella documentazione OpenAPI (`include_in_schema=False`).

---

### `POST /api/cache/invalidate`

Invalida la cache, in tutto o in parte.

**Request body** (`CacheInvalidateRequest`)

```json
{
  "scope": "all"
}
```

oppure per scope parziale:

```json
{
  "scope": "feed",
  "start_date": "2025-01-01",
  "end_date": "2025-01-07"
}
```

oppure:

```json
{
  "scope": "neo",
  "neo_id": "3542519"
}
```

| Campo | Valori | Descrizione |
|-------|--------|-------------|
| `scope` | `all`, `feed`, `neo` | Scope di invalidazione |
| `start_date` | `YYYY-MM-DD` | Solo con `scope: feed` |
| `end_date` | `YYYY-MM-DD` | Solo con `scope: feed` |
| `neo_id` | `string` | Solo con `scope: neo` |

**Response** (`CacheInvalidateResponse`)

```json
{
  "deleted": 5,
  "scope": "feed"
}
```

---

### `GET /metrics`

Endpoint Prometheus. Espone metriche HTTP (request count per metodo/path/status, latency histogram). Compatibile con scraping Prometheus standard.

**Response**: `text/plain` in formato Prometheus exposition format.

---

### `GET /`

Root health check. Restituisce `{"name": "Arkemis NEO Backend", "status": "ok"}`. Usato per verificare che il processo sia attivo.

---

## Cache TTL

| Tipo | Namespace | TTL |
|------|-----------|-----|
| Feed chunk (7 giorni) | `feed` | 12 ore |
| Dettaglio NEO | `neo` | 72 ore |

I file di cache sono salvati in `backend/cache/{namespace}/{key}.json`.

---

## Note sull'autenticazione

Nessuna autenticazione richiesta. Il backend è pensato per essere esposto solo in rete interna o dietro un reverse proxy. La chiave NASA API è configurata esclusivamente lato server via variabile d'ambiente `NASA_API_KEY`.
