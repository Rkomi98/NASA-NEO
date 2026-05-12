# Arkemis NEO Dashboard — Architettura

## Struttura del progetto

```
/
├── frontend/                  # Next.js 15 app
│   ├── app/
│   │   ├── layout.tsx         # Root layout (metadata, theme)
│   │   ├── page.tsx           # Homepage → DashboardClient
│   │   ├── error.tsx          # Error boundary App Router
│   │   ├── loading.tsx        # Loading boundary App Router
│   │   └── neo/[id]/page.tsx  # Deep link standalone asteroide
│   ├── components/
│   │   ├── dashboard-client.tsx  # Componente root (state, filtri, UI)
│   │   └── charts.tsx            # Grafici ECharts (2D scatter, bar, 3D orbital)
│   └── lib/
│       ├── api.ts             # Fetch wrappers (getFeed, getNeo, getHealth)
│       ├── types.ts           # TypeScript interfaces (allineate con backend Pydantic)
│       ├── constants.ts       # DEFAULT_DAYS, SORT_OPTIONS, HAZARD_FILTERS
│       ├── formatters.ts      # Formattatori (numeri, km, date)
│       └── utils.ts           # Utility condivise (getOrbitClassType, getOrbitPaletteColor)
│
├── backend/                   # FastAPI app
│   ├── app/
│   │   ├── main.py            # Entry point FastAPI (lifespan, middleware, routers)
│   │   ├── dependencies.py    # Dependency injection (get_neo_service)
│   │   ├── observability.py   # MetricsMiddleware Prometheus
│   │   ├── api/
│   │   │   ├── routes_feed.py    # GET /api/feed
│   │   │   ├── routes_neo.py     # GET /api/neo/{id}
│   │   │   ├── routes_health.py  # GET /api/health + GET /health (compat)
│   │   │   ├── routes_cache.py   # POST /api/cache/invalidate
│   │   │   └── routes_metrics.py # GET /metrics
│   │   ├── services/
│   │   │   ├── neo_service.py    # Orchestrazione (chunking, flatten, stats)
│   │   │   ├── nasa_client.py    # httpx client NASA API (retry, rate limit)
│   │   │   └── cache_service.py  # Cache file JSON (TTL, locking)
│   │   ├── models/
│   │   │   └── schemas.py        # Pydantic models (FeedResponse, NeoDetailResponse, etc.)
│   │   ├── utils/
│   │   │   └── dates.py          # parse_iso_date, validate_range, chunk_date_range
│   │   └── core/
│   │       ├── config.py         # Pydantic Settings (env vars, TTL, limiti)
│   │       └── errors.py         # APIError, UpstreamAPIError custom
│   ├── cache/                 # Cache file runtime (gitignored)
│   └── tests/                 # pytest test suite
│
├── docs/                      # Documentazione
│   ├── features.md            # Feature implementate e flusso dati
│   ├── api.md                 # Endpoint reference
│   ├── architecture.md        # Questo file
│   ├── deployment-guide.md    # Istruzioni di deploy
│   └── neo-data-display-ideas.md  # Idee future di visualizzazione
│
└── assets/                    # Logo SVG e risorse statiche
```

---

## Componenti React

| Componente | File | Responsabilità |
|-----------|------|---------------|
| `DashboardClient` | `components/dashboard-client.tsx` | Root component: gestisce tutto lo state (feed, health, detail, range, filtri), orchestrazione sezioni e layout |
| `DistanceOverTimeChart` | `components/charts.tsx` | Scatter 2D: distanza Terra vs. data (ECharts) |
| `SizeDistributionChart` | `components/charts.tsx` | Bar chart: distribuzione asteroidi per classe di diametro (ECharts) |
| `Orbital3DChart` | `components/charts.tsx` | Vista orbitale 3D WebGL con pianeti + asteroidi (ECharts GL) |
| `DashboardSkeleton` | `components/dashboard-client.tsx` | Placeholder layout durante il caricamento |
| `StateCard` | `components/dashboard-client.tsx` | Card generica per stati (loading, error, empty) |
| `DetailContent` | `components/dashboard-client.tsx` | Pannello dettaglio asteroide (modal o standalone) |

### Pattern State Management

Tutto lo stato è centralizzato in `DashboardClient` tramite `useState` e `useTransition`. Non ci sono store globali (Redux, Zustand, etc.) — la semplicità del dominio non lo richiede.

```
DashboardClient state:
├─ feed: FeedResponse | null         (dati dal backend)
├─ health: HealthResponse | null     (stato cache/rate limit)
├─ neoDetail: NeoDetailResponse | null  (dettaglio aperto)
├─ range: { start, end }             (date selezionate)
├─ hazardFilter: HazardFilter        (filtro pericolosità)
├─ sortKey: SortKey                  (campo ordinamento)
├─ loading: boolean
└─ error: string | null
```

---

## Servizi Backend

### NeoService (`services/neo_service.py`)

Orchestratore principale. Chiamato dagli endpoint router tramite dependency injection.

```
get_feed(start, end)
  → chunk_date_range() → chunk list
  → asyncio.gather: _fetch_chunk() per ogni chunk (max 2 concurrent)
  → _flatten_chunk(): nested NASA → array flat di FeedEvent
  → _build_stats(): KPI aggregati
  → return FeedResponse

get_neo_detail(neo_id)
  → CacheService.get_or_set("neo", neo_id, ...)
  → NasaNeoClient.fetch_neo(neo_id)
  → return NeoDetailResponse
```

### NasaNeoClient (`services/nasa_client.py`)

Wrapper httpx asincrono verso la NASA NeoWs API. Gestisce:
- Aggiunta automatica `api_key` a ogni request
- Retry (2 tentativi, pausa 0.4s) su `httpx.TimeoutException`
- Tracciamento header rate limit (`X-RateLimit-Limit`, `X-RateLimit-Remaining`)
- Raise di `UpstreamAPIError` per status != 200

### CacheService (`services/cache_service.py`)

Cache file-based JSON con:
- TTL configurabile per namespace (default: 12h feed, 72h detail)
- `asyncio.Lock` per evitare race condition su file concorrenti
- `get_or_set(namespace, key, factory_fn, ttl)` — pattern cache-aside
- `invalidate(namespace, key?)` — rimozione selettiva o completa
- `get_stats()` — entries, dimensione disco, hit ratio, scadute

---

## Pattern Dependency Injection (FastAPI)

I servizi sono inizializzati **una sola volta** durante il lifespan di FastAPI e salvati in `app.state`:

```python
# main.py lifespan
app.state.cache = CacheService(settings.CACHE_DIR)
app.state.nasa = NasaNeoClient(settings.NASA_API_KEY)
app.state.neo_service = NeoService(app.state.nasa, app.state.cache)
```

Gli endpoint li ricevono tramite `Depends(get_neo_service)` in `dependencies.py`, che legge da `request.app.state`.

---

## Cache Strategy

```
Richiesta frontend → Backend
        ↓
CacheService.get_or_set(namespace, key, factory, ttl)
        ↓
   ┌── File esiste E non scaduto? ──→ return payload da disco
   │
   └── No → chiama factory() → salva su disco → return payload
```

I file sono nominati `{namespace}/{key}.json` dove:
- `namespace = "feed"`, `key = "{start_date}_{end_date}"` (chunk 7 giorni)
- `namespace = "neo"`, `key = "{neo_id}"`

---

## Versioni dipendenze

### Frontend

| Dipendenza | Versione |
|-----------|---------|
| next | 15.3.1 |
| react | 19.1.0 |
| typescript | 5.8.3 |
| echarts | 5.6.0 |
| echarts-gl | 2.0.9 |

### Backend

| Dipendenza | Versione |
|-----------|---------|
| fastapi | 0.115.12 |
| httpx | 0.28.1 |
| pydantic | 1.10.15 |
| uvicorn | 0.34.2 |
| prometheus-client | 0.22.0 |
| python-dotenv | 1.0.1 |
| pytest | 8.3.5 |
| pytest-asyncio | 0.26.0 |

---

## Avvio in sviluppo

```bash
# Backend
cd backend
cp ../.env.example .env   # configura NASA_API_KEY
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Frontend (in un altro terminale)
cd frontend
npm install
npm run dev   # avvia su http://localhost:3000
```

La variabile d'ambiente `NEXT_PUBLIC_BACKEND_URL` nel frontend (default: `http://localhost:8000`) controlla dove vengono inviati i fetch.
