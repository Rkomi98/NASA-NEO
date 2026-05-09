# Arkemis NEO Dashboard

<p align="center">
  <strong>Una dashboard full-stack per leggere, filtrare e raccontare i Near Earth Objects della NASA</strong><br/>
  con <code>Next.js</code>, <code>FastAPI</code>, <code>ECharts</code> e un proxy intelligente che protegge la chiave NASA.
</p>

<p align="center">
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js-15-black?style=flat-square&logo=nextdotjs&logoColor=white">
  <img alt="FastAPI" src="https://img.shields.io/badge/FastAPI-Proxy-009688?style=flat-square&logo=fastapi&logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-Strict-3178C6?style=flat-square&logo=typescript&logoColor=white">
  <img alt="Python" src="https://img.shields.io/badge/Python-Backend-3776AB?style=flat-square&logo=python&logoColor=white">
  <img alt="ECharts" src="https://img.shields.io/badge/Apache%20ECharts-Visuals-AA344D?style=flat-square&logo=apacheecharts&logoColor=white">
  <img alt="NASA NeoWs" src="https://img.shields.io/badge/NASA-NeoWs-0B3D91?style=flat-square&logo=nasa&logoColor=white">
  <img alt="Cache" src="https://img.shields.io/badge/Cache-File--based-5B6470?style=flat-square">
</p>

<p align="center">
  <a href="#-quick-start">Quick Start</a> ·
  <a href="#-progetto-in-30-secondi">Panoramica</a> ·
  <a href="#-api-implementate">API</a> ·
  <a href="#-deploy">Deploy</a>
</p>

---

## **Quick Cards**

<table>
  <tr>
    <td width="25%">
      <h3>🚀 Quick Start</h3>
      <p>Avvio locale di frontend e backend, variabili ambiente e check rapidi.</p>
      <p><a href="#-quick-start">Vai alla sezione</a></p>
    </td>
    <td width="25%">
      <h3>🛰️ Architettura</h3>
      <p>Monorepo con <code>frontend/</code>, <code>backend/</code>, cache file-based e contratti API chiari.</p>
      <p><a href="#-progetto-in-30-secondi">Scopri la struttura</a></p>
    </td>
    <td width="25%">
      <h3>📡 API</h3>
      <p>Feed con chunking oltre 7 giorni, dettaglio NEO, health e invalidazione cache.</p>
      <p><a href="#-api-implementate">Vedi gli endpoint</a></p>
    </td>
    <td width="25%">
      <h3>🌍 Deploy</h3>
      <p>Setup consigliato con Vercel + Render/Railway/Fly.io e nota su GitHub Pages.</p>
      <p><a href="#-deploy">Apri la guida</a></p>
    </td>
  </tr>
</table>

<img width="729" height="322" alt="image" src="https://github.com/user-attachments/assets/174d3d9e-48b0-4ef7-bce8-0c7bd27463a3" />
_Figura 01: Piccola ricostruzione delle orbite di due asteroidi nel mese di Maggio_

## **Progetto In 30 Secondi**

Arkemis NEO Dashboard prende i dati grezzi di **NASA NeoWs** e li trasforma in un’esperienza leggibile, filtrabile e visivamente forte.  
Il browser non tocca mai direttamente `api.nasa.gov`: parla solo con il backend FastAPI, che fa da proxy, spezza i range lunghi, mette in cache le risposte e restituisce al frontend un payload già pronto per lista, grafici e schede dettaglio.

### Perché questo progetto è utile
- evita di esporre `NASA_API_KEY` nel browser
- gestisce automaticamente il limite NASA dei 7 giorni per chiamata
- riusa i chunk già scaricati grazie alla cache file-based
- offre una UI moderna con stati di loading, errore ed empty robusti
- mantiene il feeling editoriale del mock `Arkemis`

## **Struttura**

```text
NASA NEO/
├── frontend/   # Next.js + TypeScript + ECharts
├── backend/    # FastAPI + httpx + cache file-based
├── docs/       # guide e approfondimenti
├── arkemis/    # handoff bundle del design, solo reference
├── .env.example
└── README.md
```

## **Cosa Fa**

<table>
  <tr>
    <td width="50%">
      <h3>Backend intelligente</h3>
      <ul>
        <li>proxy unico verso NASA NeoWs</li>
        <li>chunking automatico oltre 7 giorni</li>
        <li>cache feed e dettaglio NEO</li>
        <li>mapping errori e metriche health</li>
      </ul>
    </td>
    <td width="50%">
      <h3>Frontend orientato all'esplorazione</h3>
      <ul>
        <li>dashboard editoriale dark/light</li>
        <li>filtri per rischio e ordinamenti</li>
        <li>grafici ECharts 2D + vista 3D orbitale</li>
        <li>modal dettaglio e pagina standalone <code>/neo/[id]</code></li>
      </ul>
    </td>
  </tr>
</table>

## **Quick Start**

### Prerequisiti
- Node.js 20+ consigliato
- Python 3.9+
- una chiave NASA da inserire nel file `.env`

### Variabili ambiente

```env
NASA_API_KEY=replace-with-your-nasa-api-key
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000
```

Puoi partire copiando [.env.example](/Users/mirkocalcaterra/Documents/GitHub/NASA NEO/.env.example).

### Avvio backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

### Avvio frontend

```bash
cd frontend
npm install
npm run dev
```

### URL locali
- Frontend: [http://localhost:3000](http://localhost:3000)
- Backend: [http://127.0.0.1:8000](http://127.0.0.1:8000)

## **API Implementate**

| Metodo | Endpoint | Descrizione |
|---|---|---|
| `GET` | `/api/feed?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD` | Feed flatten dei close approach, con chunking automatico e cache |
| `GET` | `/api/neo/{id}` | Dettaglio completo del singolo asteroide |
| `GET` | `/api/health` | Stato del backend, cache stats e ultimi rate-limit NASA noti |
| `POST` | `/api/cache/invalidate` | Invalidazione cache per sviluppo e manutenzione |

## **Scelte Tecniche**

### Backend
- `FastAPI` come proxy unico verso NASA
- `httpx.AsyncClient` per le chiamate upstream
- cache file-based con TTL distinti:
  - feed chunk: 12 ore
  - dettaglio NEO: 72 ore
- concorrenza upstream limitata a `2`
- risposta feed normalizzata in array flat, pronta per la UI

### Frontend
- `Next.js` App Router + `TypeScript`
- `ECharts` per scatter, distribuzione dimensioni e vista 3D
- routing con deep-link su query params e pagina standalone
- filtri e sort client-side per velocità e semplicità

## **Verifica**

### Backend

```bash
cd backend
pytest
```

### Frontend

```bash
cd frontend
npm run typecheck
npm run build
```

## **Deploy**

### Configurazione consigliata
- frontend su **Vercel**
- backend su **Render**, **Railway** o **Fly.io**

### Nota importante
**GitHub Pages da sola non basta**, perché può ospitare solo asset statici: il proxy FastAPI è necessario per chiave NASA, cache, chunking e normalizzazione.

Per la guida completa vedi [docs/deployment-guide.md](docs/deployment-guide.md).

## **Documentazione Extra**

<table>
  <tr>
    <td width="50%">
      <h3>📘 Idee dati e visualizzazioni</h3>
      <p>Un elenco ampio di tutto ciò che puoi mostrare a partire da NeoWs, JPL e CNEOS.</p>
      <p><a href="docs/neo-data-display-ideas.md">Apri il file</a></p>
    </td>
    <td width="50%">
      <h3>🧭 Guida alla pubblicazione</h3>
      <p>Scelte hosting, variabili ambiente, limiti di GitHub Pages e setup consigliato.</p>
      <p><a href="docs/deployment-guide.md">Apri il file</a></p>
    </td>
  </tr>
</table>

---

<p align="center">
  <em>Il mock vive in <code>arkemis/</code>. L'app reale vive in <code>frontend/</code> e <code>backend/</code>.</em>
</p>
