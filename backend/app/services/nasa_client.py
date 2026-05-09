import asyncio
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import httpx

from app.core.errors import UpstreamAPIError


class NasaNeoClient:
    def __init__(self, *, base_url: str, api_key: str, timeout_seconds: float) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout_seconds
        self._client: Optional[httpx.AsyncClient] = None
        self._upstream_state: Dict[str, Any] = {
            "last_status": None,
            "last_rate_limit_limit": None,
            "last_rate_limit_remaining": None,
            "last_request_at": None,
            "request_id": None,
        }

    async def startup(self) -> None:
        self._client = httpx.AsyncClient(timeout=self.timeout)

    async def shutdown(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    @property
    def upstream_state(self) -> Dict[str, Any]:
        return dict(self._upstream_state)

    async def fetch_feed(self, *, start_date: str, end_date: str) -> Dict[str, Any]:
        return await self._request(
            "/feed",
            params={"start_date": start_date, "end_date": end_date, "api_key": self.api_key},
        )

    async def fetch_neo(self, neo_id: str) -> Dict[str, Any]:
        return await self._request(f"/neo/{neo_id}", params={"api_key": self.api_key})

    async def _request(self, path: str, *, params: Dict[str, Any]) -> Dict[str, Any]:
        if self._client is None:
            raise RuntimeError("NASA client not started")

        attempts = 2
        for attempt in range(attempts):
            try:
                response = await self._client.get(f"{self.base_url}{path}", params=params)
                self._capture_headers(response)
            except httpx.TimeoutException as exc:
                if attempt == attempts - 1:
                    raise UpstreamAPIError(
                        status_code=503,
                        code="upstream_timeout",
                        message="La NASA API ha impiegato troppo tempo a rispondere.",
                    ) from exc
                await asyncio.sleep(0.4)
                continue
            except httpx.HTTPError as exc:
                raise UpstreamAPIError(
                    status_code=503,
                    code="upstream_unreachable",
                    message="Impossibile raggiungere la NASA API.",
                ) from exc

            if response.status_code == 404:
                raise UpstreamAPIError(
                    status_code=404,
                    code="neo_not_found",
                    message="Asteroide non trovato nella NASA API.",
                )

            if response.status_code == 429:
                raise UpstreamAPIError(
                    status_code=429,
                    code="rate_limited",
                    message="Rate limit NASA raggiunto. Riprova tra poco.",
                    details={
                        "rate_limit_limit": self._upstream_state["last_rate_limit_limit"],
                        "rate_limit_remaining": self._upstream_state["last_rate_limit_remaining"],
                    },
                )

            if 500 <= response.status_code <= 599:
                if attempt == attempts - 1:
                    raise UpstreamAPIError(
                        status_code=503,
                        code="upstream_error",
                        message="La NASA API e' temporaneamente indisponibile.",
                    )
                await asyncio.sleep(0.4)
                continue

            if response.status_code >= 400:
                raise UpstreamAPIError(
                    status_code=502,
                    code="upstream_bad_response",
                    message="La NASA API ha restituito una risposta non gestibile.",
                    details={"status_code": response.status_code},
                )

            try:
                return response.json()
            except ValueError as exc:
                raise UpstreamAPIError(
                    status_code=502,
                    code="upstream_invalid_json",
                    message="La NASA API ha restituito JSON non valido.",
                ) from exc

        raise UpstreamAPIError(
            status_code=503,
            code="upstream_error",
            message="La NASA API e' temporaneamente indisponibile.",
        )

    def _capture_headers(self, response: httpx.Response) -> None:
        self._upstream_state = {
            "last_status": response.status_code,
            "last_rate_limit_limit": _to_int(response.headers.get("x-ratelimit-limit")),
            "last_rate_limit_remaining": _to_int(response.headers.get("x-ratelimit-remaining")),
            "last_request_at": datetime.now(timezone.utc).isoformat(),
            "request_id": response.headers.get("x-api-umbrella-request-id"),
        }


def _to_int(value: Optional[str]) -> Optional[int]:
    if value is None:
        return None
    try:
        return int(value)
    except ValueError:
        return None
