---
tags: [concept, nasa-api]
updated: 2026-05-12
related: [neo-service, config, nasa-api, data-flow, cache-service]
---

# Date Chunking

## What it is

La NASA NeoWs API accetta un range massimo di 7 giorni per endpoint per l'endpoint `/feed`. Per supportare range più lunghi (fino a 365gg), il backend divide automaticamente il range richiesto in chunk di 7 giorni e parallelizza le richieste.

---

## Implementazione

### `chunk_date_range(start, end, chunk_days=7)` — `backend/app/utils/dates.py`

```python
cursor = start
while cursor <= end:
    chunk_end = min(cursor + timedelta(days=chunk_days - 1), end)
    chunks.append((cursor, chunk_end))
    cursor = chunk_end + timedelta(days=1)
```

Esempio per range 2025-01-01 → 2025-01-20 (20 giorni):
```
(2025-01-01, 2025-01-07)  # 7 giorni
(2025-01-08, 2025-01-14)  # 7 giorni
(2025-01-15, 2025-01-20)  # 6 giorni (chunk finale più corto)
```

### Concorrenza controllata — `NeoService.get_feed()`

```python
semaphore = asyncio.Semaphore(settings.upstream_concurrency)  # = 2
chunk_results = await asyncio.gather(*[
    _fetch_chunk(chunk_start, chunk_end, semaphore)
    for chunk_start, chunk_end in chunks
])
```

`asyncio.gather` avvia tutti i task, il semaphore limita le chiamate NASA attive a max 2 simultanee. I task in eccesso attendono.

### Cache per chunk — chiave cache

Ogni chunk ha una chiave cache univoca: `f"{start.isoformat()}_{end.isoformat()}"`.
- Range 30gg → ~5 chunk → fino a 5 file cache
- Range 365gg → ~53 chunk → fino a 53 file cache

Se i chunk sono già in cache (hit), non viene fatta nessuna richiesta NASA.

---

## Why this approach

- **Limite NASA**: `/feed` rifiuta range > 7 giorni con 400 Bad Request.
- **Cache granulare**: chunk da 7gg sono ri-usabili tra richieste con range diversi che si sovrappongono. Es: richiesta 1-30 gennaio e richiesta 5-15 gennaio condividono i chunk `01-07` e `08-14`.
- **Parallelismo**: `asyncio.gather` + semaphore bilancia throughput e gentilezza verso le rate limit NASA.

---

## Where it's used

- [[neo-service]] — `get_feed()` chiama `chunk_date_range()` e `_fetch_chunk()`
- `backend/app/utils/dates.py` — implementazione `chunk_date_range()`
- [[config]] — `chunk_days = 7`, `upstream_concurrency = 2`

---

## Trade-offs

| Pro | Contro |
|-----|--------|
| Supporta range arbitrari fino a 365gg | N chunk = N file cache potenziali |
| Cache ri-usabile tra range sovrapposti | Il chunk finale può essere < 7gg (diverso dai precedenti) |
| Parallelismo controllato (no flood NASA) | Con 53 chunk e concurrency=2 → ~27 round-trip sequenziali per cache fredda |

---

## Note sul boundary

`_flatten_chunk` filtra le date fuori dal range `[start, end]` dell'intera richiesta (non del singolo chunk). Questo è necessario perché:
1. Il chunk finale può terminare prima di `end`
2. La NASA può restituire dati al confine del chunk leggermente fuori range
