---
tags: [navigation, index]
updated: 2026-05-12
---

# Arkemis NEO Dashboard — Wiki

Hub di navigazione per il knowledge graph del repo. Apri questa cartella in **Obsidian → Graph View** per vedere la mappa delle dipendenze come grafo navigabile.

---

## Architettura

- [[system-overview]] — architettura end-to-end, confini tra backend e frontend
- [[data-flow]] — flusso richiesta feed e detail, dalla UI alla NASA API
- [[stack]] — tech stack completo con versioni

---

## Backend (FastAPI / Python)

- [[main]] — FastAPI app, lifespan, middleware registrati
- [[config]] — Settings Pydantic, variabili d'ambiente, TTL
- [[nasa-client]] — HTTP client verso NASA NeoWs, retry, rate limit
- [[cache-service]] — file-based cache con lock asincrono e envelope JSON
- [[neo-service]] — orchestration layer: chunking, concorrenza, flatten, stats
- [[schemas]] — Pydantic models: FeedResponse, NeoDetailResponse, HealthResponse…
- [[routes]] — tutti gli endpoint REST (feed, neo, health, cache, metrics)
- [[observability]] — Prometheus Counter + Histogram, MetricsMiddleware

---

## Frontend (Next.js / TypeScript)

- [[dashboard-client]] — componente principale, state machine UI, sezioni
- [[charts]] — Orbital3DChart ECharts-GL, meccanica orbitale Kepleriana
- [[api-layer]] — fetch wrapper, getFeed / getNeo / getHealth

---

## Concetti trasversali

- [[caching-strategy]] — TTL differenziati, namespace, hit ratio, envelope
- [[date-chunking]] — 7-day chunks, NASA API limit, semaphore concorrenza
- [[nasa-api]] — NASA NeoWs endpoints, rate limit headers, codici errore

---

## Grafo delle dipendenze chiave

```
DashboardClient → api-layer → [GET /api/feed, GET /api/neo/{id}]
                                    ↓                    ↓
                            routes_feed          routes_neo
                                    ↓                    ↓
                            neo-service          neo-service
                             ↙       ↘            ↙
                    cache-service  nasa-client  cache-service
                         ↓               ↓
                   cache/*.json    NASA NeoWs API
```
