from datetime import date

import pytest

from app.core.errors import APIError
from app.utils.dates import chunk_date_range, validate_range


def test_chunk_date_range_splits_eight_days() -> None:
    chunks = chunk_date_range(date(2025, 1, 1), date(2025, 1, 8), 7)
    assert chunks == [
        (date(2025, 1, 1), date(2025, 1, 7)),
        (date(2025, 1, 8), date(2025, 1, 8)),
    ]


def test_validate_range_rejects_too_long() -> None:
    with pytest.raises(APIError) as exc:
        validate_range(date(2025, 1, 1), date(2026, 1, 2), 365)
    assert exc.value.code == "range_too_long"
