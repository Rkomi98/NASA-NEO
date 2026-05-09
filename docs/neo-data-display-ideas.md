# Idee di dati e visualizzazioni per NeoWs

## Disponibili direttamente da NeoWs
- Nome, designation, `neo_reference_id`, link JPL.
- Flag `is_potentially_hazardous_asteroid` e `is_sentry_object`.
- Magnitudine assoluta `absolute_magnitude_h`.
- Diametro stimato in chilometri, metri, miglia e piedi.
- `close_approach_data` con data, velocita' relativa, distanza in km, AU e distanze lunari, corpo orbitato.
- `orbital_data` con classe orbitale, periodo, eccentricita', inclinazione, semi asse maggiore, perielio, afelio, MOID, osservazioni usate, prime e ultime osservazioni.

## Derivabili dai dati NeoWs
- Ranking per distanza minima nel range.
- Ranking per diametro massimo o minimo.
- Ranking per velocita' relativa.
- Confronto con la distanza Terra-Luna.
- Bucket dimensionali per istogrammi.
- Conteggio eventi per giorno o settimana.
- Percentuale di oggetti potenzialmente pericolosi sul totale.
- Densita' di flyby nel tempo.
- Heatmap data vs rischio.
- Timeline degli avvicinamenti storici per singolo oggetto.
- Correlazione diametro vs velocita'.
- Correlazione magnitudine assoluta vs diametro stimato.

## Arricchimenti ispirati a NASA, JPL e CNEOS
- Evidenziare la soglia "Potentially Hazardous" come fa Asteroid Watch: circa 140 m e approcci entro 7.5 milioni di km / 19.5 LD.
- Confronto con "Next Five Asteroid Approaches" di JPL.
- Glossario classi orbitali: Apollo, Aten, Amor, Atira.
- Spiegazione Planetary Defense per contestualizzare `is_sentry_object`.
- CTA verso scheda JPL Small-Body Database.
- Pannello su MOID e significato pratico dell'intersezione orbitale minima.
- Story card su perche' molti headline sembrano allarmistici rispetto alle distanze reali.
- Vista 3D orbitale ispirata a Eyes on Asteroids.

## Elementi opzionali per versioni future
- Preset rapidi: prossimi 7, 30, 90 giorni.
- Comparatore tra due asteroidi.
- Bookmark locale degli oggetti piu' interessanti.
- Export CSV/JSON del feed flatten.
- Stato della cache e ultimo rate limit NASA direttamente in dashboard.
