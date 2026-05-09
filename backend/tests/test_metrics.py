import os

from fastapi.testclient import TestClient


os.environ.setdefault("NASA_API_KEY", "test")
os.environ["DEBUG"] = "false"

from app.main import app


def test_metrics_endpoint_exposes_prometheus_payload() -> None:
    client = TestClient(app)

    root_response = client.get("/")
    metrics_response = client.get("/metrics")

    assert root_response.status_code == 200
    assert metrics_response.status_code == 200
    assert "text/plain" in metrics_response.headers["content-type"]
    assert 'http_requests_total{method="GET",path="/",status_code="200"} 1.0' in metrics_response.text
    assert 'http_request_duration_seconds_bucket{le="' in metrics_response.text


def test_localhost_preflight_is_allowed() -> None:
    client = TestClient(app)

    response = client.options(
        "/api/feed?start_date=2026-04-10&end_date=2026-05-09",
        headers={
            "Origin": "http://127.0.0.1:3001",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "content-type",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:3001"
