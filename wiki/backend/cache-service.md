---
tags: [backend, service]
updated: 2026-05-12
related: [neo-service, caching-strategy, config, data-flow]
---

# cache_service.py

**Percorso**: `backend/app/services/cache_service.py`

## Purpose

Cache file-based con envelope JSON. Evita chiamate ridondanti alla NASA API memorizzando le risposte su disco con TTL. Usa lock asincroni per evitare race conditions su richieste concorrenti alla stessa chiave.

---

## Key symbols

### `CacheService`

**Stato interno**:
```python
cache_root: Path                  # root directory della cache
_locks: Dict[str, asyncio.Lock]  # un Lock per ogni (namespace, key)
_hits: int                        # contatore accessi cache validi
_misses: int                      # contatore cache miss
_expired: int                     # contatore entry scadute trovate
```

**Metodi pubblici**:

| Metodo | Firma semplificata | Descrizione |
|--------|--------------------|-------------|
| `get_or_set` | `(namespace, key, ttl_seconds, factory) → (payload, is_hit)` | get-or-compute thread-safe |
| `invalidate` | `(scope, start_date?, end_date?, neo_id?) → int` | cancella entry per scope |
| `get_stats` | `() → Dict` | ritorna metriche cache live |

### `get_or_set` — pattern centrale

```python
async with lock:  # lock per-key, evita stampede cache
    entry = _read_entry(path)
    if entry is not None:   # HIT
        _hits += 1
        return entry["payload"], True
    
    _misses += 1
    payload = await factory()   # chiama NASA API
    envelope = {
        "created_at": ...,
        "expires_at": ...,
        "source": "nasa_neows",
        "payload": payload
    }
    path.write_text(json.dumps(envelope))
    return payload, False
```

### `_read_entry` — validazione envelope

1. File non esiste → `None`
2. JSON corrotto → cancella file, ritorna `None`
3. `expires_at <= now` → cancella file, incrementa `_expired`, ritorna `None`
4. Altrimenti → ritorna envelope dict

### `invalidate` — scoping

| scope | parametri aggiuntivi | cosa cancella |
|-------|---------------------|---------------|
| `"all"` | — | tutti i file in `cache/feed/` e `cache/neo/` |
| `"feed"` | `start_date`, `end_date` | file singolo `feed/YYYY-MM-DD_YYYY-MM-DD.json` |
| `"neo"` | `neo_id` | file singolo `neo/{neo_id}.json` |

### `get_stats` — metriche live

Itera `cache_root/*/*.json`, salta gli scaduti, ritorna:
```python
{
    "entries": int,          # file validi
    "size_bytes": int,       # somma dimensioni
    "hit_ratio": float,      # hits / (hits + misses)
    "expired_entries": int   # scaduti trovati dalla nascita del processo
}
```

---

## Layout su disco

```
backend/cache/
├── feed/
│   ├── 2025-01-01_2025-01-07.json
│   └── 2025-01-08_2025-01-14.json
└── neo/
    └── 3542519.json
```

Ogni file è un envelope:
```json
{
  "created_at": "2025-01-01T10:00:00+00:00",
  "expires_at": "2025-01-01T22:00:00+00:00",
  "source": "nasa_neows",
  "payload": { ... }
}
```

---

## Dependencies

- `asyncio` — Lock per-chiave
- `pathlib.Path` — I/O file system

## Used by

- [[neo-service]] — chiama `get_or_set` per ogni chunk feed e per ogni neo detail
- [[routes]] — `routes_cache.py` chiama `invalidate()`, `routes_health.py` chiama `get_stats()`
- [[main]] — istanziato nel lifespan

---

## Notes

- Il lock è **per-key** (non globale): richieste a chunk diversi sono concorrenti, richieste allo stesso chunk si accodano.
- Il `_expired` counter conta solo le scadute *trovate* durante i read, non quelle già cancellate da sessioni precedenti.
- Non c'è pulizia periodica (GC): le entry scadute vengono trovate e cancellate solo alla prossima lettura.
