---
tags: [architecture]
updated: 2026-05-12
related: [data-flow, stack, main, dashboard-client]
---

# System Overview

## Purpose

Arkemis NEO Dashboard è una web app che visualizza i Near Earth Objects (asteroidi e comete in prossimità della Terra) tramite i dati della NASA NeoWs API. Il sistema si divide in due processi separati: un proxy backend FastAPI e un'app frontend Next.js.

---

## Architettura a tre livelli

```
┌─────────────────────────────────────────────────────┐
│  Browser (Next.js SSR/CSR)                          │
│  dashboard-client.tsx → charts.tsx                  │
└───────────────────┬─────────────────────────────────┘
                    │ HTTP (CORS)
┌───────────────────▼─────────────────────────────────┐
│  Backend (FastAPI / Uvicorn)                        │
│  routes → neo-service → cache-service               │
│                       → nasa-client                 │
│  observability (Prometheus)                         │
└───────────────────┬─────────────────────────────────┘
                    │ HTTPS (NASA NeoWs)
┌───────────────────▼─────────────────────────────────┐
│  NASA NeoWs API                                     │
│  /feed  /neo/{id}                                   │
└─────────────────────────────────────────────────────┘
                    │ File I/O
┌───────────────────▼─────────────────────────────────┐
│  File Cache (JSON files)                            │
│  backend/cache/feed/*.json                          │
│  backend/cache/neo/*.json                           │
└─────────────────────────────────────────────────────┘
```

---

## Responsabilità per layer

| Layer | Responsabilità | Tecnologia |
|-------|---------------|------------|
| Frontend | UI, filtri, sorting, chart 3D | Next.js 15, React 19, ECharts-GL |
| Backend | proxy, cache, aggregazione, validazione | FastAPI, httpx, Pydantic |
| Cache | evita chiamate NASA ridondanti | file JSON con envelope TTL |
| NASA API | dati grezzi NEO | REST API, rate limit 1000 req/h |

---

## Confini e decisioni chiave

- **Nessun DB**: la cache è file-based (`backend/cache/`). Semplicità > infrastruttura.
- **Chunking 7 giorni**: la NASA API accetta range massimo di 7 giorni per `/feed`. Il backend spezza automaticamente range più lunghi.
- **TTL differenziati**: feed cache 12h (dati che cambiano frequentemente), neo detail 72h (dati orbitali stabili).
- **Concorrenza limitata**: max 2 richieste simultanee a NASA (semaphore in `neo-service`).
- **Frontend stateless**: nessuna sessione, nessun auth. Tutti i dati vengono dal backend.

---

## Link correlati

- [[data-flow]] — flusso passo-passo di una richiesta
- [[stack]] — versioni e librerie
- [[main]] — punto di ingresso backend
- [[dashboard-client]] — punto di ingresso frontend
- [[caching-strategy]] — dettagli sulla cache
- [[date-chunking]] — dettagli sul chunking
