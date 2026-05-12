---
tags: [backend, observability]
updated: 2026-05-12
related: [main, routes, stack]
---

# observability.py

**Percorso**: `backend/app/observability.py`

## Purpose

Definisce le metriche Prometheus e il middleware che le popola ad ogni request HTTP. Le metriche vengono esposte sull'endpoint `/metrics`.

---

## Key symbols

### `REQUEST_COUNT` — `prometheus_client.Counter`

```python
Counter(
    "http_requests",
    "Total number of HTTP requests processed by the application.",
    labelnames=("method", "path", "status_code"),
)
```

Label values esempio: `method="GET"`, `path="/api/feed"`, `status_code="200"`.

### `REQUEST_LATENCY` — `prometheus_client.Histogram`

```python
Histogram(
    "http_request_duration_seconds",
    "HTTP request latency in seconds.",
    labelnames=("method", "path"),
)
```

Usa i bucket di default di prometheus-client (0.005s → 10s).

### `MetricsMiddleware` — `starlette.middleware.base.BaseHTTPMiddleware`

```python
async def dispatch(self, request, call_next):
    method = request.method
    start = perf_counter()
    status_code = 500  # default se eccezione non gestita
    route = request.scope.get("route")
    path = getattr(route, "path", request.url.path)
    try:
        response = await call_next(request)
        status_code = response.status_code
        return response
    finally:
        duration = perf_counter() - start
        REQUEST_COUNT.labels(method, path, str(status_code)).inc()
        REQUEST_LATENCY.labels(method, path).observe(duration)
```

**Nota chiave**: usa `request.scope["route"].path` (es. `/api/neo/{neo_id}`) invece di `request.url.path` (es. `/api/neo/3542519`). Questo evita cardinalità esplosa nelle label Prometheus per path con parametri.

---

## Dependencies

- `prometheus_client` — Counter, Histogram, generate_latest
- `starlette.middleware.base.BaseHTTPMiddleware`
- `time.perf_counter`

## Used by

- [[main]] — `app.add_middleware(MetricsMiddleware)`
- [[routes]] — `routes_metrics.py` chiama `prometheus_client.generate_latest()`

---

## Notes

- Il `status_code = 500` di default nel `finally` copre il caso in cui `call_next` lanci un'eccezione non gestita: la request viene comunque contata come errore.
- La latenza include il tempo del middleware completo, non solo il handler. Include quindi serialize/deserialize Pydantic.
- In produzione, `/metrics` andrebbe protetto (almeno via network policy) dato che espone dati operativi.
