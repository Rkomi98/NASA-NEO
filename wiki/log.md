---
tags: [log, navigation]
updated: 2026-05-16
---

# Log degli ingest

Cronologia dei momenti in cui questa wiki è stata aggiornata.

---

## 2026-05-16 — Aggiornamento frontend post-refactor

**Scope**: frontend (dashboard-client.tsx + charts.tsx)
**Commit di riferimento**: `01fd0ef` (Pronto per il merge)
**File sorgente processati**: 2 TypeScript
**Pagine aggiornate**: 2 (dashboard-client, charts)

**Cambiamenti principali**:
- `dashboard-client.md` — riscrittura completa: nuovo routing interno (`Page` type), `OrbitCanvas` 2D, state machine aggiornata, scrubber temporale, marquee NEO pericolosi, `useUtcClock`, `Detail`/`FiltersAndTable`/`StatesPage`/`SettingsPage`
- `charts.md` — rimosso `Orbital3DChart` (spostato in Canvas 2D), rimosso `useChart` lazy → `useEChart` sincrono, rinominato `SizeDistributionChart` → `SizeHistogram` con fasce in metri, aggiunto `cssColors()` e sync tema via `arkemis-theme`
- Rimossa dipendenza `echarts-gl` dal frontend

---

## 2026-05-12 — Ingest iniziale completo

**Scope**: intero repository (backend + frontend)
**Metodo**: analisi statica di tutti i file sorgente + lettura del pattern Karpathy
**File processati**: 15 file sorgente Python, 6 file TypeScript
**Pagine create**: 18 (navigation × 2, architecture × 3, backend × 8, frontend × 3, concepts × 3)

**Note**: prima analisi del repo. Struttura stabile — nessuna migration in corso.
Commit di riferimento: `62e69ca` (Refactor base).

---

## Come aggiornare

Quando cambia codice rilevante:

1. Leggi il file modificato
2. Aggiorna la pagina wiki corrispondente (sezioni Purpose, Key symbols, Notes)
3. Aggiorna i link se cambiano dipendenze
4. Aggiungi una riga in questo log con scope e data
