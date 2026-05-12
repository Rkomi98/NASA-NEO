---
tags: [concept, caching]
updated: 2026-05-12
related: [cache-service, neo-service, config, data-flow]
---

# Caching Strategy

## What it is

Cache file-based con envelope JSON e TTL differenziati per tipo di dato. Ogni chunk di feed e ogni dettaglio NEO viene salvato come file `.json` separato nella directory `backend/cache/`.

---

## Architettura

```
backend/cache/
├── feed/
│   └── {start}_{end}.json     # es. 2025-01-01_2025-01-07.json
└── neo/
    └── {neo_id}.json          # es. 3542519.json
```

Ogni file contiene un **envelope**:
```json
{
  "created_at": "2025-01-01T10:00:00+00:00",
  "expires_at": "2025-01-01T22:00:00+00:00",
  "source": "nasa_neows",
  "payload": { ...raw NASA data... }
}
```

---

## TTL differenziati

| Tipo | TTL | Motivazione |
|------|-----|-------------|
| Feed (chunk 7gg) | 12 ore | I dati di approccio cambiano raramente, ma nuovi asteroidi scoperti possono aggiornare il catalogo nel corso della giornata |
| NEO detail | 72 ore | I dati orbitali sono molto stabili — cambiano solo con nuove osservazioni astronomiche |

---

## Why this approach

- **Nessuna infrastruttura aggiuntiva**: niente Redis, niente Memcached. Un file system è sufficiente per i volumi attesi.
- **Debuggabilità**: i file cache sono leggibili con qualsiasi editor. Facile ispezionare cosa è stato cachato.
- **Lock per-chiave**: `asyncio.Lock` per `(namespace, key)` evita race conditions (stampede cache) quando più richieste arrivano simultaneamente per lo stesso chunk.
- **Invalidazione esplicita**: l'endpoint `POST /api/cache/invalidate` permette di forzare refresh senza riavviare il server.

---

## Where it's used

- [[neo-service]] — `_fetch_chunk()` e `get_neo_detail()` usano entrambi `cache_service.get_or_set()`
- [[routes]] — `routes_cache.py` (invalidate), `routes_health.py` (stats)
- [[dashboard-client]] — la sezione `info` mostra `hit_ratio`, `entries`, `size_bytes`

---

## Trade-offs

| Pro | Contro |
|-----|--------|
| Zero dipendenze infrastrutturali | Non distribuibile (nessuna condivisione cache tra processi) |
| File cache debuggabili | I/O disco più lento di Redis in-memory |
| Invalidazione granulare per chunk | Nessuna eviction automatica (solo TTL check on-read) |
| Resistente a restart (persistente su disco) | Il `hit_ratio` si resetta ad ogni riavvio (contatori in-memory) |

---

## Note operative

- La cache non ha pulizia automatica (garbage collection). File scaduti vengono trovati e cancellati solo alla prossima lettura. In produzione su range lunghi (es. 365gg = ~52 chunks) il disco può riempirsi.
- Il `hit_ratio` nella health response è calcolato dall'avvio del processo, non su una finestra temporale.
- Se il JSON di un file cache è corrotto, `_read_entry` lo cancella silenziosamente e triggera un re-fetch.
