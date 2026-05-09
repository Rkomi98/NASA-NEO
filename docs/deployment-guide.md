# Guida alla pubblicazione

## Architettura consigliata
- Frontend su Vercel.
- Backend FastAPI su Render, Railway o Fly.io.
- Variabile frontend `NEXT_PUBLIC_API_BASE_URL` puntata al dominio del backend.
- Variabile backend `NASA_API_KEY` configurata nella piattaforma scelta.

## Perche' GitHub Pages da sola non basta
GitHub Pages puo' ospitare solo asset statici. Il backend FastAPI serve per:
- proteggere la chiave NASA;
- fare caching lato server;
- spezzare i range oltre 7 giorni;
- restituire errori e payload normalizzati.

Se vuoi usare GitHub Pages, devi pubblicare il backend separatamente e configurare CORS.

## Deploy frontend su Vercel
1. Importa la cartella `frontend/` come progetto.
2. Build command: `npm run build`
3. Output: gestito da Next.js
4. Environment variable: `NEXT_PUBLIC_API_BASE_URL=https://tuo-backend.example.com`

## Deploy backend su Render o Railway
1. Crea un servizio Python puntando a `backend/`.
2. Installa dipendenze con `pip install -r requirements.txt`.
3. Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
4. Configura `NASA_API_KEY`.
5. Se usi un dominio diverso dal frontend, aggiorna `allowed_origins` o aggiungi una variabile dedicata.

## Deploy ibrido con GitHub Pages
1. Esporta il frontend in una forma compatibile oppure usa un hosting statico alternativo.
2. Mantieni FastAPI su un provider server-side.
3. Configura `NEXT_PUBLIC_API_BASE_URL` o equivalente build-time verso il backend pubblico.

## Checklist finale
- `NASA_API_KEY` presente solo lato backend.
- CORS allineato al dominio frontend.
- Cache directory persistente o almeno non volatile se vuoi mantenere gli hit dopo restart.
- Test locale `GET /api/feed` e `GET /api/neo/{id}` prima del go-live.
