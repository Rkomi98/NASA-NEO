from time import perf_counter

from fastapi import Request
from prometheus_client import Counter, Histogram
from starlette.middleware.base import BaseHTTPMiddleware


REQUEST_COUNT = Counter(
    "http_requests",
    "Total number of HTTP requests processed by the application.",
    labelnames=("method", "path", "status_code"),
)
REQUEST_LATENCY = Histogram(
    "http_request_duration_seconds",
    "HTTP request latency in seconds.",
    labelnames=("method", "path"),
)


class MetricsMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        method = request.method
        start = perf_counter()
        status_code = 500
        route = request.scope.get("route")
        path = getattr(route, "path", request.url.path)
        try:
            response = await call_next(request)
            status_code = response.status_code
            return response
        finally:
            duration = perf_counter() - start
            REQUEST_COUNT.labels(
                method=method,
                path=path,
                status_code=str(status_code),
            ).inc()
            REQUEST_LATENCY.labels(method=method, path=path).observe(duration)
