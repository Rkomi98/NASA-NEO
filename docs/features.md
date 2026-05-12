# Arkemis NEO Dashboard — Feature implementate

## Cos'è l'app

**Arkemis NEO Dashboard** è un'applicazione web per il monitoraggio e la visualizzazione degli asteroidi Near-Earth (NEO) che si avvicinano alla Terra. I dati provengono dalla **NASA NeoWs API** (Near Earth Object Web Service).

L'app permette di esplorare, filtrare e visualizzare in modo interattivo quali asteroidi transitano vicino alla Terra in un dato intervallo di date, con informazioni dettagliate su orbite, distanze di passaggio e classificazione del rischio.

---

## Stack tecnologico

| Layer | Tecnologia |
|-------|-----------|
| Frontend | Next.js 15 (App Router), React 19, TypeScript 5.8 |
| Visualizzazioni | Apache ECharts 5 + ECharts GL 2 (WebGL) |
| Backend | FastAPI (Python 3.9+), httpx async |
| Cache | File-based JSON con TTL, async locking |
| Dati | NASA NeoWs API v1 (`api.nasa.gov/neo/rest/v1`) |
| Metriche | Prometheus (`prometheus-client`) |

---

## Feature Backend

### 1. Proxy NASA con protezione chiave API
Il backend fa da intermediario tra il browser e la NASA API. La chiave API non viene mai esposta al frontend — è configurata come variabile d'ambiente `NASA_API_KEY` e aggiunta automaticamente alle richieste upstream.

### 2. Chunking automatico delle date
La NASA NeoWs API accetta range massimi di 7 giorni. Quando l'utente richiede un range più lungo (es. 30 giorni), il backend lo divide automaticamente in chunk da 7 giorni, li recupera in parallelo (max 2 concurrent), e restituisce i risultati unificati.

```
Range 30 giorni → [chunk 7gg] + [chunk 7gg] + [chunk 7gg] + [chunk 2gg]
```

### 3. Cache file-based con TTL
Ogni chunk di feed recuperato dalla NASA viene salvato su disco come JSON:

- **Feed chunks**: TTL di 12 ore (`cache/feed/{start}_{end}.json`)
- **Dettaglio NEO**: TTL di 72 ore (`cache/neo/{neo_id}.json`)
- Locking asincrono per evitare race condition su lettura/scrittura concorrente

### 4. Flattening del feed NASA
La risposta NASA organizza gli asteroidi per data (`near_earth_objects.{date}[]`). Il backend effettua un flatten per produrre un array piatto di eventi, dove ogni evento rappresenta un singolo passaggio ravvicinato di un asteroide in una data specifica. Ogni evento ha un `event_id` composto: `{asteroid_id}:{epoch_date}`.

### 5. Statistiche aggregate
Per ogni risposta del feed vengono calcolate statistiche aggregate:
- Totale asteroidi
- Numero di oggetti potenzialmente pericolosi (`is_potentially_hazardous_asteroid`)
- Passaggio più vicino (`closest_miss_km`)
- Diametro massimo (`largest_diameter_km`)
- Velocità massima (`fastest_kps`)

### 6. Retry logic sulle richieste NASA
Le richieste upstream verso la NASA hanno un retry automatico (2 tentativi, pausa 0.4s) in caso di timeout. Il backend traccia anche gli header di rate limit restituiti da NASA (`X-RateLimit-Limit`, `X-RateLimit-Remaining`).

### 7. Health check e cache stats
L'endpoint `/api/health` espone lo stato del backend: statistiche sulla cache (entries, dimensione, hit ratio, scadute) e il rate limit residuo verso la NASA API.

### 8. Invalidazione cache manuale
L'endpoint `POST /api/cache/invalidate` permette di svuotare la cache per scope:
- `all` — svuota tutto
- `feed` — svuota solo i chunk di feed (con parametri `start_date`/`end_date` opzionali)
- `neo` — svuota il dettaglio di un singolo asteroide (con `neo_id`)

### 9. Metriche Prometheus
L'endpoint `GET /metrics` espone metriche HTTP compatibili con Prometheus: conteggio richieste per metodo/path/status e latenza.

---

## Feature Frontend

### 1. Dashboard principale
Layout a due colonne: sidebar sinistra con filtri e KPI, colonna principale con catalogo e visualizzazioni. Supporta tema dark/light con toggle.

### 2. Selezione range di date
Picker con data di inizio e fine. Il default è gli ultimi 30 giorni. La richiesta viene inviata al backend al submit. Un badge mostra il numero totale di eventi trovati nel range.

### 3. Filtri real-time
Applicati client-side senza nuove richieste al server:
- **Filtro hazard**: tutti / solo pericolosi / solo sicuri
- **Ordinamento**: per data, distanza Terra, diametro, velocità relativa

### 4. KPI Cards
Tre metriche aggregate mostrate in cima alla dashboard:
- Asteroidi potenzialmente pericolosi nel range
- Passaggio più vicino (km)
- Diametro massimo rilevato (km)

### 5. Catalogo asteroidi
Tabella scrollable con tutti gli eventi nel range (filtrati/ordinati). Ogni riga mostra: nome, data di passaggio, distanza Terra, diametro stimato, velocità, badge di pericolo. Click su una riga apre il dettaglio.

### 6. Visualizzazione: Scatter 2D — Distanza nel tempo
Grafico ECharts con asse X = data di passaggio, asse Y = distanza dalla Terra in km. I punti sono colorati in rosso (pericolosi) o blu (sicuri). Hover mostra nome e dati precisi.

### 7. Visualizzazione: Bar chart — Distribuzione dimensioni
Istogramma a barre impilate che mostra la distribuzione degli asteroidi per classe di diametro:
- < 50 m
- 50–140 m
- 140–500 m
- 500 m–1 km
- > 1 km

### 8. Visualizzazione: Grafico orbitale 3D
Renderizzazione WebGL (ECharts GL) delle orbite ricostruite del sistema solare interno (Mercurio, Venere, Terra, Marte + asteroidi nel feed). Gli asteroidi sono posizionati sulla propria orbita kepleriana calcolata dal backend. Se i dati orbitali sono incompleti, viene mostrata una traccia semplificata. Interazione: rotazione, zoom, hover con nome asteroide.

### 9. Dettaglio asteroide — Modal / Pagina standalone
Click su un evento nel catalogo apre il pannello dettaglio. Mostra:
- Dati identificativi (ID NASA, designazione, magnitudine assoluta)
- Classificazione (classe orbitale, MOID Terra, sentry object flag)
- Parametri orbitali completi (semi-asse, eccentricità, inclinazione, argomento del perielio, nodo ascendente, periodo)
- Lista storica e futura di close approach (data, distanza, velocità, corpo orbitato)
- Link diretto alla pagina NASA JPL

### 10. Deep linking
Ogni asteroide aperto genera un query param `?neo_id=...` nell'URL (+ `approach_date` se disponibile). Navigando direttamente a `/` con questi parametri il dettaglio si apre automaticamente. La route `/neo/[id]` supporta URL standalone per singoli asteroidi.

### 11. Loading e error states
Skeleton placeholder durante il caricamento del feed. Card di errore specifica per errori di rete o NASA API. Stato "empty" con messaggio quando nessun asteroide corrisponde ai filtri.

---

## Flusso dati end-to-end

```
Utente imposta range date
        ↓
Frontend: GET /api/feed?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
        ↓
Backend: chunk_date_range() → chunk da 7 giorni
        ↓
Per ogni chunk (max 2 paralleli):
  ├─ Cache HIT → restituisce payload su disco
  └─ Cache MISS → NASA NeoWs API → salva su disco → restituisce
        ↓
_flatten_chunk(): nested per data → array piatto di eventi
_build_stats(): calcola KPI aggregati
        ↓
FeedResponse { meta, stats, near_earth_objects[] }
        ↓
Frontend: useState → filterItems() → sortItems()
        ↓
Render: catalogo tabella + 3 grafici
        ↓
Click asteroide → GET /api/neo/{neo_id}
        ↓
Backend: Cache HIT/MISS → NASA → NeoDetailResponse
        ↓
Frontend: modal dettaglio / pagina /neo/[id]
```

---

## Schema architetturale

```
┌─────────────────────────────────────────┐
│         Browser (Next.js 15)            │
│  DashboardClient (state, filtri, UI)    │
│  ├─ Scatter 2D (ECharts)               │
│  ├─ Bar chart dimensioni (ECharts)     │
│  └─ Orbital 3D (ECharts GL / WebGL)    │
└──────────────────┬──────────────────────┘
                   │ HTTP JSON
                   ↓
┌─────────────────────────────────────────┐
│      FastAPI Backend                    │
│  NeoService (orchestration)             │
│  CacheService (file JSON + TTL)         │
│  NasaNeoClient (httpx async + retry)    │
└──────────────────┬──────────────────────┘
                   │ HTTPS
                   ↓
         NASA NeoWs API v1
```
