# Guida dettagliata al deploy su Vercel e Render

Questa applicazione e' un monorepo con due servizi distinti:

- `frontend/`: app `Next.js`
- `backend/`: API `FastAPI` che fa da proxy verso NASA NeoWs

La combinazione consigliata per questo repo e':

- `Vercel` per il frontend
- `Render` per il backend

Questa e' anche l'opzione piu' semplice da mantenere, perche' separa bene UI e API e ti permette di tenere `NASA_API_KEY` solo lato server.

## Architettura finale

```text
Browser utente
   |
   v
Frontend Next.js su Vercel
   |
   v
Backend FastAPI su Render
   |
   v
NASA NeoWs API
```

## Prima di iniziare

Assicurati di avere:

- un repository GitHub aggiornato
- una chiave NASA valida
- un account Vercel
- un account Render

Nel progetto, le variabili base gia' previste sono:

```env
NASA_API_KEY=replace-with-your-nasa-api-key
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000
ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001
```

## Strategia consigliata

L'ordine giusto e':

1. deploy del backend su Render
2. recupero dell'URL pubblico del backend
3. deploy del frontend su Vercel puntando a quell'URL
4. aggiornamento CORS del backend per autorizzare il dominio Vercel
5. test finale end-to-end

## 1. Verifica locale prima del deploy

Prima di pubblicare, conviene verificare che tutto parta in locale.

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Test rapidi:

- `http://127.0.0.1:8000/`
- `http://127.0.0.1:8000/api/health`

### Frontend

In un secondo terminale:

```bash
cd frontend
npm install
npm run dev
```

Test rapido:

- `http://localhost:3000`

### Verifiche utili

```bash
cd backend
pytest
```

```bash
cd frontend
npm run typecheck
npm run build
```

Se questi check falliscono in locale, e' meglio sistemarli prima del deploy.

## 2. Deploy del backend su Render

### Cosa andrai a creare

Su Render devi creare un `Web Service` Python che punti alla cartella `backend/`.

### Passaggi in dashboard

1. Apri Render.
2. Clicca `New +`.
3. Scegli `Web Service`.
4. Collega il repository GitHub.
5. Seleziona il repo di questo progetto.

### Impostazioni consigliate

Compila cosi':

- `Root Directory`: `backend`
- `Environment`: `Python 3`
- `Build Command`: `pip install -r requirements.txt`
- `Start Command`: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`

### Variabili ambiente su Render

Aggiungi almeno:

- `NASA_API_KEY` = la tua chiave NASA reale
- `ALLOWED_ORIGINS` = dominio del frontend Vercel, ad esempio `https://tuo-frontend.vercel.app`

Puoi aggiungere anche variabili opzionali in futuro, ma per partire questa e' quella indispensabile.

### Piano gratuito o a pagamento

Il piano gratuito puo' andare bene per demo e portfolio, ma considera che:

- il servizio puo' andare in sleep
- il primo caricamento dopo inattivita' puo' essere lento
- la cache locale puo' non essere persistente nel tempo

Per una demo stabile, un piano non-sleep e' migliore.

### URL del backend

Quando il deploy finisce, Render ti dara' un URL del tipo:

```text
https://nasa-neo-backend.onrender.com
```

Salvalo: ti servira' subito per Vercel.

### Test backend pubblico

Appena online, verifica:

- `https://tuo-backend.onrender.com/`
- `https://tuo-backend.onrender.com/api/health`

Se questi endpoint non rispondono, non passare ancora al frontend.

## 3. Configurare il frontend per puntare a Render

Il frontend legge la base URL dell'API da:

```text
NEXT_PUBLIC_API_BASE_URL
```

In produzione dovra' valere qualcosa come:

```env
NEXT_PUBLIC_API_BASE_URL=https://nasa-neo-backend.onrender.com
```

Importante:

- niente slash finale, a meno che tu non voglia gestirlo esplicitamente ovunque
- essendo `NEXT_PUBLIC_`, questa variabile finisce nel bundle client ed e' corretto cosi'
- `NASA_API_KEY` invece non deve mai stare nel frontend

## 4. Deploy del frontend su Vercel

### Cosa andrai a creare

Su Vercel devi importare il progetto `Next.js` contenuto in `frontend/`.

### Passaggi in dashboard

1. Apri Vercel.
2. Clicca `Add New...`
3. Scegli `Project`.
4. Importa il repository GitHub.
5. Seleziona il repo di questo progetto.

### Impostazioni consigliate

Configura cosi':

- `Framework Preset`: `Next.js`
- `Root Directory`: `frontend`
- `Build Command`: `npm run build`
- `Install Command`: `npm install`

Lo start viene gestito automaticamente da Vercel per le app Next.js.

### Variabili ambiente su Vercel

Aggiungi:

- `NEXT_PUBLIC_API_BASE_URL` = URL pubblico del backend Render

Poi lancia il deploy.

### URL del frontend

Alla fine otterrai un dominio del tipo:

```text
https://nasa-neo-frontend.vercel.app
```

Salvalo, perche' ora serve per il CORS del backend.

## 5. Punto critico: CORS del backend

Questo progetto, nello stato attuale, consente di default solo origin locali:

- `http://localhost:3000`
- `http://127.0.0.1:3000`
- `http://localhost:3001`
- `http://127.0.0.1:3001`

Il comportamento e' definito in:

- [backend/app/core/config.py](/Users/mirkocalcaterra/Documents/GitHub/NASA NEO/backend/app/core/config.py)
- [backend/app/main.py](/Users/mirkocalcaterra/Documents/GitHub/NASA NEO/backend/app/main.py)

Quindi, se pubblichi il frontend su Vercel senza aggiornare questa parte, il browser blocchera' le chiamate al backend.

### Cosa devi fare

Hai due strade.

### Strada consigliata

Rendi gli origin configurabili via variabile ambiente, usando `ALLOWED_ORIGINS`.

Esempio di approccio:

- leggi una stringa CSV o JSON da env
- usala per valorizzare `allow_origins`
- mantieni i localhost come fallback per sviluppo

Questa opzione e' migliore se vuoi:

- anteprime Vercel
- dominio custom
- piu' ambienti di test

Esempio:

```env
ALLOWED_ORIGINS=https://tuo-frontend.vercel.app
```

Se vuoi supportare anche piu' domini:

```env
ALLOWED_ORIGINS=https://tuo-frontend.vercel.app,https://tuo-custom-domain.it
```

### Nota sulle preview di Vercel

Se usi le preview branch di Vercel, l'URL cambia spesso. In quel caso conviene:

- supportare una lista di origin dinamica via env
- oppure usare un `allowed_origin_regex` adatto ai domini Vercel

Ad esempio, un regex per preview Vercel potrebbe essere impostato in modo da accettare i domini `*.vercel.app`, ma e' bene farlo con criterio, evitando aperture troppo larghe.

## 6. Ridistribuzione corretta dopo il CORS

Dopo aver sistemato il CORS:

1. Render ridistribuisce il backend
2. Vercel usa gia' la variabile `NEXT_PUBLIC_API_BASE_URL`
3. apri il frontend pubblico
4. verifica che la dashboard carichi i dati reali

Se la UI si apre ma non mostra dati, apri i log o la console browser:

- errore CORS: backend non autorizza il dominio Vercel
- errore 500: problema sul backend o `NASA_API_KEY` assente
- errore 404/failed fetch: `NEXT_PUBLIC_API_BASE_URL` errata

## 7. Checklist completa di go-live

### Backend Render

- `Root Directory` impostata a `backend`
- `Build Command` corretto
- `Start Command` corretto
- `NASA_API_KEY` presente
- endpoint `/` e `/api/health` raggiungibili

### Frontend Vercel

- `Root Directory` impostata a `frontend`
- `NEXT_PUBLIC_API_BASE_URL` presente
- build completata senza errori
- home pubblica raggiungibile

### Integrazione

- il dominio Vercel e' autorizzato dal CORS del backend
- la dashboard carica i dati NASA
- la pagina dettaglio NEO funziona
- nessuna chiave segreta compare nel client

## 8. Troubleshooting rapido

### Il frontend si apre ma le chiamate API falliscono

Controlla:

- `NEXT_PUBLIC_API_BASE_URL` su Vercel
- CORS nel backend
- che il backend Render sia davvero online

### Render va online ma poi il primo caricamento e' lentissimo

Probabile causa:

- istanza free in sleep

Soluzioni:

- piano senza sleep
- usare Render solo per demo non time-sensitive

### Il backend parte ma crasha subito

Controlla:

- `NASA_API_KEY` configurata
- `Start Command` identico a quello consigliato
- log di deploy Render

### Vercel builda ma la UI mostra ancora l'URL vecchio

Possibili cause:

- env var modificata senza nuovo deploy
- typo nel nome `NEXT_PUBLIC_API_BASE_URL`
- valore con protocollo o dominio errato

### Le preview Vercel non funzionano ma la produzione si'

Causa tipica:

- il backend autorizza solo il dominio principale, non i domini preview

## 9. Configurazione minima consigliata

Se vuoi la versione piu' lineare possibile:

### Render

- servizio web da `backend/`
- build: `pip install -r requirements.txt`
- start: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- env: `NASA_API_KEY=...`

### Vercel

- progetto da `frontend/`
- env: `NEXT_PUBLIC_API_BASE_URL=https://tuo-backend.onrender.com`

### Codice

- aggiungi il dominio Vercel agli origin consentiti del backend

## 10. Flusso operativo consigliato in 10 minuti

1. pusha il repo su GitHub
2. crea il backend su Render con root `backend`
3. imposta `NASA_API_KEY`
4. attendi l'URL pubblico Render
5. crea il frontend su Vercel con root `frontend`
6. imposta `NEXT_PUBLIC_API_BASE_URL` verso Render
7. deploy frontend
8. aggiungi il dominio Vercel agli origin backend
9. ridistribuisci il backend
10. testa home, feed e dettaglio NEO dal dominio pubblico

## 11. Nota su cache e persistenza

Il backend usa una cache file-based. Su hosting come Render:

- i file locali possono non essere un layer persistente affidabile nel lungo periodo
- un riavvio o ridistribuzione puo' azzerare la cache

Questo non impedisce il funzionamento dell'app, ma significa che:

- la cache migliora soprattutto le richieste finche' l'istanza resta attiva
- non devi considerarla storage permanente

Se in futuro vuoi una cache piu' robusta, puoi migrare verso Redis o simili.

## 12. Conclusione pratica

Per questo progetto la strada giusta e':

- `Render` per proteggere `NASA_API_KEY` e tenere il proxy FastAPI online
- `Vercel` per servire il frontend Next.js

Il solo punto davvero delicato non e' il deploy in se', ma il collegamento tra i due servizi:

- URL backend corretta nel frontend
- CORS aperto al dominio frontend

Se questi due elementi sono a posto, il deploy fila liscio.
