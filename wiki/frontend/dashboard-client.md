---
tags: [frontend, component]
updated: 2026-05-12
related: [charts, api-layer, schemas, system-overview]
---

# dashboard-client.tsx

**Percorso**: `frontend/components/dashboard-client.tsx`

## Purpose

Componente principale del frontend. Gestisce tutto lo stato UI, i data fetch dal backend, i filtri e il routing tra le sezioni della dashboard. È il punto di integrazione tra API layer, chart e presentazione.

---

## Key symbols

### `DashboardClientProps`

```typescript
interface DashboardClientProps {
  standaloneNeoId?: string;  // se presente, apre direttamente il dettaglio NEO
}
```

Usato dalla route `/neo/[id]/page.tsx` per la visualizzazione full-page di un asteroide specifico.

### Stato interno (useState)

| State | Tipo | Descrizione |
|-------|------|-------------|
| `theme` | `"dark" \| "light"` | tema UI, sync su `document.documentElement.dataset.theme` |
| `section` | `PageSection` | sezione attiva: `"overview" \| "orbits" \| "catalog" \| "info"` |
| `range` | `{ start: string, end: string }` | date range corrente (YYYY-MM-DD) |
| `feed` | `FeedResponse \| null` | dati feed dal backend |
| `detail` | `NeoDetailResponse \| null` | dati dettaglio asteroide selezionato |
| `health` | `HealthResponse \| null` | stato sistema (cache, upstream) |
| `loading` | `boolean` | stato caricamento feed |
| `error` | `string \| null` | messaggio errore |
| `hazardFilter` | `HazardFilter` | filtro "all" / "hazardous" / "safe" |
| `sortKey` | `SortKey` | chiave ordinamento catalogo |
| `selectedNeoId` | `string \| null` | asteroide selezionato per modal dettaglio |

### Helpers client-side

```typescript
sortItems(items, sortKey)    // sort: data, distanza, diametro, velocità
filterItems(items, hazard)  // filter: tutti / pericolosi / sicuri
getDefaultRange()            // today - DEFAULT_DAYS(30) → today
```

### Data fetching pattern

Ogni cambio di `range` cancella la richiesta precedente (AbortController) e avvia un nuovo fetch:
```typescript
useEffect(() => {
  const controller = new AbortController();
  getFeed(range.start, range.end, controller.signal)
    .then(setFeed)
    .catch(err => { if (err.name !== "AbortError") setError(err.message); });
  return () => controller.abort();
}, [range]);
```

Stesso pattern per `selectedNeoId` → `getNeo(...)`.

### Sezioni UI

| Sezione | Contenuto |
|---------|----------|
| `overview` | KPI cards (total, hazardous, closest miss, largest diameter, fastest), orbit class summary |
| `orbits` | `Orbital3DChart` + stats per orbit class |
| `catalog` | tabella `near_earth_objects` con sort/filter |
| `info` | health status, cache stats, API docs, rate limit upstream |

### Sub-components interni (non esportati)

- `DetailContent` — view dettagliata di un singolo NEO (tabella close approaches, dati orbitali, link NASA JPL)
- `StateCard` — card generica per stati error/empty/loading
- `DashboardSkeleton` — placeholder animato durante il primo caricamento

### `formatOrbitalLabel(key)` / `formatOrbitalValue(key, value)`

Mapping human-readable per i 16 campi orbitali whitelistati da `_compact_orbital_data`. Gestisce unità (AU, giorni, gradi), abbreviazioni e formati numerici.

### `getApproachStatus(date_str)`

Ritorna `"passato"` o `"previsto"` confrontando la data dell'approccio con oggi. Usato nel catalogo e nel dettaglio NEO.

---

## Dependencies

- [[api-layer]] — `getFeed`, `getNeo`, `getHealth`
- [[charts]] — `Orbital3DChart`, `DistanceOverTimeChart`, `SizeDistributionChart`
- `frontend/lib/formatters` — `formatNumber`, `formatDate`, `formatKilometers`, `formatDiameterKm`
- `frontend/lib/utils` — `getOrbitClassType`, `getOrbitPaletteColor`
- `frontend/lib/types` — tutti i tipi
- `frontend/lib/constants` — `DEFAULT_DAYS`, `SORT_OPTIONS`, `HAZARD_FILTERS`
- `next/navigation` — `useRouter`, `useSearchParams`, `usePathname`
- `next/image` — logo
- `"use client"` directive — richiesto da Next.js App Router (hooks React)

## Used by

- `frontend/app/page.tsx` — `<DashboardClient />`
- `frontend/app/neo/[id]/page.tsx` — `<DashboardClient standaloneNeoId={id} />`

---

## Notes

- Il componente usa `"use client"` — tutto il rendering interattivo è client-side. La parte SSR di Next.js si limita all'HTML iniziale.
- Theme viene salvato in `localStorage` (key `"theme"`) e sincronizzato all'avvio.
- Il routing `/neo/[id]` condivide lo stesso componente della homepage: `standaloneNeoId` altera solo il comportamento iniziale (fetch immediato del NEO).
- `useTransition` è usato per i cambi di sezione: evita il blocco del thread principale durante re-render pesanti (es. chart 3D).
