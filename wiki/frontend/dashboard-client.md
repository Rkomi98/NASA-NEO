---
tags: [frontend, component]
updated: 2026-05-16
related: [charts, api-layer, schemas, system-overview]
---

# dashboard-client.tsx

**Percorso**: `frontend/components/dashboard-client.tsx`

## Purpose

Componente principale del frontend. Gestisce stato UI, data fetch, filtri, routing interno tra pagine e visualizzazione orbitale 2D. È il punto di integrazione tra API layer, chart ECharts e canvas nativo.

---

## Key symbols

### Tipi locali

```typescript
type Page         = "now" | "catalog" | "states" | "settings"
type HazardFilter = "all" | "yes" | "no"
type SortKey      = "date" | "distance" | "size" | "velocity"

interface Filters {
  hazard: HazardFilter;
  sort:   SortKey;
}

interface DashboardClientProps {
  standaloneNeoId?: string;
}
```

### Formatters inline

| Funzione | Output |
|---------|--------|
| `fmtDate(iso)` | `"14 mag 26"` |
| `fmtDateFull(iso)` | `"14 maggio 2026"` |
| `fmtDateMD(iso)` | `"14.05"` |
| `fmtTime(iso)` | `"08:30 UTC"` |
| `fmtKm(n)` | `"1.2M"` / `"384k"` / `"900"` |
| `fmtKmFull(n)` | `"384.400"` (locale it-IT) |
| `utcString(d)` | `"2026.05.14 · 08:30:00 UTC"` |

`hexToRgb(hex) → "r,g,b"` — converte esadecimale in stringa per `rgba()` sul canvas.

---

### `useUtcClock() → Date | null`

Custom hook. Inizia a `null` (evita hydration mismatch), poi aggiorna ogni secondo via `setInterval(1000)`.

---

### `OrbitCanvas`

```typescript
interface OrbitCanvasProps {
  data:     FeedEvent[];
  t:        number;         // timestamp corrente ms (scrubber)
  activeId: string | null;  // NEO evidenziato
  onPick:   (a: FeedEvent) => void;
  onHover:  (info: HoverInfo | null) => void;
}
```

Canvas 2D Earth-centric, animato con `requestAnimationFrame`.

**Scala radiale** — logaritmica, 0.3–80 Lunar Distance:
```
scaleR(ld) = minRpx + ((log10(ld) - log10(0.3)) / (log10(80) - log10(0.3))) * (maxRpx - minRpx)
```
`minRpx = 22`, `maxRpx = min(W,H)/2 - 24`.

**Elementi disegnati**:
1. Anelli di riferimento a 1, 5, 20, 60 LD con etichetta
2. Crosshair tratteggiato
3. Terra — cerchio pieno r=8 + alone semitrasparente r=16
4. Per ogni asteroide:
   - **Tail** verso Terra: linea con opacità `1 - offsetDays/12` (visibile entro 12 giorni dall'approccio)
   - **Halo pulsante** (pericolosi): `scale = 1 + sin(Date.now()/340) * 0.18`
   - **Dot**: size ∝ `log10(diameterMax + 0.01) * 3.5 + 7`, clamp 4–14px; rosso se pericoloso, ink se sicuro
   - **Ring + label** se `activeId === a.id`

**Angolo orbitale**:
```
angle = (parseInt(a.id) % 1000 / 1000) * 2π + delta_days * 0.04
```

**Hit detection**: `Math.hypot(px - x, py - y) < 14` sulla lista `_positions` del frame corrente (salvata su `canvasRef.current._positions`).

**Theming**: legge `--ink`, `--ink-2`, `--ink-3`, `--rule`, `--signal` da CSS variables a ogni frame.

---

### `Detail({ neo, onClose })`

Pannello laterale (overlay) con dettaglio completo di un NEO.

- Chiusura via `Escape`
- Banner pericolo / routine
- Figures: distanza min (LD + km + AU), velocità relativa (km/s + km/h), diametro (m ± σ), magnitudine H
- 6 elementi orbitali: semi-asse maggiore, eccentricità, inclinazione, periodo, prima osservazione, n. osservazioni
- `close_approach_data` divisa in **prossimi avvicinamenti** (data ≥ now, max 8) e **avvicinamenti storici** (data < now, ultimi 8 in ordine inverso)
- Link NASA JPL Small-Body DB

### `FiltersAndTable`

- Chip group **Pericolo**: `tutti` / `pericolosi` / `sicuri`
- Chip group **Sort**: `date` / `distance` / `size` / `velocity`
- Date picker **Range**: start → end
- Contatore risultati
- Tabella con bar visuali normalizzate su `maxDist` / `maxSize` del set filtrato
- Tre stati: loading skeleton, empty (Ø), errore range

### `StatesPage`

Pagina statica con 5 edge case: skeleton, HTTP 429, range > 365g, data invalida, catalogo vuoto.

### `SettingsPage({ health })`

KPI strip (cache entries, hit ratio, upstream status, stato proxy) + endpoint contract (4 endpoint) + diagramma chunking 7-day.

### `ColophonView`

Footer con crediti: Arkemis NEO Observatory, sorgenti, stack tecnico.

---

### Stato interno di `DashboardClient`

| State | Tipo | Descrizione |
|-------|------|-------------|
| `theme` | `"dark" \| "light"` | sync su `data-theme` attr + dispatch `arkemis-theme` custom event |
| `page` | `Page` | pagina attiva — routing interno |
| `dateRange` | `{ start, end }` | YYYY-MM-DD |
| `filters` | `Filters` | `{ hazard, sort }` |
| `feed` | `FeedResponse \| null` | |
| `feedLoading` | `boolean` | |
| `feedError` | `string \| null` | |
| `health` | `HealthResponse \| null` | fetch unico all'avvio |
| `pickedId` | `string \| null` | id NEO selezionato |
| `pickedEvent` | `FeedEvent \| null` | evento corrispondente (highlight orbita) |
| `detail` | `NeoDetailResponse \| null` | |
| `detailLoading` | `boolean` | |
| `hovered` | `HoverInfo \| null` | tooltip canvas |
| `clock` | `Date \| null` | da `useUtcClock()` |
| `t` | `number` | timestamp animato ms (scrubber) |
| `playing` | `boolean` | play/pause animazione |
| `speed` | `number` | moltiplicatore: 0.5 / 1 / 3 / 10 |

### Time scrubber

`t` avanza via `requestAnimationFrame`:
```
step = dt_ms * 86400000 / 8000 * speed   // speed=1 → 1 giorno ogni 8 secondi reali
```
Loop su `rangeStart → rangeEnd`. Click sulla track → posizionamento diretto + `setPlaying(false)`.

### Data fetching

Feed con AbortController (cancella al cambio range):
```typescript
useEffect(() => {
  if (rangeError) return;
  const ac = new AbortController();
  getFeed(start, end, ac.signal).then(setFeed)...
  return () => ac.abort();
}, [dateRange, rangeError]);
```

Stesso pattern per `pickedId → getNeo(...)`. Health: fetch unico senza abort.

### `filtered` (useMemo)

1. Copia `feed.near_earth_objects`
2. Applica filtro `hazard`: `"yes"` → solo pericolosi, `"no"` → solo sicuri
3. Ordina per `sort`: `date` (epoch asc), `distance` (lunar asc), `size` (diameter desc), `velocity` (kps desc)

### Marquee

Striscia scorrevole CSS con i NEO pericolosi del range corrente (max 10, duplicati per loop continito). Visibile solo se `marqueeItems.length > 0`.

---

## Dependencies

- [[api-layer]] — `getFeed`, `getNeo`, `getHealth`
- [[charts]] — `DistanceOverTimeChart`, `SizeHistogram`
- `frontend/lib/types` — tutti i tipi
- `frontend/lib/constants` — `DEFAULT_DAYS`
- `"use client"` directive

## Used by

- `frontend/app/page.tsx` — `<DashboardClient />`
- `frontend/app/neo/[id]/page.tsx` — `<DashboardClient standaloneNeoId={id} />`

---

## Notes

- Routing interamente locale via `page` state — nessun Next.js router.
- `OrbitCanvas` è definito nel file per accesso diretto allo state del componente padre.
- Il tema usa un doppio meccanismo: `data-theme` attr su `<html>` (CSS) + evento `arkemis-theme` (re-render palette ECharts).
- `standaloneNeoId` inizializza `pickedId` direttamente — il pannello dettaglio si apre senza interazione utente.
- `rangeError` blocca il fetch: se il range è invalido (invertito, non-ISO, > 365g) l'effect esce immediatamente.
