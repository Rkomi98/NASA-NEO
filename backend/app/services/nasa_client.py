import asyncio
import random
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import httpx

from app.core.errors import UpstreamAPIError


RETRY_AFTER_CAP_SECONDS = 5.0
BACKOFF_BASE_SECONDS = 0.4
MAX_ATTEMPTS = 3


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

    async def fetch_feed(
        self, *, start_date: str, end_date: str
    ) -> "tuple[Dict[str, Any], Dict[str, Any]]":
        return await self._request(
            "/feed",
            params={"start_date": start_date, "end_date": end_date, "api_key": self.api_key},
        )

    async def fetch_neo(self, neo_id: str) -> "tuple[Dict[str, Any], Dict[str, Any]]":
        return await self._request(f"/neo/{neo_id}", params={"api_key": self.api_key})

    async def _request(
        self, path: str, *, params: Dict[str, Any]
    ) -> "tuple[Dict[str, Any], Dict[str, Any]]":
        if self._client is None:
            raise RuntimeError("NASA client not started")

        for attempt in range(MAX_ATTEMPTS):
            is_last = attempt == MAX_ATTEMPTS - 1
            try:
                response = await self._client.get(f"{self.base_url}{path}", params=params)
                snapshot = self._capture_headers(response)
            except httpx.TimeoutException as exc:
                if is_last:
                    raise UpstreamAPIError(
                        status_code=503,
                        code="upstream_timeout",
                        message="La NASA API ha impiegato troppo tempo a rispondere.",
                    ) from exc
                await asyncio.sleep(_backoff_delay(attempt))
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
                retry_after = _parse_retry_after(response.headers.get("retry-after"))
                if (
                    not is_last
                    and retry_after is not None
                    and retry_after <= RETRY_AFTER_CAP_SECONDS
                ):
                    await asyncio.sleep(retry_after)
                    continue
                raise UpstreamAPIError(
                    status_code=429,
                    code="rate_limited",
                    message="Rate limit NASA raggiunto. Riprova tra poco.",
                    details={
                        "rate_limit_limit": self._upstream_state["last_rate_limit_limit"],
                        "rate_limit_remaining": self._upstream_state["last_rate_limit_remaining"],
                        "retry_after_seconds": retry_after,
                    },
                )

            if 500 <= response.status_code <= 599:
                if is_last:
                    raise UpstreamAPIError(
                        status_code=503,
                        code="upstream_error",
                        message="La NASA API e' temporaneamente indisponibile.",
                    )
                await asyncio.sleep(_backoff_delay(attempt))
                continue

            if response.status_code >= 400:
                raise UpstreamAPIError(
                    status_code=502,
                    code="upstream_bad_response",
                    message="La NASA API ha restituito una risposta non gestibile.",
                    details={"status_code": response.status_code},
                )

            try:
                return response.json(), snapshot
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

    def _capture_headers(self, response: httpx.Response) -> Dict[str, Any]:
        snapshot: Dict[str, Any] = {
            "last_status": response.status_code,
            "last_rate_limit_limit": _to_int(response.headers.get("x-ratelimit-limit")),
            "last_rate_limit_remaining": _to_int(response.headers.get("x-ratelimit-remaining")),
            "last_request_at": datetime.now(timezone.utc).isoformat(),
            "request_id": response.headers.get("x-api-umbrella-request-id"),
        }
        self._upstream_state = snapshot
        return dict(snapshot)


def _to_int(value: Optional[str]) -> Optional[int]:
    if value is None:
        return None
    try:
        return int(value)
    except ValueError:
        return None


def _backoff_delay(attempt: int) -> float:
    return BACKOFF_BASE_SECONDS * (2 ** attempt) + random.uniform(0, BACKOFF_BASE_SECONDS)


def _parse_retry_after(value: Optional[str]) -> Optional[float]:
    if value is None:
        return None
    try:
        parsed = float(value)
    except ValueError:
        return None
    if parsed < 0:
        return None
    return parsed
