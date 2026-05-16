# Backend NASA NEO — Decisioni di design

Per ogni scelta non banale del backend: cosa è stato deciso, dove, e **3 ipotesi sul perché** (una tecnica, una pragmatica, una di vincolo/convenzione). In fondo, l'ipotesi più probabile motivata sull'evidenza nel codice. Le scelte che la review ha modificato hanno una nota **Stato post-review** che racconta cosa è cambiato e perché.

Stack: FastAPI 0.115, Pydantic **1.10** (BaseSettings nativo), httpx 0.28, Prometheus client 0.22, Uvicorn 0.34.

---

## 1. Lifespan async context manager invece di `@app.on_event`

**Dove**: [main.py:21-40](backend/app/main.py)
**Cosa**: bootstrap di `CacheService`, `NasaNeoClient`, `NeoService` dentro `@asynccontextmanager`, stoccati in `app.state`, con `await nasa_client.shutdown()` post-yield.

**3 ipotesi sul perché**:
1. **Tecnica** — il lifespan API garantisce che `aclose()` del client httpx avvenga in modo deterministico anche su errori; `on_event("shutdown")` non sempre viene chiamato in caso di crash del worker.
2. **Pragmatica** — setup e teardown nella stessa funzione (locality of behavior), invece di due handler separati che condividono stato globale.
3. **Convenzione** — `on_event` è deprecato in Starlette ≥0.26 e la documentazione FastAPI 2024+ mostra lifespan come pattern preferito.

**Più probabile**: la **(1)**. La presenza esplicita di `await nasa_client.shutdown()` post-yield indica che l'autore voleva un teardown affidabile del client HTTP.

---

## 2. DI via `app.state` + thin wrapper `Depends`

**Dove**: [dependencies.py:8-17](backend/app/dependencies.py), usato in tutte le route
**Cosa**: servizi singleton creati nel lifespan e salvati in `app.state`; le dependency sono solo funzioni che leggono `request.app.state.<service>`.

**3 ipotesi sul perché**:
1. **Tecnica** — abilita override standard FastAPI per i test (`app.dependency_overrides[get_neo_service] = ...`).
2. **Pragmatica** — evita import circolari (`main.py` importa i servizi, le route importano solo `dependencies`).
3. **Convenzione** — pattern documentato da FastAPI per condividere risorse stateful.

**Più probabile**: la **(1)**. Il wrapper sarebbe puro overhead se non servisse alla testabilità.

---

## 3. Metriche Prometheus via middleware ASGI puro

**Dove**: [observability.py](backend/app/observability.py)
**Cosa**: middleware fatto a mano (non `BaseHTTPMiddleware`) che misura latenza e conta richieste, con label `(method, path, status_code)`.

**3 ipotesi sul perché**:
1. **Tecnica** — controllo totale sulle label, niente dipendenza esterna, footprint minimo.
2. **Pragmatica** — sono ~30 righe, l'autore le ha scritte invece di aggiungere un package.
3. **Vincolo** — `prometheus-fastapi-instrumentator` potrebbe non essere ammessa da policy di dipendenze.

**Più probabile**: la **(2)**. Decisione di tenere il footprint minimo.

**Stato post-review**: l'implementazione originale era un `BaseHTTPMiddleware` che leggeva `request.scope["route"]` **prima** di `call_next`, quando il Router non aveva ancora matchato la rotta. Risultato: `path` cadeva sempre su `request.url.path`, esponendo l'id concreto come label Prometheus (cardinality esplosa, una time-series per ogni `neo_id`). La nuova implementazione è un **middleware ASGI puro** che condivide lo scope con il Router e legge `scope["route"]` dopo che il dispatch l'ha popolato — la label `path` ora è il template (`/api/neo/{neo_id}`).

---

## 4. `/metrics` e `/health` (compat) fuori dal prefisso `/api/`

**Dove**: [routes_metrics.py](backend/app/api/routes_metrics.py), [routes_health.py:38-43](backend/app/api/routes_health.py)
**Cosa**: endpoint operazionali su path top-level (`/metrics`, `/health`) + duplicato `/api/health` "ufficiale". I top-level hanno `include_in_schema=False`.

**3 ipotesi sul perché**:
1. **Tecnica** — probe Kubernetes / Prometheus scrape cercano per convenzione `/metrics` e `/health` top-level.
2. **Pragmatica** — tenerli fuori dallo schema OpenAPI evita di pubblicizzare endpoint operativi.
3. **Convenzione** — pattern standard "RED metrics + liveness" delle piattaforme cloud.

**Più probabile**: la **(1)**. La coesistenza di `/api/health` (visibile) e `/health` (out-of-schema) è la firma della compatibilità con probe esterni.

---

## 5. CORS `allow_credentials=True` + `allow_origin_regex` + `allow_methods=["*"]`

**Dove**: [main.py:45-52](backend/app/main.py) + [config.py:21-28](backend/app/core/config.py)
**Cosa**: lista esplicita + regex `^https?://(localhost|127\.0\.0\.1):[0-9]+$`, credenziali abilitate, metodi/header tutti.

**3 ipotesi sul perché**:
1. **Tecnica** — la regex copre preview deploy dove la porta è dinamica (es. `localhost:54321` lanciato da `next dev`).
2. **Pragmatica** — `["*"]` su methods/headers evita di aggiornare la config a ogni nuovo endpoint.
3. **Convenzione** — SPA frontend separato (Next.js) che invia cookie richiede `allow_credentials=True`.

**Più probabile**: la **(1)** combinata con la **(3)**. Pattern tipico "prod fissa + dev/preview dinamiche".

> Aperto: in prod il regex localhost va override-ato esplicitamente via `ALLOWED_ORIGIN_REGEX`; vale la pena rendere `allow_credentials` un setting per disabilitarlo quando non servono cookie cross-origin.

---

## 6. `APIError` custom + handler globale

**Dove**: [errors.py:4-21](backend/app/core/errors.py), handler in [main.py:56-67](backend/app/main.py)
**Cosa**: gerarchia di eccezioni con `code`/`message`/`details` e un handler che le converte in `{error: {code, message, details}}`.

**3 ipotesi sul perché**:
1. **Tecnica** — separa il dominio dal trasporto HTTP; codici machine-readable per il frontend senza accoppiare le utility a FastAPI.
2. **Pragmatica** — un solo handler invece di try/except in ogni route.
3. **Convenzione** — ricalca parzialmente RFC 7807 / JSON:API.

**Più probabile**: la **(2)**. Nessuna route ha try/except: il pattern è "raise nelle service, catch globale".

---

## 7. Cache file-based JSON su filesystem

**Dove**: [cache_service.py](backend/app/services/cache_service.py)
**Cosa**: cache persistente come file JSON in `cache_root/<namespace>/<key>.json`.

**3 ipotesi sul perché**:
1. **Tecnica** — persistenza tra restart senza infra esterna; utile in single-instance per non bruciare quota NASA.
2. **Pragmatica** — zero infra: niente Redis, niente container extra.
3. **Convenzione** — progetto educational/take-home: un file JSON è ispezionabile con `cat`.

**Più probabile**: la **(3)**. Tono didattico e struttura semplificata fanno pensare a un contesto demo.

**Stato post-review**: aggiunte tre proprietà:
- **Write atomico**: scrittura su `.json.tmp` + `os.replace` per evitare file troncati su crash o lettori concorrenti.
- **Difesa in profondità path traversal**: `_path_for` risolve i path e verifica `is_relative_to(cache_root)`. Una chiave malevola solleva `ValueError` invece di scrivere fuori dalla cache_root.
- **`get_stats` non distruttivo e async**: ora usa `_peek_entry` (non cancella file scaduti) e gira su `asyncio.to_thread` per non bloccare l'event loop. L'eviction delle entry scadute resta in `_read_entry` (path del `get_or_set`), come deve essere.

---

## 8. Lock per-(namespace, key) con LRU bounded

**Dove**: [cache_service.py:23-43](backend/app/services/cache_service.py)
**Cosa**: un `asyncio.Lock` separato per ogni coppia (namespace, key), creato pigramente.

**3 ipotesi sul perché**:
1. **Tecnica** — single-flight: due richieste concorrenti per lo stesso chunk attendono una sola chiamata NASA, ma chunk diversi non si bloccano.
2. **Pragmatica** — un lock globale serializzerebbe troppo `get_feed` (chunk paralleli).
3. **Convenzione** — pattern "memoize con lock" standard in tutorial async Python.

**Più probabile**: la **(1)**. La combinazione con `asyncio.Semaphore(upstream_concurrency)` mostra una progettazione consapevole di concorrenza/thundering herd.

**Stato post-review**: il dict originale era unbounded → memory leak con chiavi arbitrarie. Ora è un `OrderedDict` con `LOCK_LIMIT = 1024`, eviction LRU che salta i lock attualmente acquisiti (così non si crea un nuovo lock per una chiave che è in uso, perdendo la sincronizzazione).

---

## 9. Separazione `NasaNeoClient` (HTTP + retry) vs `NeoService` (orchestrazione + cache)

**Dove**: [nasa_client.py:10](backend/app/services/nasa_client.py), [neo_service.py:12](backend/app/services/neo_service.py)
**Cosa**: client puro per la NASA API; service che fa chunking, caching, flatten/stats.

**3 ipotesi sul perché**:
1. **Tecnica** — testabilità: si può iniettare un client stub in `NeoService` senza monkeypatch su httpx.
2. **Pragmatica** — sostituzione del provider richiede solo un nuovo client.
3. **Convenzione** — ports-and-adapters / hexagonal.

**Più probabile**: la **(1)**. Il `__init__` keyword-only di `NeoService` è la firma del DI test-friendly.

**Stato post-review**: il contratto del client è cambiato. `fetch_feed` e `fetch_neo` ora ritornano `(payload, upstream_snapshot)`. Lo snapshot è catturato per-request invece di essere letto da un campo condiviso post-`gather`, che produceva valori non deterministici quando i chunk completavano in parallelo. `NeoService.get_feed` aggrega gli snapshot e mette nel `meta.last_upstream_rate_limit` quello con `remaining` minimo (caso pessimo, più utile al client).

---

## 10. Retry NASA: 3 tentativi, backoff esponenziale + jitter, rispetto di `Retry-After`

**Dove**: [nasa_client.py:50-129](backend/app/services/nasa_client.py)
**Cosa**: `MAX_ATTEMPTS = 3`, backoff esponenziale `0.4s * 2^attempt` con jitter uniforme, retry su timeout e 5xx; su 429 retry solo se `Retry-After` è presente e ≤ 5s (`RETRY_AFTER_CAP_SECONDS`), altrimenti fail-fast con `retry_after_seconds` esposto al client.

**3 ipotesi sul perché**:
1. **Tecnica** — NASA NeoWs ha rate limit orario: ritentare un 429 senza informazioni è dannoso, ma se la NASA dice "tra 2 secondi" ha senso aspettare. Il cap a 5s evita di tenere bloccato un client troppo a lungo.
2. **Pragmatica** — codice semplice; aggiungere `tenacity` per 3 retry è overkill.
3. **Convenzione** — pattern standard "respect Retry-After + capped exponential backoff + jitter" raccomandato da Google SRE / AWS.

**Più probabile**: la **(1)**. La logica differenziata 429 vs 5xx vs timeout è una scelta informata sul comportamento di NASA NeoWs, non un template generico.

**Stato post-review (≠ versione iniziale)**: l'implementazione originale aveva 2 tentativi, backoff fisso 0.4s, **nessun retry sul 429** e nessun rispetto di `Retry-After`. La versione nuova mantiene la filosofia "non spammare NASA" ma aggiunge:
- 3 tentativi (con jitter contro burst sincroni).
- Backoff esponenziale `_backoff_delay(attempt)`.
- Lettura di `Retry-After` su 429 e retry solo se il valore è "ragionevole" (≤ 5s).
- `retry_after_seconds` nei `details` dell'errore esposto al client.

---

## 11. Stats cache come stato in-memory esposto su `/api/health`

**Dove**: [cache_service.py](backend/app/services/cache_service.py), consumato da [routes_health.py](backend/app/api/routes_health.py)
**Cosa**: counter `_hits`, `_misses`, `_expired` come attributi mutabili, esposti via `get_stats()` async.

**3 ipotesi sul perché**:
1. **Tecnica** — osservabilità senza StatsD: per uno scope ridotto basta esporre via REST.
2. **Pragmatica** — `/api/health` deve dimostrare che la cache "funziona" durante demo o smoke test.
3. **Convenzione** — pattern "stats object" tipico stdlib (`functools.lru_cache.cache_info()`).

**Più probabile**: la **(2)**. Coerente con la natura demo/take-home.

**Stato post-review**: `get_stats` originariamente era sincrono, faceva I/O bloccante sull'event loop e — sorpresa — cancellava le entry scadute come effetto collaterale (mescolando osservabilità ed eviction). Ora è `async` su `asyncio.to_thread` e usa `_peek_entry` non distruttivo: leggere stat non altera più il filesystem.

---

## 12. Chunking 7 giorni con `chunk_days - 1` nel cursor

**Dove**: [dates.py:41-48](backend/app/utils/dates.py), default in [config.py](backend/app/core/config.py)
**Cosa**: range diviso in finestre con `chunk_end = min(cursor + timedelta(days=chunk_days - 1), end)`, end-inclusive.

**3 ipotesi sul perché**:
1. **Tecnica** — il `-1` è il classico off-by-one fix per range inclusivi (start+6 = 7 giorni in totale).
2. **Pragmatica** — 7 è il valore naturale della settimana e massimizza il payload per chiamata.
3. **Vincolo** — il `/feed` NASA accetta al massimo 7 giorni: il chunking è obbligatorio.

**Più probabile**: la **(3)**. Il chunking nasce dal vincolo upstream.

**Stato post-review**: `chunk_days` è ora vincolato a `Field(7, ge=1, le=7)` in config: l'invariante "≤ 7 giorni" è dichiarata nel tipo, non solo nei commenti. Un env `CHUNK_DAYS=30` viene rifiutato a startup invece di provocare errori a runtime su ogni chiamata.

---

## 13. Schemi tutti in un singolo `schemas.py`

**Dove**: [schemas.py](backend/app/models/schemas.py)
**Cosa**: tutti i modelli Pydantic (feed, neo, cache, health) in un solo file.

**3 ipotesi sul perché**:
1. **Tecnica** — il dominio è piccolo (~10 modelli), splittarli complicherebbe gli import.
2. **Pragmatica** — un solo `from app.models.schemas import ...` ovunque.
3. **Convenzione** — niente ORM → non serve la distinzione schemas/models.

**Più probabile**: la **(1)**. Superficie API ridotta.

**Stato post-review**: aggiunte le costanti `ISO_DATE_REGEX` e `NEO_ID_REGEX` a livello modulo e applicate via `Field(..., regex=...)` su `CacheInvalidateRequest`. Aggiunto un `@root_validator` che richiede `start_date+end_date` quando `scope="feed"` e `neo_id` quando `scope="neo"`: combinazioni invalide ora ritornano 422 invece di ritornare silenziosamente `deleted=0`.

---

## 14. Pydantic v1 invece di v2

**Dove**: [requirements.txt:3](backend/requirements.txt) (`pydantic==1.10.15`)
**Cosa**: tutto il progetto è ancorato a Pydantic 1.x (`BaseSettings` nativo, `@validator`, `class Config`).

**3 ipotesi sul perché**:
1. **Tecnica** — v1 ha `BaseSettings` nativo con `parse_env_var` custom; in v2 serve installare `pydantic-settings` separato.
2. **Pragmatica** — pin a 1.10.15 evita di migrare codice esistente.
3. **Vincolo** — uno snippet di partenza dalla doc storica o dipendenze legacy hanno cementato la scelta.

**Più probabile**: la **(2)**. Snapshot di quando v1 era lo standard, senza investimento sulla migrazione. Pydantic 1.10 va in EOL/security-only nel 2025-2026: vale la pena pianificare la migrazione a v2 + `pydantic-settings` prima che diventi obbligatoria.

---

## 15. Settings via env + `.env`, no YAML/TOML

**Dove**: [config.py](backend/app/core/config.py)
**Cosa**: configurazione 12-factor, tutto via env var con fallback default in codice.

**3 ipotesi sul perché**:
1. **Tecnica** — BaseSettings legge env + `.env` con zero boilerplate.
2. **Pragmatica** — deploy in container inietta env: file di config sarebbe da montare.
3. **Vincolo** — `nasa_api_key` è secret e deve stare fuori dal repo → env è l'unica opzione coerente.

**Più probabile**: la **(3)**. Una volta usata env per il secret, conviene uniformare tutto il resto.

**Stato post-review**:
- Rimosso `Settings.Config.parse_env_var`: era ridondante perché `@validator("allowed_origins", pre=True)` copre già tutti i casi (str CSV, JSON list, lista, vuoto). La logica JSON è ora consolidata nel validator.
- Aggiunti bound Pydantic su tutti i numerici: `feed_ttl_seconds`, `neo_ttl_seconds`, `max_days`, `upstream_timeout_seconds`, `upstream_concurrency` hanno `gt=0` / `ge=1`. Configurazioni patologiche (`UPSTREAM_CONCURRENCY=0` deadlocka, `UPSTREAM_TIMEOUT_SECONDS=-1` rompe httpx) vengono rifiutate a startup. `chunk_days` è hard-bounded a `le=7` (limite NASA).
- `max_days` resta libero (di default 365): per restringere il perimetro a 30 giorni basta `MAX_DAYS=30` come env var, senza toccare il codice.

---

## 16. Feature flag per `cache_router` (nuova scelta post-review)

**Dove**: [config.py](backend/app/core/config.py), [main.py:80-84](backend/app/main.py)
**Cosa**: `POST /api/cache/invalidate` esiste solo se `enable_admin_endpoints=True` (env `ENABLE_ADMIN_ENDPOINTS=1`). Default `False`: in produzione l'endpoint è invisibile, non risponde 401/403 — semplicemente non esiste.

**3 ipotesi sul perché** (motivazione della scelta):
1. **Tecnica** — un endpoint che non esiste è più sicuro di un endpoint protetto: niente token da gestire, niente rotazione, niente rischio di leak. Il superficie d'attacco è zero, non "ridotta".
2. **Pragmatica** — non c'è ancora un sistema di auth; aggiungerlo solo per un endpoint admin sarebbe overkill rispetto al feature flag.
3. **Convenzione** — pattern "admin endpoints opt-in via env" comune in microservizi piccoli (12-factor / config-driven feature flags).

**Più probabile**: la **(1)**. La scelta nasce da una valutazione esplicita di sicurezza durante la review: la richiesta dell'utente è stata "Funziona rimuovere l'endpoint dalla superficie pubblica? Se funziona mi sembra più sicura la seconda opzione".

---

## Domande aperte (residuali, da chiarire/decidere)

- **CORS `allow_credentials` localhost** (scelta #5): in dev qualunque app su localhost può fare richieste credentialed. Vale la pena rendere `allow_credentials` un setting esplicito e disabilitarlo se non servono cookie cross-origin.
- **`nasa_api_key` in query string**: NeoWs non accetta auth header, ma se mai venisse abilitato il debug logging di httpx la chiave finirebbe nei log. Possibile mitigazione: redactor di query string nel logger.
- **Exception handler 500 strutturato**: oggi solo `APIError` ha un handler che produce `{error: ...}`. Errori non previsti producono il `Internal Server Error` plain di Starlette, rompendo il contract con il frontend. Vale la pena aggiungere `@app.exception_handler(Exception)`.
- **Migrazione Pydantic v2** (scelta #14): pianificare quando v1 va in EOL hard.

---

## Sintesi delle modifiche post-review

| # | Modifica | File |
|---|---|---|
| 3 | Middleware ASGI puro → label `path` con template route | `observability.py` |
| 7 | Write atomico + `_path_for` con guardia path traversal + `get_stats` non distruttivo async | `cache_service.py` |
| 8 | `OrderedDict` LRU bounded per i lock | `cache_service.py` |
| 9 | `fetch_feed`/`fetch_neo` ritornano `(payload, snapshot)`; `get_feed` aggrega worst-case | `nasa_client.py`, `neo_service.py` |
| 10 | 3 retry, backoff esponenziale + jitter, `Retry-After` ≤ 5s | `nasa_client.py` |
| 11 | `get_stats` async non distruttivo | `cache_service.py`, `routes_health.py` |
| 12 | `chunk_days` bound `le=7` | `config.py` |
| 13 | Regex Pydantic + `root_validator` per `CacheInvalidateRequest` | `schemas.py` |
| 15 | Bound su numerici + rimosso `parse_env_var` ridondante | `config.py` |
| 16 | Nuovo flag `enable_admin_endpoints` | `config.py`, `main.py` |
| — | `date_in_range` swallowa `APIError` su bucket NASA malformato | `dates.py` |
| — | `_build_stats` con `.get()` + `_safe_float` (no `KeyError` su payload parziale) | `neo_service.py` |
| — | `_select_approach` annotato `Optional[Dict]` | `neo_service.py` |
| — | `routes_health.py` semplificato (rimosso `Depends` nei default di funzione non-route) | `routes_health.py` |
| — | `neo_id` validato `^[0-9]+$` via `Path(regex=...)` | `routes_neo.py` |
