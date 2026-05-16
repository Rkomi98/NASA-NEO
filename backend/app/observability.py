from time import perf_counter

from prometheus_client import Counter, Histogram


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


class MetricsMiddleware:
    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        method = scope["method"]
        start = perf_counter()
        status_holder = {"code": 500}

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                status_holder["code"] = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            route = scope.get("route")
            path = getattr(route, "path", scope.get("path", "unknown"))
            duration = perf_counter() - start
            REQUEST_COUNT.labels(
                method=method,
                path=path,
                status_code=str(status_holder["code"]),
            ).inc()
            REQUEST_LATENCY.labels(method=method, path=path).observe(duration)
