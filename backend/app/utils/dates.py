from datetime import date, datetime, timedelta
from typing import Iterable, List, Tuple

from app.core.errors import APIError


DATE_FORMAT = "%Y-%m-%d"


def parse_iso_date(value: str) -> date:
    try:
        return datetime.strptime(value, DATE_FORMAT).date()
    except ValueError as exc:
        raise APIError(
            status_code=400,
            code="invalid_date",
            message="Formato data non valido. Usa YYYY-MM-DD.",
            details={"value": value},
        ) from exc


def validate_range(start: date, end: date, max_days: int) -> int:
    if end < start:
        raise APIError(
            status_code=400,
            code="invalid_range",
            message="La data finale non puo' precedere quella iniziale.",
        )

    days = (end - start).days + 1
    if days > max_days:
        raise APIError(
            status_code=400,
            code="range_too_long",
            message=f"Range troppo lungo. Il massimo consentito e' {max_days} giorni.",
            details={"max_days": max_days},
        )
    return days


def chunk_date_range(start: date, end: date, chunk_days: int) -> List[Tuple[date, date]]:
    chunks: List[Tuple[date, date]] = []
    cursor = start
    while cursor <= end:
        chunk_end = min(cursor + timedelta(days=chunk_days - 1), end)
        chunks.append((cursor, chunk_end))
        cursor = chunk_end + timedelta(days=1)
    return chunks


def date_in_range(value: str, start: date, end: date) -> bool:
    try:
        parsed = parse_iso_date(value)
    except APIError:
        return False
    return start <= parsed <= end
