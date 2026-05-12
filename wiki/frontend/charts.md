---
tags: [frontend, visualization]
updated: 2026-05-12
related: [dashboard-client, api-layer, stack]
---

# charts.tsx

**Percorso**: `frontend/components/charts.tsx`

## Purpose

Tre componenti di visualizzazione basati su ECharts (2D) ed ECharts-GL (3D). Implementa meccanica orbitale Kepleriana per il chart 3D. Tutti i chart sono lazy-loaded per evitare SSR issues.

---

## Key symbols

### `useChart(buildOption, deps) → [ref, failed]`

Custom hook interno:
- Lazy import di `echarts` e `echarts-gl` in un effect (evita `window is not defined` in SSR)
- Crea istanza ECharts sul div referenziato
- Registra resize listener globale
- Cleanup: `instance.dispose()` + `mounted = false` flag per evitare setState su componente smontato
- `failed: boolean` — true se l'import o il render lancia un'eccezione (es. WebGL non supportato)

---

### `Orbital3DChart`

**Props**: `items: FeedEvent[]`

Visualizzazione 3D delle orbite nel sistema solare. Usa `globe3D` + `lines3D` di ECharts-GL.

**Dati renderizzati**:
- Sole (scatter al centro)
- Orbite pianeti interni (Mercurio, Venere, Terra, Marte) — ellissi parametriche calcolate
- Orbite degli asteroidi nel dataset — da elementi Kepleriani NASA
- Punto di close approach — posizione Terra + traccia Terra→asteroide alla data dell'approccio

**`buildOrbitPath({ semiMajorAxis, eccentricity, inclinationDeg, ascendingNodeDeg, perihelionArgumentDeg, ... })`**

Calcola i punti dell'ellisse orbitale in coordinate eliocentriche 3D:
```
r = a(1 - e²) / (1 + e·cos(θ))   [equazione dell'orbita]

x = r · (cos(Ω)·cos(ω+θ) - sin(Ω)·sin(ω+θ)·cos(i))
y = r · (sin(Ω)·cos(ω+θ) + cos(Ω)·sin(ω+θ)·cos(i))
z = r · sin(ω+θ)·sin(i)
```
Dove: `a` = semi-major axis (AU), `e` = eccentricità, `i` = inclinazione, `Ω` = ascending node longitude, `ω` = perihelion argument.

**`getEarthPosition(epochMs) → [x, y, z]`**

Posizione Terra alla data dell'approccio. Formula approssimata (orbita circolare, periodo 365.256 giorni, epoch J2000 = 2000-01-01T12:00 UTC):
```
angle = ((epochMs - J2000_MS) / 86400000 / 365.256) × 2π
[cos(angle), sin(angle), 0]
```

---

### `DistanceOverTimeChart`

**Props**: `items: FeedEvent[]`

Scatter chart 2D: asse X = data approccio, asse Y = distanza di mancato impatto (km). I punti rossi indicano asteroidi potenzialmente pericolosi, blu i sicuri. Tooltip dettagliato al hover.

---

### `SizeDistributionChart`

**Props**: `items: FeedEvent[]`

Bar chart: distribuzione degli asteroidi per fasce di diametro massimo. Fasce: < 0.01 km, 0.01–0.1 km, 0.1–1 km, 1–10 km, > 10 km.

---

### Costanti di supporto

```typescript
const PLANETS = [
  { name: "Mercurio", semiMajorAxis: 0.387, eccentricity: 0.206, ... },
  { name: "Venere",   semiMajorAxis: 0.723, eccentricity: 0.007, ... },
  { name: "Terra",    semiMajorAxis: 1,     eccentricity: 0.017, ... },
  { name: "Marte",    semiMajorAxis: 1.524, eccentricity: 0.093, ... },
];
```

---

## Dependencies

- `echarts` — chart engine (lazy import)
- `echarts-gl` — estensione 3D (lazy import, side-effect only)
- [[api-layer]] — `FeedEvent` type
- `frontend/lib/utils` — `getOrbitClassType`, `getOrbitPaletteColor`

## Used by

- [[dashboard-client]] — `<Orbital3DChart items={filtered} />`, `<DistanceOverTimeChart />`, `<SizeDistributionChart />`

---

## Notes

- Eccentricità clampata a 0.92 in `buildOrbitPath` — evita orbite iperboliche (e ≥ 1) che rompono la formula dell'ellisse.
- Il lazy load di `echarts-gl` è un side-effect import: registra i componenti GL nella registry globale ECharts.
- `getEarthPosition` è un'approssimazione: ignora perturbazioni gravitazionali, obliquità eclittica, inclinazione orbitale terrestre. Sufficiente per la visualizzazione.
- Il `dispose()` nel cleanup hook è fondamentale: ECharts mantiene riferimenti WebGL che causano memory leak se non rilasciati.
