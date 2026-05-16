import asyncio
import json
import os
from collections import OrderedDict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, Optional, Tuple


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class CacheService:
    LOCK_LIMIT = 1024

    def __init__(self, cache_root: Path) -> None:
        self.cache_root = cache_root.resolve()
        self.cache_root.mkdir(parents=True, exist_ok=True)
        self._locks: "OrderedDict[str, asyncio.Lock]" = OrderedDict()
        self._hits = 0
        self._misses = 0
        self._expired = 0

    def _get_lock(self, namespace: str, key: str) -> asyncio.Lock:
        lock_key = f"{namespace}:{key}"
        lock = self._locks.get(lock_key)
        if lock is not None:
            self._locks.move_to_end(lock_key)
            return lock
        lock = asyncio.Lock()
        self._locks[lock_key] = lock
        self._evict_idle_locks()
        return lock

    def _evict_idle_locks(self) -> None:
        while len(self._locks) > self.LOCK_LIMIT:
            evicted = False
            for old_key, old_lock in list(self._locks.items()):
                if not old_lock.locked():
                    self._locks.pop(old_key, None)
                    evicted = True
                    break
            if not evicted:
                return

    def _path_for(self, namespace: str, key: str) -> Path:
        directory = (self.cache_root / namespace).resolve()
        candidate = (directory / f"{key}.json").resolve()
        if not str(candidate).startswith(str(self.cache_root) + os.sep):
            raise ValueError(f"invalid cache key for namespace {namespace!r}")
        directory.mkdir(parents=True, exist_ok=True)
        return candidate

    def _peek_entry(self, path: Path) -> Optional[Dict[str, Any]]:
        if not path.exists():
            return None
        try:
            entry = json.loads(path.read_text(encoding="utf-8"))
            expires_at = datetime.fromisoformat(entry["expires_at"])
        except (json.JSONDecodeError, KeyError, ValueError):
            return None
        if expires_at <= utcnow():
            return None
        return entry

    def _read_entry(self, path: Path) -> Optional[Dict[str, Any]]:
        if not path.exists():
            return None
        try:
            entry = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            path.unlink(missing_ok=True)
            return None

        try:
            expires_at = datetime.fromisoformat(entry["expires_at"])
        except (KeyError, ValueError):
            path.unlink(missing_ok=True)
            return None

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
            self._atomic_write(path, envelope)
            return payload, False

    @staticmethod
    def _atomic_write(path: Path, envelope: Dict[str, Any]) -> None:
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(json.dumps(envelope), encoding="utf-8")
        os.replace(tmp, path)

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

    async def get_stats(self) -> Dict[str, Any]:
        return await asyncio.to_thread(self._collect_stats)

    def _collect_stats(self) -> Dict[str, Any]:
        entries = 0
        size_bytes = 0
        for path in self.cache_root.glob("*/*.json"):
            entry = self._peek_entry(path)
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
