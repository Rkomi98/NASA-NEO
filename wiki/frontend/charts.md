---
tags: [frontend, visualization]
updated: 2026-05-16
related: [dashboard-client, api-layer, stack]
---

# charts.tsx

**Percorso**: `frontend/components/charts.tsx`

## Purpose

Due componenti di visualizzazione ECharts 2D: scatter chart distanza/tempo e istogramma diametri. Entrambi si aggiornano automaticamente al cambio tema tramite l'evento `arkemis-theme`.

---

## Key symbols

### `cssColors()`

```typescript
function cssColors() → { ink, ink2, ink3, rule, signal, paper }
```

Legge le CSS variables del tema corrente da `document.documentElement`. Se `document` non è disponibile (SSR), restituisce i valori del tema dark come fallback. Chiamata a ogni `buildOption` per garantire coerenza con il tema attivo.

---

### `useEChart(buildOption, deps) → ref`

```typescript
function useEChart(buildOption: () => object, deps: unknown[]) → React.RefObject<HTMLDivElement>
```

Hook interno per la gestione del ciclo di vita di un'istanza ECharts.

- **Init**: `echarts.init(el)` sincrono
- **Listeners**:
  - `resize` → `instance.resize()`
  - `arkemis-theme` (custom event) → `instance.setOption(buildOption(), true)` — aggiorna palette senza distruggere il chart
- **Update**: effect separato su `deps` → `instance.setOption(buildOption(), true)`
- **Cleanup**: rimozione listener + `instance.dispose()` + `inst.current = null`

---

### `DistanceOverTimeChart`

```typescript
interface DistanceOverTimeChartProps {
  data:     FeedEvent[];
  currentT: number;   // timestamp ms — posizione del cursore temporale
}
```

Scatter chart: asse X = data approccio (`type: "time"`), asse Y = distanza miss in Lunar Distance (`type: "log"`, base 10).

**Serie**:
- `safe` — punti `--ink-2`, opacità 0.55, `symbolSize` ∝ `log10(diameterMax + 0.01) * 9 + 16`, clamp 10–38px
- `haz` — punti `--signal`, opacità 0.90, clamp 14–46px
- `markLine` verticale `NOW` a `currentT` — linea `--signal` semitrasparente
- `markLine` orizzontale `moon · 1 LD` a y=1 — linea tratteggiata

Tooltip: nome asteroide in corsivo + data ISO + distanza LD.

---

### `SizeHistogram`

```typescript
interface SizeHistogramProps {
  data: FeedEvent[];
}
```

Bar chart stacked per fasce di diametro massimo stimato:

| Label | Range (km) |
|-------|-----------|
| `<50 m` | 0 – 0.05 |
| `50–140` | 0.05 – 0.14 |
| `140–500` | 0.14 – 0.5 |
| `500m–1k` | 0.5 – 1 |
| `>1 km` | 1 – 100 |

Serie stackate: `Sicuri` (grigio warm, bassa opacità, bordo) e `Pericolosi` (`--signal`, opacità 0.88). Asse Y: `max = ceil(v.max * 1.22)` per lasciare 22% di headroom.

---

## Dependencies

- `echarts` — import diretto sincrono
- [[api-layer]] — tipo `FeedEvent`

## Used by

- [[dashboard-client]] — `<DistanceOverTimeChart data={filtered} currentT={t} />`, `<SizeHistogram data={filtered} />`

---

## Notes

- L'import sincrono di `echarts` è possibile perché il file è marcato `"use client"` — non incluso nel bundle server.
- Il dispose nel cleanup è fondamentale: ECharts mantiene riferimenti interni che causano memory leak se non rilasciati esplicitamente.
