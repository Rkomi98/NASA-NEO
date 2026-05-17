# Scelte di design

Tutte le decisioni non banali del progetto, scritte come si racconterebbero a un collega che entra in codebase senza contesto. Per ogni scelta: **cosa è stato deciso**, **dove vive nel codice** e **perché**. Le voci marcate con _Post-review_ raccontano come la decisione è cambiata dopo la code review.

> Questa pagina è la versione pubblica e organizzata di [backend/BACKEND_DECISIONS.md](../backend/BACKEND_DECISIONS.md). Il file backend resta come "memoria operativa" del refactor, qui trovi anche le scelte frontend e una vista d'insieme.

---

## Indice

| # | Decisione | Area | File principale |
|---|---|---|---|
| 1 | Lifespan async invece di `@app.on_event` | Backend / boot | [backend/app/main.py](../backend/app/main.py) |
| 2 | DI via `app.state` + thin `Depends` | Backend / DI | [backend/app/dependencies.py](../backend/app/dependencies.py) |
| 3 | Metriche Prometheus via middleware ASGI puro | Backend / observability | [backend/app/observability.py](../backend/app/observability.py) |
| 4 | `/metrics` e `/health` fuori dal prefisso `/api/` | Backend / routing | [backend/app/api/routes_metrics.py](../backend/app/api/routes_metrics.py), [backend/app/api/routes_health.py](../backend/app/api/routes_health.py) |
| 5 | CORS con regex localhost + credenziali | Backend / CORS | [backend/app/main.py](../backend/app/main.py) |
| 6 | `APIError` custom + handler globale | Backend / errori | [backend/app/core/errors.py](../backend/app/core/errors.py) |
| 7 | Cache file-based JSON su filesystem | Backend / cache | [backend/app/services/cache_service.py](../backend/app/services/cache_service.py) |
| 8 | Lock per-(namespace, key) con LRU bounded | Backend / concorrenza | [backend/app/services/cache_service.py](../backend/app/services/cache_service.py) |
| 9 | Separazione `NasaNeoClient` vs `NeoService` | Backend / arch | [backend/app/services/nasa_client.py](../backend/app/services/nasa_client.py) |
| 10 | Retry NASA: 3 tentativi, backoff + jitter, `Retry-After` | Backend / resilienza | [backend/app/services/nasa_client.py](../backend/app/services/nasa_client.py) |
| 11 | Stats cache esposte su `/api/health` | Backend / observability | [backend/app/api/routes_health.py](../backend/app/api/routes_health.py) |
| 12 | Chunking 7 giorni con cursor end-inclusive | Backend / chunking | [backend/app/utils/dates.py](../backend/app/utils/dates.py) |
| 13 | Schemi Pydantic in un singolo `schemas.py` | Backend / modelli | [backend/app/models/schemas.py](../backend/app/models/schemas.py) |
| 14 | Pydantic v1 invece di v2 | Backend / deps | [backend/requirements.txt](../backend/requirements.txt) |
| 15 | Settings via env + `.env`, no YAML/TOML | Backend / config | [backend/app/core/config.py](../backend/app/core/config.py) |
| 16 | Feature flag per `cache_router` | Backend / sicurezza | [backend/app/core/config.py](../backend/app/core/config.py), [backend/app/main.py](../backend/app/main.py) |
| 17 | Routing client-side via `page` state, non Next router | Frontend / arch | [frontend/components/dashboard-client.tsx](../frontend/components/dashboard-client.tsx) |
| 18 | Pagina standalone `/neo/[id]` che riusa lo stesso componente | Frontend / deep-link | [frontend/app/neo/\[id\]/page.tsx](../frontend/app/neo/[id]/page.tsx) |
| 19 | `cache: "no-store"` su tutte le fetch | Frontend / API layer | [frontend/lib/api.ts](../frontend/lib/api.ts) |
| 20 | `AbortController` su feed + dettaglio | Frontend / fetching | [frontend/components/dashboard-client.tsx](../frontend/components/dashboard-client.tsx) |
| 21 | Tema dark/light con CSS variables + custom event | Frontend / theming | [frontend/components/charts.tsx](../frontend/components/charts.tsx), [frontend/app/globals.css](../frontend/app/globals.css) |
| 22 | ECharts 2D + `OrbitCanvas` 2D nativo | Frontend / visual | [frontend/components/charts.tsx](../frontend/components/charts.tsx), [frontend/components/dashboard-client.tsx](../frontend/components/dashboard-client.tsx) |
| 23 | Filtri e sort client-side | Frontend / UX | [frontend/components/dashboard-client.tsx](../frontend/components/dashboard-client.tsx) |
| 24 | `useUtcClock` che parte da `null` | Frontend / SSR | [frontend/components/dashboard-client.tsx](../frontend/components/dashboard-client.tsx) |

---

## Backend

### 1. Lifespan async context manager invece di `@app.on_event`

**Dove**: [backend/app/main.py](../backend/app/main.py)

Bootstrap di `CacheService`, `NasaNeoClient`, `NeoService` dentro un `@asynccontextmanager`, salvati in `app.state`, con `await nasa_client.shutdown()` post-yield.

**Perché**: il pattern lifespan garantisce che `aclose()` del client httpx avvenga in modo deterministico anche su errori del worker — `on_event("shutdown")` non sempre viene chiamato. Setup e teardown nella stessa funzione, niente handler separati che si scambiano stato globale. Inoltre `on_event` è deprecato in Starlette ≥ 0.26.

---

### 2. DI via `app.state` + thin wrapper `Depends`

**Dove**: [backend/app/dependencies.py](../backend/app/dependencies.py)

I servizi singleton sono creati nel lifespan e salvati in `app.state`. Le dependency FastAPI sono solo funzioni che leggono `request.app.state.<service>`.

**Perché**: abilita gli override standard FastAPI nei test (`app.dependency_overrides[get_neo_service] = ...`) ed evita import circolari — `main.py` importa i servizi, le route importano solo `dependencies`.

---

### 3. Metriche Prometheus via middleware ASGI puro

**Dove**: [backend/app/observability.py](../backend/app/observability.py)

Middleware fatto a mano (non `BaseHTTPMiddleware`) che misura latenza e conta richieste con label `(method, path, status_code)`.

**Perché**: controllo totale sulle label, nessuna dipendenza aggiuntiva, ~30 righe.

**Post-review**: la versione originale era un `BaseHTTPMiddleware` che leggeva `request.scope["route"]` **prima** di `call_next`, quando il Router non aveva ancora matchato la rotta. Risultato: la label `path` cadeva sempre su `request.url.path`, esponendo l'id concreto come label Prometheus (cardinality esplosa, una time-series per ogni `neo_id`). La nuova implementazione è un middleware ASGI puro che condivide lo scope con il Router e legge `scope["route"]` dopo il dispatch — la label `path` ora è il template (`/api/neo/{neo_id}`).

---

### 4. `/metrics` e `/health` (compat) fuori dal prefisso `/api/`

**Dove**: [backend/app/api/routes_metrics.py](../backend/app/api/routes_metrics.py), [backend/app/api/routes_health.py](../backend/app/api/routes_health.py)

Endpoint operazionali su path top-level (`/metrics`, `/health`) + duplicato `/api/health` "ufficiale". I top-level hanno `include_in_schema=False`.

**Perché**: probe Kubernetes e scrape Prometheus cercano per convenzione `/metrics` e `/health` top-level. Tenerli fuori dallo schema OpenAPI evita di pubblicizzare endpoint operativi.

---

### 5. CORS `allow_credentials=True` + `allow_origin_regex` + `allow_methods=["*"]`

**Dove**: [backend/app/main.py](../backend/app/main.py), [backend/app/core/config.py](../backend/app/core/config.py)

Lista esplicita di origin + regex `^https?://(localhost|127\.0\.0\.1):[0-9]+$`, credenziali abilitate, metodi e header tutti.

**Perché**: la regex copre i preview deploy dove la porta è dinamica (es. `next dev` su una porta libera qualsiasi). `["*"]` su methods/headers evita di aggiornare la config a ogni nuovo endpoint. SPA Next.js separato che invia cookie richiede `allow_credentials=True`.

> Aperto: in prod il regex localhost va override-ato esplicitamente via `ALLOWED_ORIGIN_REGEX`. Vale la pena rendere `allow_credentials` un setting per disabilitarlo quando non servono cookie cross-origin.

---

### 6. `APIError` custom + handler globale

**Dove**: [backend/app/core/errors.py](../backend/app/core/errors.py), [backend/app/main.py](../backend/app/main.py)

Gerarchia di eccezioni con `code` / `message` / `details` e un handler che le converte in `{error: {code, message, details}}`.

**Perché**: separa il dominio dal trasporto HTTP. Codici machine-readable per il frontend senza accoppiare le utility a FastAPI. Un solo handler invece di `try/except` in ogni route: nessuna route ha try/except — il pattern è "raise nelle service, catch globale".

---

### 7. Cache file-based JSON su filesystem

**Dove**: [backend/app/services/cache_service.py](../backend/app/services/cache_service.py)

Cache persistente come file JSON in `cache_root/<namespace>/<key>.json`.

**Perché**: persistenza tra restart senza infra esterna; zero Redis, zero container extra. In un contesto educational/take-home un file JSON è ispezionabile con `cat`. Riduce la pressione sulla quota NASA in single-instance.

**Post-review**: aggiunte tre proprietà.
- **Write atomico**: scrittura su `.json.tmp` + `os.replace` per evitare file troncati su crash o lettori concorrenti.
- **Difesa in profondità path traversal**: `_path_for` risolve i path e verifica `is_relative_to(cache_root)`. Una chiave malevola solleva `ValueError` invece di scrivere fuori dalla cache root.
- **`get_stats` non distruttivo e async**: usa `_peek_entry` (non cancella file scaduti) e gira su `asyncio.to_thread` per non bloccare l'event loop. L'eviction delle entry scadute resta in `_read_entry` (path del `get_or_set`), come deve essere.

---

### 8. Lock per-(namespace, key) con LRU bounded

**Dove**: [backend/app/services/cache_service.py](../backend/app/services/cache_service.py)

Un `asyncio.Lock` separato per ogni coppia (namespace, key), creato pigramente.

**Perché**: single-flight reale. Due richieste concorrenti per lo stesso chunk attendono una sola chiamata NASA, ma chunk diversi non si bloccano. Un lock globale serializzerebbe troppo `get_feed` (che fa più chunk in parallelo). La combinazione con `asyncio.Semaphore(upstream_concurrency)` è una progettazione consapevole di concorrenza e thundering herd.

**Post-review**: il dict originale era unbounded → memory leak con chiavi arbitrarie. Ora è un `OrderedDict` con `LOCK_LIMIT = 1024`, eviction LRU che salta i lock attualmente acquisiti (così non si crea un nuovo lock per una chiave già in uso, perdendo la sincronizzazione).

---

### 9. Separazione `NasaNeoClient` (HTTP + retry) vs `NeoService` (orchestrazione + cache)

**Dove**: [backend/app/services/nasa_client.py](../backend/app/services/nasa_client.py), [backend/app/services/neo_service.py](../backend/app/services/neo_service.py)

Client puro per la NASA API; service che fa chunking, caching, flatten e stats.

**Perché**: testabilità. Si può iniettare un client stub in `NeoService` senza monkeypatch su httpx. Cambiare provider richiede solo un nuovo client. Il `__init__` keyword-only di `NeoService` è la firma del DI test-friendly.

**Post-review**: il contratto del client è cambiato. `fetch_feed` e `fetch_neo` ora ritornano `(payload, upstream_snapshot)`. Lo snapshot è catturato per-request invece di essere letto da un campo condiviso post-`gather` (che produceva valori non deterministici quando i chunk completavano in parallelo). `NeoService.get_feed` aggrega gli snapshot e mette nel `meta.last_upstream_rate_limit` quello con `remaining` minimo — il caso pessimo, che è quello utile al client.

---

### 10. Retry NASA: 3 tentativi, backoff esponenziale + jitter, rispetto di `Retry-After`

**Dove**: [backend/app/services/nasa_client.py](../backend/app/services/nasa_client.py)

`MAX_ATTEMPTS = 3`, backoff esponenziale `0.4s * 2^attempt` con jitter uniforme, retry su timeout e 5xx. Su 429: retry solo se `Retry-After` è presente e ≤ 5s (`RETRY_AFTER_CAP_SECONDS`), altrimenti fail-fast con `retry_after_seconds` esposto al client.

**Perché**: NeoWs ha un rate limit orario. Ritentare un 429 senza informazioni è dannoso, ma se la NASA dice "tra 2 secondi" ha senso aspettare. Il cap a 5s evita di tenere bloccato un client troppo a lungo. La logica differenziata 429 vs 5xx vs timeout è una scelta informata sul comportamento di NeoWs, non un template generico.

**Post-review**: la versione iniziale aveva 2 tentativi, backoff fisso 0.4s, **nessun retry sul 429** e nessun rispetto di `Retry-After`. La filosofia "non spammare NASA" è rimasta, ma ora c'è:
- 3 tentativi con jitter contro burst sincroni.
- Backoff esponenziale via `_backoff_delay(attempt)`.
- Lettura di `Retry-After` su 429 e retry solo se il valore è "ragionevole" (≤ 5s).
- `retry_after_seconds` nei `details` dell'errore esposto al client.

---

### 11. Stats cache come stato in-memory esposto su `/api/health`

**Dove**: [backend/app/services/cache_service.py](../backend/app/services/cache_service.py), [backend/app/api/routes_health.py](../backend/app/api/routes_health.py)

Counter `_hits`, `_misses`, `_expired` come attributi mutabili, esposti via `get_stats()` async.

**Perché**: osservabilità senza StatsD/Prometheus per uno scope ridotto basta esporre via REST. `/api/health` deve poter dimostrare che la cache "funziona" durante una demo o uno smoke test. Il pattern "stats object" è familiare (vedi `functools.lru_cache.cache_info()`).

**Post-review**: `get_stats` originariamente era sincrono, faceva I/O bloccante sull'event loop e — sorpresa — cancellava le entry scadute come effetto collaterale (mescolando osservabilità ed eviction). Ora è `async` su `asyncio.to_thread` e usa `_peek_entry` non distruttivo.

---

### 12. Chunking 7 giorni con `chunk_days - 1` nel cursor

**Dove**: [backend/app/utils/dates.py](../backend/app/utils/dates.py), [backend/app/core/config.py](../backend/app/core/config.py)

Range diviso in finestre con `chunk_end = min(cursor + timedelta(days=chunk_days - 1), end)`, end-inclusive.

**Perché**: il `-1` è il classico fix off-by-one per range inclusivi (start+6 = 7 giorni in totale). 7 è il valore naturale della settimana e massimizza il payload per chiamata. Soprattutto: `/feed` NASA accetta **al massimo** 7 giorni, quindi il chunking è obbligatorio.

**Post-review**: `chunk_days` è ora vincolato a `Field(7, ge=1, le=7)` in config. L'invariante "≤ 7 giorni" è dichiarata nel tipo, non solo nei commenti. Un env `CHUNK_DAYS=30` viene rifiutato a startup invece di provocare errori a runtime su ogni chiamata.

---

### 13. Schemi tutti in un singolo `schemas.py`

**Dove**: [backend/app/models/schemas.py](../backend/app/models/schemas.py)

Tutti i modelli Pydantic (feed, neo, cache, health) in un solo file.

**Perché**: il dominio è piccolo (~10 modelli), splittarli complicherebbe gli import. Un solo `from app.models.schemas import ...` ovunque. Niente ORM, quindi non serve la distinzione schemas/models.

**Post-review**: aggiunte le costanti `ISO_DATE_REGEX` e `NEO_ID_REGEX` a livello modulo e applicate via `Field(..., regex=...)` su `CacheInvalidateRequest`. Aggiunto un `@root_validator` che richiede `start_date+end_date` quando `scope="feed"` e `neo_id` quando `scope="neo"`: combinazioni invalide ora ritornano 422 invece di un silenzioso `deleted=0`.

---

### 14. Pydantic v1 invece di v2

**Dove**: [backend/requirements.txt](../backend/requirements.txt) (`pydantic==1.10.15`)

Tutto il progetto è ancorato a Pydantic 1.x (`BaseSettings` nativo, `@validator`, `class Config`).

**Perché**: v1 ha `BaseSettings` nativo con `parse_env_var` custom; in v2 serve installare `pydantic-settings` separato. Il pin a 1.10.15 evita di migrare codice esistente.

> Aperto: Pydantic 1.10 va in EOL/security-only nel 2025–2026. Vale la pena pianificare la migrazione a v2 + `pydantic-settings` prima che diventi obbligatoria.

---

### 15. Settings via env + `.env`, no YAML/TOML

**Dove**: [backend/app/core/config.py](../backend/app/core/config.py)

Configurazione 12-factor, tutto via env var con fallback default in codice.

**Perché**: `nasa_api_key` è secret e deve stare fuori dal repo → env è l'unica opzione coerente. Una volta usata env per il secret, conviene uniformare tutto il resto. BaseSettings legge env + `.env` con zero boilerplate. Deploy in container inietta env: un file di config sarebbe da montare a parte.

**Post-review**:
- `Settings.Config.parse_env_var` è mantenuto solo per `allowed_origins`: con Pydantic 1.x serve a evitare il parse JSON anticipato di `BaseSettings` sulle env var complesse, così il validator può gestire CSV, JSON list, lista e stringa singola.
- Aggiunti bound Pydantic su tutti i numerici: `feed_ttl_seconds`, `neo_ttl_seconds`, `max_days`, `upstream_timeout_seconds`, `upstream_concurrency` hanno `gt=0` / `ge=1`. Configurazioni patologiche (`UPSTREAM_CONCURRENCY=0` deadlocka, `UPSTREAM_TIMEOUT_SECONDS=-1` rompe httpx) vengono rifiutate a startup. `chunk_days` è hard-bounded a `le=7`.
- `max_days` resta libero (default 365): per restringere il perimetro a 30 giorni basta `MAX_DAYS=30` come env var.

---

### 16. Feature flag per `cache_router` (nuova scelta post-review)

**Dove**: [backend/app/core/config.py](../backend/app/core/config.py), [backend/app/main.py](../backend/app/main.py)

`POST /api/cache/invalidate` esiste solo se `enable_admin_endpoints=True` (env `ENABLE_ADMIN_ENDPOINTS=1`). Default `False`: in produzione l'endpoint è invisibile, non risponde 401/403 — semplicemente non esiste.

**Perché**: un endpoint che non esiste è più sicuro di un endpoint protetto. Niente token da gestire, niente rotazione, niente rischio di leak. La superficie d'attacco è zero, non "ridotta". Non c'è ancora un sistema di auth: aggiungerlo solo per un endpoint admin sarebbe overkill rispetto al feature flag. Pattern "admin endpoints opt-in via env" comune in microservizi piccoli.

---

## Frontend

### 17. Routing client-side via `page` state, non Next router

**Dove**: [frontend/components/dashboard-client.tsx](../frontend/components/dashboard-client.tsx)

Le quattro pagine principali (`now`, `catalog`, `states`, `settings`) sono gestite da uno state `page: Page` dentro `DashboardClient`, senza passare dal router di Next.

**Perché**: la dashboard è una single-view con quattro modalità, non un sito multi-pagina. Mantenere lo state interno evita rerender forzati di Next, conserva lo state UI tra cambi pagina (filtri, scrubber, asteroide selezionato) e tiene il bundle leggero. La pagina standalone per il deep-link a un NEO usa lo stesso componente — vedi #18.

---

### 18. Pagina standalone `/neo/[id]` che riusa lo stesso componente

**Dove**: [frontend/app/neo/\[id\]/page.tsx](../frontend/app/neo/[id]/page.tsx)

La route App Router `/neo/[id]` rende `<DashboardClient standaloneNeoId={id} />`. Lo stesso componente che renderizza la home accetta una prop opzionale e, se presente, inizializza `pickedId` direttamente — il pannello dettaglio si apre senza interazione utente.

**Perché**: deep-link condivisibili per singolo NEO senza duplicare la UI. Un solo componente da mantenere, una sola fonte di verità per layout e tema.

---

### 19. `cache: "no-store"` su tutte le fetch

**Dove**: [frontend/lib/api.ts](../frontend/lib/api.ts)

Il wrapper interno `request<T>` passa `cache: "no-store"` a ogni `fetch`.

**Perché**: la cache "vera" vive nel backend (dove ha un TTL controllato per scope). Il browser non deve trattenere risposte vecchie. Bypassare anche il Next.js data cache è corretto per una dashboard che si presenta come real-time.

---

### 20. `AbortController` su feed + dettaglio

**Dove**: [frontend/components/dashboard-client.tsx](../frontend/components/dashboard-client.tsx)

Ogni `useEffect` di fetch crea un `AbortController` e ritorna `ac.abort()` come cleanup.

**Perché**: cambio rapido del range (slider, date picker) o selezione veloce di NEO diversi non deve produrre race condition. La risposta più vecchia non sovrascrive quella più recente perché è già cancellata.

---

### 21. Tema dark/light con CSS variables + custom event `arkemis-theme`

**Dove**: [frontend/components/charts.tsx](../frontend/components/charts.tsx), [frontend/app/globals.css](../frontend/app/globals.css)

Il tema si sincronizza con `data-theme` su `<html>` (CSS variables) **e** dispara un custom event `arkemis-theme`. Gli `ECharts` ascoltano l'evento e richiamano `setOption(buildOption(), true)` per ricolorare senza distruggere il chart.

**Perché**: CSS-only basta per il 95% dei componenti, ma ECharts disegna su canvas e non reagisce alle CSS variables a runtime. Il custom event è il punto d'aggancio che mancava per allineare canvas e DOM.

---

### 22. ECharts 2D + `OrbitCanvas` 2D nativo

**Dove**: [frontend/components/charts.tsx](../frontend/components/charts.tsx), [frontend/components/dashboard-client.tsx](../frontend/components/dashboard-client.tsx)

Distanza/tempo (scatter, asse Y log) e istogramma dimensioni sono ECharts. La vista orbitale Earth-centric è canvas 2D nativo con `requestAnimationFrame`, scala radiale logaritmica 0.3–80 Lunar Distance, hit detection diretto su `Math.hypot`.

**Perché**: ECharts vince per chart standard (tooltip, zoom, asset di rendering) ma è pesante e poco controllabile per la vista orbitale, che chiede animazioni continue, halo pulsanti, scala log custom e selezione per pixel. Un canvas a mano è 200 righe e gira più liscio.

---

### 23. Filtri e sort client-side

**Dove**: [frontend/components/dashboard-client.tsx](../frontend/components/dashboard-client.tsx) (memo `filtered`)

Il backend ritorna il feed flatten e il frontend filtra (`hazard`) e ordina (`date` / `distance` / `size` / `velocity`) lato client.

**Perché**: il payload è già piccolo (qualche centinaio di righe nel range tipico). Filtrare client-side evita round-trip, mantiene la UI reattiva e permette di cambiare ordine senza invalidare la cache backend.

---

### 24. `useUtcClock` che parte da `null`

**Dove**: [frontend/components/dashboard-client.tsx](../frontend/components/dashboard-client.tsx)

Custom hook che ritorna `Date | null`. Inizia a `null`, poi aggiorna ogni secondo con `setInterval(1000)`.

**Perché**: SSR e hydration. Se il primo render usasse `new Date()` direttamente, server e client diverrebbero diversi al millisecondo e React griderebbe "hydration mismatch". Partire da `null` rende il primo render deterministico; il valore reale arriva dopo che il client è montato.

---

## Riepilogo modifiche post-review

| # | Modifica | File |
|---|---|---|
| 3 | Middleware ASGI puro → label `path` con template route | [observability.py](../backend/app/observability.py) |
| 7 | Write atomico + `_path_for` con guardia path traversal + `get_stats` non distruttivo async | [cache_service.py](../backend/app/services/cache_service.py) |
| 8 | `OrderedDict` LRU bounded per i lock | [cache_service.py](../backend/app/services/cache_service.py) |
| 9 | `fetch_feed`/`fetch_neo` ritornano `(payload, snapshot)`; `get_feed` aggrega worst-case | [nasa_client.py](../backend/app/services/nasa_client.py), [neo_service.py](../backend/app/services/neo_service.py) |
| 10 | 3 retry, backoff esponenziale + jitter, `Retry-After` ≤ 5s | [nasa_client.py](../backend/app/services/nasa_client.py) |
| 11 | `get_stats` async non distruttivo | [cache_service.py](../backend/app/services/cache_service.py), [routes_health.py](../backend/app/api/routes_health.py) |
| 12 | `chunk_days` bound `le=7` | [config.py](../backend/app/core/config.py) |
| 13 | Regex Pydantic + `root_validator` per `CacheInvalidateRequest` | [schemas.py](../backend/app/models/schemas.py) |
| 15 | Bound su numerici + rimosso `parse_env_var` ridondante | [config.py](../backend/app/core/config.py) |
| 16 | Nuovo flag `enable_admin_endpoints` | [config.py](../backend/app/core/config.py), [main.py](../backend/app/main.py) |
| — | `date_in_range` swallowa `APIError` su bucket NASA malformato | [dates.py](../backend/app/utils/dates.py) |
| — | `_build_stats` con `.get()` + `_safe_float` (no `KeyError` su payload parziale) | [neo_service.py](../backend/app/services/neo_service.py) |
| — | `_select_approach` annotato `Optional[Dict]` | [neo_service.py](../backend/app/services/neo_service.py) |
| — | `routes_health.py` semplificato (rimosso `Depends` nei default di funzione non-route) | [routes_health.py](../backend/app/api/routes_health.py) |
| — | `neo_id` validato `^[0-9]+$` via `Path(regex=...)` | [routes_neo.py](../backend/app/api/routes_neo.py) |

---

## Aperti

- **CORS `allow_credentials` localhost** (scelta #5): in dev qualunque app su localhost può fare richieste credentialed. Vale la pena rendere `allow_credentials` un setting esplicito e disabilitarlo se non servono cookie cross-origin.
- **`nasa_api_key` in query string**: NeoWs non accetta auth header. Se mai venisse abilitato il debug logging di httpx la chiave finirebbe nei log. Mitigazione: redactor di query string nel logger.
- **Exception handler 500 strutturato**: oggi solo `APIError` ha un handler che produce `{error: ...}`. Errori non previsti producono il `Internal Server Error` plain di Starlette, rompendo il contract con il frontend. Vale la pena aggiungere `@app.exception_handler(Exception)`.
- **Migrazione Pydantic v2** (scelta #14): pianificare quando v1 va in EOL hard.
