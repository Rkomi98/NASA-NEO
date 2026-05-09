import asyncio
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, Optional, Tuple


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class CacheService:
    def __init__(self, cache_root: Path) -> None:
        self.cache_root = cache_root
        self.cache_root.mkdir(parents=True, exist_ok=True)
        self._locks: Dict[str, asyncio.Lock] = {}
        self._hits = 0
        self._misses = 0
        self._expired = 0

    def _get_lock(self, namespace: str, key: str) -> asyncio.Lock:
        lock_key = f"{namespace}:{key}"
        if lock_key not in self._locks:
            self._locks[lock_key] = asyncio.Lock()
        return self._locks[lock_key]

    def _path_for(self, namespace: str, key: str) -> Path:
        directory = self.cache_root / namespace
        directory.mkdir(parents=True, exist_ok=True)
        return directory / f"{key}.json"

    def _read_entry(self, path: Path) -> Optional[Dict[str, Any]]:
        if not path.exists():
            return None
        try:
            entry = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            path.unlink(missing_ok=True)
            return None

        expires_at = datetime.fromisoformat(entry["expires_at"])
        if expires_at <= utcnow():
            self._expired += 1
            path.unlink(missing_ok=True)
            return None
        return entry

    async def get_or_set(
        self,
        *,
        namespace: str,
        key: str,
        ttl_seconds: int,
        factory: Callable[[], Awaitable[Any]],
    ) -> Tuple[Any, bool]:
        path = self._path_for(namespace, key)
        lock = self._get_lock(namespace, key)
        async with lock:
            entry = self._read_entry(path)
            if entry is not None:
                self._hits += 1
                return entry["payload"], True

            self._misses += 1
            payload = await factory()
            envelope = {
                "created_at": utcnow().isoformat(),
                "expires_at": (utcnow() + timedelta(seconds=ttl_seconds)).isoformat(),
                "source": "nasa_neows",
                "payload": payload,
            }
            path.write_text(json.dumps(envelope), encoding="utf-8")
            return payload, False

    def invalidate(
        self,
        *,
        scope: str,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        neo_id: Optional[str] = None,
    ) -> int:
        deleted = 0
        if scope == "all":
            targets = [self.cache_root / "feed", self.cache_root / "neo"]
            for target in targets:
                for path in target.glob("*.json"):
                    path.unlink(missing_ok=True)
                    deleted += 1
            return deleted

        if scope == "feed" and start_date and end_date:
            path = self._path_for("feed", f"{start_date}_{end_date}")
            if path.exists():
                path.unlink()
                deleted += 1
            return deleted

        if scope == "neo" and neo_id:
            path = self._path_for("neo", neo_id)
            if path.exists():
                path.unlink()
                deleted += 1
            return deleted

        return deleted

    def get_stats(self) -> Dict[str, Any]:
        entries = 0
        size_bytes = 0
        for path in self.cache_root.glob("*/*.json"):
            entry = self._read_entry(path)
            if entry is None:
                continue
            entries += 1
            size_bytes += path.stat().st_size

        total = self._hits + self._misses
        hit_ratio = round(self._hits / total, 4) if total else 0.0
        return {
            "entries": entries,
            "size_bytes": size_bytes,
            "hit_ratio": hit_ratio,
            "expired_entries": self._expired,
        }
