---
tags: [frontend]
updated: 2026-05-12
related: [dashboard-client, schemas, data-flow]
---

# api-layer (api.ts + types.ts + constants.ts)

**Percorsi**:
- `frontend/lib/api.ts` — fetch wrapper e funzioni esportate
- `frontend/lib/types.ts` — TypeScript interfaces
- `frontend/lib/constants.ts` — costanti globali

## Purpose

Layer di comunicazione tra il frontend React e il backend FastAPI. Fornisce funzioni tipizzate per ogni endpoint, un wrapper comune per error handling, e le costanti di configurazione.

---

## Key symbols

### `api.ts`

#### `request<T>(path, init?) → Promise<T>`

Fetch wrapper interno (non esportato):
- Aggiunge `Content-Type: application/json` se body presente
- `cache: "no-store"` — disabilita la cache HTTP del browser (dati real-time)
- Se `!response.ok`: estrae `payload.error.message` o fallback su status code
- Augmenta l'Error con `.status` e `.code` per error handling granulare nel componente

#### `getFeed(startDate, endDate, signal?) → Promise<FeedResponse>`

```
GET /api/feed?start_date={startDate}&end_date={endDate}
```

#### `getNeo(neoId, signal?) → Promise<NeoDetailResponse>`

```
GET /api/neo/{neoId}
```

#### `getHealth(signal?) → Promise<HealthResponse>`

```
GET /api/health
```

Tutte e tre accettano un `AbortSignal` opzionale per cancellazione (usato in `dashboard-client.tsx` con `AbortController` quando cambia range o componente).

---

### `types.ts` — TypeScript mirror di schemas.py

| Interface | Mirror di |
|-----------|----------|
| `FeedEvent` | `FeedEvent` Pydantic |
| `FeedResponse` | `FeedResponse` Pydantic |
| `NeoDetailResponse` | `NeoDetailResponse` Pydantic |
| `HealthResponse` | `HealthResponse` Pydantic |
| `ApiErrorShape` | formato errore `{ error: { code, message, details } }` |
| `HazardFilter` | `"all" \| "hazardous" \| "safe"` |
| `SortKey` | `"approach_date" \| "miss_distance_km" \| ...` |

**Nota**: `orbital_data: Record<string, unknown>` è volutamente vago — la struttura NASA varia per asteroide.

---

### `constants.ts`

| Costante | Valore | Uso |
|----------|--------|-----|
| `DEFAULT_DAYS` | `30` | range default per il date picker |
| `BACKEND_BASE_URL` | `env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000"` | base URL per tutte le fetch |
| `SORT_OPTIONS` | array config | label + key per il select sort |
| `HAZARD_FILTERS` | array config | label + value per i filtri |

---

## Dependencies

- `fetch` (browser native)
- [[schemas]] — contratto API (TypeScript mirror)

## Used by

- [[dashboard-client]] — importa `getFeed`, `getNeo`, `getHealth`

---

## Notes

- `cache: "no-store"` bypassa sia il browser cache che il Next.js data cache. Corretto per una dashboard real-time.
- L'augmentazione dell'Error con `.status` e `.code` è un pattern comune ma non type-safe (usa `as Error & { status?: number }`). Va bene per questo contesto.
- `BACKEND_BASE_URL` usa `NEXT_PUBLIC_` prefix — obbligatorio in Next.js per le env var esposte al client bundle.
