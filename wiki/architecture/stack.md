---
tags: [architecture, stack]
updated: 2026-05-12
related: [system-overview, main, dashboard-client]
---

# Stack tecnologico

## Backend

| Libreria | Versione | Ruolo |
|----------|---------|-------|
| Python | 3.9+ | runtime |
| FastAPI | 0.115.12 | framework HTTP, DI, OpenAPI |
| Uvicorn | 0.34.2 | ASGI server |
| httpx | 0.28.1 | HTTP client asincrono verso NASA |
| Pydantic | 1.10.15 | validazione/serializzazione modelli |
| prometheus-client | 0.22.0 | metriche Prometheus |
| python-dotenv | 1.0.1 | caricamento .env |
| pytest | 8.3.5 | test runner |
| pytest-asyncio | 0.26.0 | test asincroni |

---

## Frontend

| Libreria | Versione | Ruolo |
|----------|---------|-------|
| Node.js | - | runtime |
| Next.js | 15.3.1 | framework (App Router) |
| React | 19.1.0 | UI component library |
| TypeScript | 5.8.3 | type system (strict mode) |
| ECharts | 5.6.0 | chart engine |
| echarts-gl | 2.0.9 | estensione 3D per ECharts |

---

## Scelte architetturali notevoli

- **Pydantic v1** (non v2): la dipendenza `pydantic==1.10.15` usa l'API v1 (`.dict()`, `BaseSettings` da `pydantic`). Attenzione se si aggiorna.
- **Next.js App Router**: usa `app/` directory, non `pages/`. Route dinamica `/neo/[id]/page.tsx`.
- **ECharts-GL**: lazy-loaded in un custom hook `useChart` per evitare SSR issues. Richiede canvas WebGL.
- **httpx AsyncClient**: inizializzato nel `lifespan` context e riusato per tutte le richieste. Non viene creato per ogni request.
- **File cache**: volutamente semplice. Nessun Redis, nessuna dipendenza infrastrutturale aggiuntiva.

---

## Link correlati

- [[system-overview]] — architettura generale
- [[main]] — startup FastAPI e lifespan
- [[observability]] — prometheus-client usage
- [[charts]] — echarts-gl usage
