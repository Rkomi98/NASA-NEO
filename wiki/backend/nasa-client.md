---
tags: [backend, service]
updated: 2026-05-12
related: [neo-service, config, nasa-api, data-flow]
---

# nasa_client.py

**Percorso**: `backend/app/services/nasa_client.py`

## Purpose

HTTP client asincrono che wrappa tutte le chiamate verso la NASA NeoWs API. Gestisce retry, cattura rate limit headers, e traduce gli errori HTTP in `UpstreamAPIError`.

---

## Key symbols

### `NasaNeoClient`

**Stato interno**:
```python
_client: httpx.AsyncClient        # creato nel startup
_upstream_state: Dict[str, Any]   # snapshot dell'ultimo response headers
```

**Metodi pubblici**:

| Metodo | Descrizione |
|--------|-------------|
| `startup()` | crea `httpx.AsyncClient(timeout=self.timeout)` |
| `shutdown()` | chiude il client (`aclose()`) |
| `fetch_feed(*, start_date, end_date)` | GET `/feed?start_date=…&end_date=…&api_key=…` |
| `fetch_neo(neo_id)` | GET `/neo/{neo_id}?api_key=…` |
| `upstream_state` (property) | copia del `_upstream_state` (readonly) |

**Metodi privati**:

| Metodo | Descrizione |
|--------|-------------|
| `_request(path, params)` | nucleo HTTP: 2 tentativi, gestione errori per status code |
| `_capture_headers(response)` | salva `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-api-umbrella-request-id` |

### Logica di retry in `_request`

```
attempts = 2
for attempt in range(attempts):
    try:
        response = GET ...
        _capture_headers(response)
    except TimeoutException:
        if last attempt → raise UpstreamAPIError(503, "upstream_timeout")
        sleep 0.4s → retry
    except HTTPError:
        raise UpstreamAPIError(503, "upstream_unreachable")
    
    if 404 → raise (404, "neo_not_found")
    if 429 → raise (429, "rate_limited") + rate limit details
    if 5xx → sleep 0.4s → retry (or raise on last attempt)
    if 4xx other → raise (502, "upstream_bad_response")
    
    return response.json()
```

---

## Dependencies

- `httpx` — AsyncClient
- `app.core.errors` — `UpstreamAPIError`

## Used by

- [[neo-service]] — chiama `fetch_feed()` e `fetch_neo()` dentro il factory della cache
- [[routes]] — `routes_health.py` legge `upstream_state` per il health check
- [[main]] — startup/shutdown nel lifespan

---

## Notes

- Il client viene creato **una volta** nel lifespan e condiviso. Non viene ri-creato per ogni richiesta.
- `_upstream_state` viene aggiornato **ad ogni response** (anche errori 4xx/5xx), tranne le eccezioni di rete.
- `x-api-umbrella-request-id` è utile per il debug con il NASA support team.
- Il secondo tentativo ha un delay fisso di 400ms — sufficiente per errori transitori, non per rate limit prolungati.
