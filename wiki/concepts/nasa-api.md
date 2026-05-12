---
tags: [concept, nasa-api, external]
updated: 2026-05-12
related: [nasa-client, date-chunking, data-flow, config]
---

# NASA NeoWs API

## What it is

NASA Near Earth Object Web Service (NeoWs) — API REST pubblica della NASA per consultare il database di Near Earth Objects (NEO): asteroidi e comete in prossimità della Terra.

**Base URL**: `https://api.nasa.gov/neo/rest/v1`

---

## Endpoint usati

### `GET /feed`

Ritorna tutti i NEO con close approach in un dato range di date.

**Parametri**:
| Param | Tipo | Obbligatorio | Note |
|-------|------|-------------|------|
| `start_date` | YYYY-MM-DD | sì | — |
| `end_date` | YYYY-MM-DD | sì | max 7 giorni da start_date |
| `api_key` | string | sì | da `.env` |

**Risposta raw** (struttura chiave):
```json
{
  "near_earth_objects": {
    "2025-01-01": [ { asteroid }, { asteroid }, ... ],
    "2025-01-02": [ ... ],
    ...
  }
}
```

Il dict è keyed per **data bucket** (non per asteroide). Un asteroide può apparire in più date.

---

### `GET /neo/{neo_id}`

Ritorna tutti i dati di un asteroide specifico, incluso lo storico completo di close approaches e i dati orbitali completi.

**Risposta raw** include:
- `orbital_data`: elementi Kepleriani (semi_major_axis, eccentricity, inclination, ascending_node_longitude, perihelion_argument, ecc.)
- `close_approach_data[]`: array di tutti gli approcci storici e futuri
- `is_potentially_hazardous_asteroid`, `is_sentry_object`
- `estimated_diameter` in km, m, miles, feet

---

## Rate limiting

La NASA API usa un sistema di rate limit per API key.

**Headers di risposta**:
```
x-ratelimit-limit: 1000        # richieste/ora consentite
x-ratelimit-remaining: 987     # rimanenti nell'ora corrente
x-api-umbrella-request-id: ... # ID univoco della richiesta (debugging)
```

Il backend cattura questi header ad ogni risposta (`NasaNeoClient._capture_headers()`) e li espone nel feed meta e nel health endpoint.

**Rate limit default** per API key registrata: **1000 richieste/ora**.
Con chunking da 7gg e concurrency=2, un range di 365gg fa ~53 richieste (circa il 5% del limite orario).

---

## Codici errore gestiti

| Status | Codice interno | Situazione |
|--------|----------------|------------|
| 404 | `neo_not_found` | NEO non presente nel DB NASA |
| 429 | `rate_limited` | Limite orario superato |
| 5xx | `upstream_error` | NASA temporaneamente non disponibile |
| Timeout | `upstream_timeout` | Risposta NASA > 20s |
| HTTPError | `upstream_unreachable` | Connessione fallita |
| JSON non valido | `upstream_invalid_json` | Risposta non parseable |

---

## Where it's used

- [[nasa-client]] — implementazione del client HTTP
- [[date-chunking]] — limite 7gg per /feed
- [[config]] — `nasa_api_key`, `nasa_base_url`, `upstream_timeout_seconds`

---

## Note

- Con `api_key=DEMO_KEY` (default NASA senza registrazione) il rate limit è 30 req/ora. Insufficiente per range lunghi.
- Il `/feed` della NASA può restituire asteroidi **fuori** dal range richiesto al confine del chunk — per questo `_flatten_chunk` filtra esplicitamente.
- `is_sentry_object` indica se l'asteroide è nella lista Sentry della NASA (sistema di monitoraggio impatti).
