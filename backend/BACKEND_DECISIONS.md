# Backend NASA NEO — Decisioni di design

Per ogni scelta non banale del backend: cosa è stato deciso, dove, e **3 ipotesi sul perché** (una tecnica, una pragmatica, una di vincolo/convenzione). In fondo, l'ipotesi più probabile motivata sull'evidenza nel codice.

Stack: FastAPI 0.115, Pydantic **1.10** (BaseSettings nativo), httpx 0.28, Prometheus client 0.22, Uvicorn 0.34.

---

## 1. Lifespan async context manager invece di `@app.on_event`

**Dove**: [main.py:21-40](backend/app/main.py)
**Cosa**: bootstrap di `CacheService`, `NasaNeoClient`, `NeoService` dentro `@asynccontextmanager`, stoccati in `app.state`, con `await nasa_client.shutdown()` post-yield.

**3 ipotesi sul perché**:
1. **Tecnica** — il lifespan API garantisce che `aclose()` del client httpx avvenga in modo deterministico anche su errori; `on_event("shutdown")` non sempre viene chiamato in caso di crash del worker.
2. **Pragmatica** — setup e teardown nella stessa funzione (locality of behavior), invece di due handler separati che condividono stato globale.
3. **Convenzione** — `on_event` è deprecato in Starlette ≥0.26 e la documentazione FastAPI 2024+ mostra lifespan come pattern preferito.

**Più probabile**: la **(1)**. La presenza esplicita di `await nasa_client.shutdown()` post-yield indica che l'autore voleva un teardown affidabile del client HTTP — esattamente il caso d'uso per cui il lifespan è stato introdotto.

---

## 2. DI via `app.state` + thin wrapper `Depends`

**Dove**: [dependencies.py:8-17](backend/app/dependencies.py), usato in tutte le route
**Cosa**: servizi singleton creati nel lifespan e salvati in `app.state`; le dependency sono solo funzioni che leggono `request.app.state.<service>`.

**3 ipotesi sul perché**:
1. **Tecnica** — abilita override standard FastAPI per i test (`app.dependency_overrides[get_neo_service] = ...`). Se le route accedessero direttamente a `request.app.state`, perderemmo questa capability.
2. **Pragmatica** — evita import circolari (`main.py` importa i servizi, le route importano solo `dependencies`).
3. **Convenzione** — pattern documentato da FastAPI per condividere risorse stateful (DB pool, HTTP client).

**Più probabile**: la **(1)**. Il wrapper sarebbe puro overhead se non servisse alla testabilità; il fatto che esista per ogni servizio è la firma di "test-first design".

---

## 3. Custom `BaseHTTPMiddleware` per metriche invece di `prometheus-fastapi-instrumentator`

**Dove**: [observability.py:20-38](backend/app/observability.py)
**Cosa**: middleware fatto a mano che misura latenza e conta richieste, con label `(method, path, status_code)`.

**3 ipotesi sul perché**:
1. **Tecnica** — controllo totale sulle label e niente dipendenza esterna.
2. **Pragmatica** — sono ~30 righe, l'autore le ha scritte invece di aggiungere un package.
3. **Vincolo** — `prometheus-fastapi-instrumentator` potrebbe non essere ammessa da policy di dipendenze.

**Più probabile**: la **(2)**. Non c'è evidenza di label custom realmente necessarie (anzi: c'è un bug di cardinalità — vedi report), e nessun hint di policy esterne. È l'approccio "scrivilo in 30 righe e non aggiungere dipendenze".

> Nota di review: questa scelta nasconde un bug Prometheus reale (cardinalità di `path`). Vedi report.

---

## 4. `/metrics` e `/health` (compat) fuori dal prefisso `/api/`

**Dove**: [routes_metrics.py](backend/app/api/routes_metrics.py), [routes_health.py:38-43](backend/app/api/routes_health.py)
**Cosa**: endpoint operazionali su path top-level (`/metrics`, `/health`) + duplicato `/api/health` "ufficiale". I top-level hanno `include_in_schema=False`.

**3 ipotesi sul perché**:
1. **Tecnica** — probe Kubernetes / Prometheus scrape cercano per convenzione `/metrics` e `/health` top-level.
2. **Pragmatica** — tenerli fuori dallo schema OpenAPI evita di pubblicizzare endpoint operativi ai consumatori dell'API.
3. **Convenzione** — pattern standard "RED metrics + liveness" delle piattaforme cloud.

**Più probabile**: la **(1)**. La coesistenza di `/api/health` (visibile) e `/health` (out-of-schema) suggerisce esplicitamente la compatibilità con probe esterni a path fisso.

---

## 5. CORS `allow_credentials=True` + `allow_origin_regex` + `allow_methods=["*"]`

**Dove**: [main.py:45-52](backend/app/main.py) + [config.py:21-28](backend/app/core/config.py)
**Cosa**: lista esplicita + regex `^https?://(localhost|127\.0\.0\.1):[0-9]+$`, credenziali abilitate, metodi/header tutti.

**3 ipotesi sul perché**:
1. **Tecnica** — la regex copre preview deploy dove la porta è dinamica (es. `localhost:54321` lanciato da `next dev`).
2. **Pragmatica** — `["*"]` su methods/headers evita di aggiornare la config a ogni nuovo endpoint.
3. **Convenzione** — SPA frontend separato (Next.js, visto in `frontend/`) che invia cookie richiede `allow_credentials=True`.

**Più probabile**: la **(1)** combinata con la **(3)**. La coesistenza di lista esatta + regex localhost è il pattern tipico "prod fissa + dev/preview dinamiche".

> Nota di review: in prod il regex localhost può essere problematico se non override-ato. Vedi report.

---

## 6. `APIError` custom + handler globale

**Dove**: [errors.py:4-21](backend/app/core/errors.py), handler in [main.py:56-67](backend/app/main.py)
**Cosa**: gerarchia di eccezioni con `code`/`message`/`details` e un handler che le converte in `{error: {code, message, details}}`.

**3 ipotesi sul perché**:
1. **Tecnica** — separa il dominio (utils/services sollevano `APIError`) dal trasporto HTTP; permette codici machine-readable per il frontend senza accoppiare le utility a FastAPI.
2. **Pragmatica** — un solo handler invece di try/except in ogni route. Tutte le route fanno solo `await service.qualcosa(...)`.
3. **Convenzione** — ricalca parzialmente RFC 7807 / JSON:API.

**Più probabile**: la **(2)**. L'evidenza è che nessuna route ha try/except: il pattern "raise nelle service, catch globale" è esattamente lo use case del custom handler.

---

## 7. Cache file-based JSON su filesystem

**Dove**: [cache_service.py:13-15,72](backend/app/services/cache_service.py)
**Cosa**: cache persistente come file JSON in `cache_root/<namespace>/<key>.json`.

**3 ipotesi sul perché**:
1. **Tecnica** — persistenza tra restart senza infra esterna; utile in single-instance per non bruciare quota NASA dopo un riavvio.
2. **Pragmatica** — zero infra: niente Redis, niente container extra.
3. **Convenzione** — progetto educational/take-home: un file JSON è ispezionabile con `cat`, dimostra TTL/invalidation senza dipendenze.

**Più probabile**: la **(3)**. Il tono didattico (commenti/messaggi in italiano, struttura semplificata, nessun lock distribuito né eviction LRU) suggerisce un contesto demo dove leggibilità batte scalabilità.

---

## 8. Lock per-(namespace, key) lazy in un `dict` non-bounded

**Dove**: [cache_service.py:16,21-25](backend/app/services/cache_service.py)
**Cosa**: un `asyncio.Lock` separato per ogni coppia (namespace, key), creato pigramente e mai rimosso.

**3 ipotesi sul perché**:
1. **Tecnica** — single-flight: due richieste concorrenti per lo stesso chunk attendono una sola chiamata NASA, ma chunk diversi non si bloccano.
2. **Pragmatica** — un lock globale serializzerebbe troppo `get_feed` (chunk paralleli); per-key è il minimo sforzo per granularità decente.
3. **Convenzione** — pattern "memoize con lock" standard in tutorial async Python.

**Più probabile**: la **(1)**. La combinazione con `asyncio.Semaphore(upstream_concurrency)` in neo_service mostra una progettazione consapevole di concorrenza/thundering herd.

> Nota di review: il dict non è bounded — memory leak se le key sono arbitrarie. Vedi report.

---

## 9. Separazione `NasaNeoClient` (HTTP + retry) vs `NeoService` (orchestrazione + cache)

**Dove**: [nasa_client.py:10](backend/app/services/nasa_client.py), [neo_service.py:12](backend/app/services/neo_service.py)
**Cosa**: client puro per la NASA API; service che fa chunking, caching, flatten/stats.

**3 ipotesi sul perché**:
1. **Tecnica** — testabilità: si può iniettare un client stub in `NeoService` senza monkeypatch su httpx.
2. **Pragmatica** — sostituzione del provider richiede solo un nuovo client.
3. **Convenzione** — ports-and-adapters / hexagonal, pattern comune in progetti FastAPI moderni.

**Più probabile**: la **(1)**. Il `__init__` keyword-only di `NeoService` con tre dipendenze esplicite è la firma del DI test-friendly.

---

## 10. Retry minimale: 2 tentativi, sleep fisso 0.4s, **no retry su 429**, **no `Retry-After`**

**Dove**: [nasa_client.py:49,61,95](backend/app/services/nasa_client.py)
**Cosa**: 2 attempts totali, backoff costante 0.4s, retry solo su timeout e 5xx; 429 fail-fast.

**3 ipotesi sul perché**:
1. **Tecnica** — NASA NeoWs ha rate limit orario (~30/h per DEMO_KEY, 1000/h per chiave registrata): ritentare un 429 in 0.4s peggiora la situazione, meglio fail-fast.
2. **Pragmatica** — codice semplice; aggiungere `tenacity` per due retry è overkill.
3. **Convenzione** — default "minimo indispensabile" per non bruciare quota mensile.

**Più probabile**: la **(1)**. La scelta esplicita di non ritentare 429 ed esporre `rate_limit_remaining` ai consumatori è una decisione informata sul comportamento di NASA, non un'omissione.

> Nota di review: comunque manca il rispetto di `Retry-After` se presente. Vedi report.

---

## 11. Stats cache come stato in-memory esposto su `/api/health`

**Dove**: [cache_service.py:17-19,108-125](backend/app/services/cache_service.py), consumato da [routes_health.py:16](backend/app/api/routes_health.py)
**Cosa**: counter `_hits`, `_misses`, `_expired` come attributi mutabili dell'istanza, esposti via `get_stats()`.

**3 ipotesi sul perché**:
1. **Tecnica** — osservabilità senza StatsD: per uno scope ridotto basta esporre via REST.
2. **Pragmatica** — `/api/health` deve dimostrare che la cache "funziona" durante demo o smoke test.
3. **Convenzione** — pattern "stats object" tipico stdlib (`functools.lru_cache.cache_info()`).

**Più probabile**: la **(2)**. Coerente con la natura demo/take-home: serve mostrare che la cache lavora, non integrarsi con Prometheus (che pure è presente: scelta duplice/inconsistente).

---

## 12. Chunking 7 giorni con `chunk_days - 1` nel cursor

**Dove**: [dates.py:41-48](backend/app/utils/dates.py), default in [config.py:32](backend/app/core/config.py)
**Cosa**: range diviso in finestre con `chunk_end = min(cursor + timedelta(days=chunk_days - 1), end)`, end-inclusive.

**3 ipotesi sul perché**:
1. **Tecnica** — il `-1` è il classico off-by-one fix per range inclusivi (start+6 = 7 giorni in totale).
2. **Pragmatica** — 7 è il valore naturale della settimana e massimizza il payload per chiamata.
3. **Vincolo** — il `/feed` NASA accetta al massimo 7 giorni: il chunking è obbligatorio.

**Più probabile**: la **(3)**. Il chunking nasce dal vincolo upstream; il `-1` è il dettaglio implementativo che rende il chunk inclusivo.

---

## 13. Schemi tutti in un singolo `schemas.py`

**Dove**: [schemas.py:1-96](backend/app/models/schemas.py)
**Cosa**: tutti i modelli Pydantic (feed, neo, cache, health) in un solo file.

**3 ipotesi sul perché**:
1. **Tecnica** — il dominio è piccolo (~10 modelli), splittarli complicherebbe gli import.
2. **Pragmatica** — un solo `from app.models.schemas import ...` ovunque.
3. **Convenzione** — niente ORM → non serve la distinzione schemas/models tipica dei progetti SQLAlchemy.

**Più probabile**: la **(1)**. Superficie API ridotta, un solo file è il giusto trade-off tra leggibilità e overhead di organizzazione.

---

## 14. Pydantic v1 invece di v2

**Dove**: [requirements.txt:3](backend/requirements.txt) (`pydantic==1.10.15`), uso pervasivo di `BaseSettings` nativo, `@validator`, `class Config`
**Cosa**: tutto il progetto è ancorato a Pydantic 1.x.

**3 ipotesi sul perché**:
1. **Tecnica** — v1 ha `BaseSettings` nativo con `parse_env_var` custom; in v2 serve installare `pydantic-settings` separato.
2. **Pragmatica** — pin a 1.10.15 evita di migrare codice esistente.
3. **Vincolo** — uno snippet di partenza dalla doc storica o dipendenze legacy hanno cementato la scelta.

**Più probabile**: la **(2)**. Il progetto non è grande e non c'è ragione tecnica forte: è uno snapshot di quando v1 era lo standard, senza investimento sulla migrazione.

---

## 15. Settings via env + `.env`, no YAML/TOML

**Dove**: [config.py:19-40](backend/app/core/config.py)
**Cosa**: configurazione 12-factor, tutto via env var con fallback default in codice.

**3 ipotesi sul perché**:
1. **Tecnica** — BaseSettings legge env + `.env` con zero boilerplate.
2. **Pragmatica** — deploy in container (Docker/Render/Railway) inietta env: file di config sarebbe da montare.
3. **Vincolo** — `nasa_api_key` è secret e deve stare fuori dal repo → env è l'unica opzione coerente.

**Più probabile**: la **(3)**. Una volta usata env per il secret, conviene uniformare tutto il resto.

---

## Domande aperte (scelte da chiarire con l'autore)

Per queste decisioni nessuna delle 3 ipotesi è chiaramente dominante; meritano una conferma esplicita:

- **Prometheus middleware custom vs istrumentatore**: c'è un bug di cardinalità label (`path` con id concreto). Era una scelta consapevole o una semplificazione che ora va sistemata?
- **`/health` (compat) duplicato**: c'è davvero un probe esterno che lo usa, o è codice morto?
- **`Settings.Config.parse_env_var` + `@validator("allowed_origins", pre=True)`**: il `parse_env_var` è ridondante. Era un primo tentativo lasciato indietro?
- **Cache file-based per progetto educational, ma metriche Prometheus per progetto scalabile**: scelta duplice. Quale obiettivo vince in produzione?
- **`max_days=365` con `chunk_days=7`**: una singola richiesta può esplodere in ~53 chiamate NASA. È un limite voluto o va ridotto?
