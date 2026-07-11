# Relazione Tecnica: Infrastruttura Serverless per Previsione del Traffico

Questo documento descrive l'architettura cloud implementata per l'inferenza del modello di Machine Learning, le modalità di deployment su AWS e la configurazione dei test di carico (Stress Testing) eseguiti tramite Locust.

## 1. Scopo del Modello su AWS
Il modello caricato sull'infrastruttura cloud è un classificatore basato su **Random Forest**[cite: 3], precedentemente addestrato per prevedere lo stato di congestione stradale. 
Lo scopo di questo microservizio è ricevere in tempo reale dei file JSON (snapshot) generati da un simulatore React, elaborare lo stato attuale della rete stradale e restituire una previsione per ogni singola tratta (edge).

Il modello analizza tre feature principali per ogni strada[cite: 2, 3]:
* `count`: il numero di veicoli presenti[cite: 2, 3].
* `edgeCapacity`: la capacità massima della strada[cite: 2, 3].
* `edgeDensity`: il rapporto di densità calcolato[cite: 2, 3].

Sulla base di questi dati, il modello classifica lo stato del traffico in quattro categorie: *Libero*, *Rallentato*, *Congestionato* o *Bloccato*[cite: 2].

## 2. Architettura e Processo di Deployment
Il sistema è stato progettato utilizzando un'architettura **Serverless** su Amazon Web Services (AWS), garantendo elevata scalabilità e un modello di costo *pay-as-you-go*. Il deployment ha seguito questi passaggi tecnici:

1. **Containerizzazione (Docker):** Il modello addestrato (`model_rf.joblib`), insieme allo script di gestione `app.py`[cite: 2] e alle dipendenze (es. `scikit-learn`, `pandas`), è stato pacchettizzato in un'immagine Docker.
2. **Amazon ECR (Elastic Container Registry):** L'immagine è stata etichettata e caricata su un repository ECR privato.
3. **AWS Lambda:** È stata creata una funzione Lambda configurata per eseguire l'immagine caricata da ECR. Per garantire le performance ottimali del modello, sono state assegnate risorse specifiche (es. 1024 MB di RAM). 
    * *Nota architetturale:* A causa del file system di sola lettura di Lambda, che inibiva le operazioni di multiprocessing della libreria `joblib`, è stata configurata la variabile d'ambiente `JOBLIB_TEMP_FOLDER=/tmp` per deviare i file temporanei nell'unica porzione di disco scrivibile.
4. **Amazon API Gateway:** La funzione Lambda è stata esposta pubblicamente tramite un endpoint HTTP (API Gateway), permettendo ai client di inviare richieste `POST`.

## 3. Interazione tra Locust e AWS
Per testare la robustezza dell'infrastruttura, è stato utilizzato **Locust**, un framework open-source basato su Python per il Load Testing.

L'interazione è stata modellata per simulare molteplici dispositivi (Edge Gateway) che inviano simultaneamente aggiornamenti sul traffico:
* **Ottimizzazione I/O:** Per evitare colli di bottiglia causati dal disco rigido della macchina locale durante lo stress test, lo script di Locust precarica i file JSON di test (`prova_snapshot.json` o una directory di snapshot) in memoria RAM all'avvio dell'esecuzione.
* **Flusso della Richiesta:** Locust genera utenti virtuali (`HttpUser`). Ogni utente attende un intervallo casuale compreso tra 1 e 3 secondi per simulare un comportamento realistico, dopodiché invia una richiesta HTTP POST all'endpoint di API Gateway contenente il payload JSON.
* **Risposta e Validazione:** AWS Lambda processa il payload, applica il modello e risponde con codice `200 OK`. Locust registra i tempi di risposta (Response Time) e traccia eventuali fallimenti (es. codici `500` o timeout).

## 4. Configurazione degli Stress Test
Per valutare il comportamento del sistema sotto diverse condizioni operative e per estrarre metriche affidabili tramite AWS CloudWatch (es. *Concurrent Executions* e *Duration*), i test sono stati automatizzati impostando un limite di tempo fisso di **3 minuti (180 secondi)** per ciascuno scenario.

Sono stati definiti tre profili di carico incrementali:

### Scenario 1: Carico Basso (Traffico Notturno / Bassa Densità)
Progettato per osservare il comportamento del sistema a riposo e misurare l'impatto del "Cold Start" (il tempo necessario ad AWS per avviare il primo container).
* **Utenti simultanei:** 10
* **Spawn rate (utenti/secondo):** 2
* **Durata:** 3 minuti

### Scenario 2: Carico Medio (Traffico Diurno Standard)
Simula le normali condizioni operative del sistema. L'obiettivo è verificare la stabilizzazione dei tempi di risposta (*Warm Start*) a seguito del riscaldamento dei container.
* **Utenti simultanei:** 50
* **Spawn rate (utenti/secondo):** 5
* **Durata:** 3 minuti

### Scenario 3: Carico Alto (Ora di Punta / Stress Test)
Un test di sforzo per validare la capacità di auto-scaling orizzontale di AWS Lambda. In questo scenario si verifica che l'infrastruttura sia in grado di clonare rapidamente i container per mantenere stabili i tempi di risposta senza far registrare pacchetti scartati o errori (Fails = 0%).
* **Utenti simultanei:** 150
* **Spawn rate (utenti/secondo):** 10
* **Durata:** 3 minuti

## 5. Risultati dei Test di Carico

Tutti i test sono stati eseguiti sulla stessa funzione Lambda (già riscaldata da un test preliminare a 1 utente per verificare l'assenza di errori), sullo stesso payload (`prova_snapshot.json` precaricato in RAM), con durata di 3 minuti ciascuno.

### 5.1 Tabella riassuntiva

| Metrica | 10 utenti | 50 utenti | 100 utenti | 150 utenti |
|---|---|---|---|---|
| Richieste totali | 669 | 3739 | 7444 | 9346 |
| Failures | 0 | 0 | 0 | 0 |
| Throughput (req/s) | 3.72 | 20.77 | 41.35 | 51.90 |
| Mediana | 370 ms | 350 ms | 350 ms | 500 ms |
| Media | 684 ms | 371 ms | 372 ms | 792 ms |
| Min | 291 ms | 263 ms | 253 ms | 246 ms |
| 95° percentile | 970 ms | 480 ms | 530 ms | 2000 ms |
| 99° percentile | 15 000 ms | 780 ms | 750 ms | 3400 ms |
| Massimo (100°) | 17 995 ms | 2961 ms | 2606 ms | 12 882 ms |

*Nota: un primo tentativo del test a 150 utenti, eseguito subito dopo un lungo periodo di inattività della funzione, aveva prodotto risultati molto peggiori (mediana 1600 ms, throughput 36.2 req/s, 99° percentile 9100 ms). Il test è stato ripetuto a distanza di pochi minuti con container Lambda ancora caldi, ottenendo i risultati riportati in tabella. Questa discrepanza è discussa nella sezione 5.3.*

### 5.2 Analisi per scenario

**Scenario 1 (10 utenti) — Cold Start confermato.** Come previsto dall'obiettivo dello scenario, il test a bassa concorrenza è quello con le performance peggiori in assoluto, non le migliori. Con soli 10 utenti e un tempo di attesa casuale di 1-3 secondi tra una richiesta e l'altra, il traffico generato è troppo rado per mantenere i container Lambda caldi: una quota rilevante di richieste incontra un'inizializzazione a freddo (caricamento immagine Docker da ECR, import di `scikit-learn`/`pandas`, caricamento di `model_rf.joblib`). Questo si riflette in una mediana accettabile (370 ms) ma in una coda estrema: 99° percentile a 15 secondi, massimo quasi 18 secondi.

**Scenario 2 (50 utenti) — Warm Start confermato.** Con traffico più continuo, i container restano caldi: la mediana scende leggermente (350 ms) ma soprattutto la coda crolla (99° percentile da 15 000 ms a 780 ms, massimo da 18 s a 3 s). L'obiettivo dello scenario — verificare la stabilizzazione dei tempi di risposta dopo il riscaldamento — è pienamente confermato dai dati.

**Scenario 3 (100 utenti) — scaling lineare, nessun degrado.** Raddoppiando gli utenti rispetto allo Scenario 2, il throughput raddoppia quasi esattamente (20.77 → 41.35 req/s) mentre la distribuzione dei tempi di risposta resta sostanzialmente identica (mediana 350 ms, coda persino leggermente migliore). Zero errori. Questo è il risultato più solido a supporto della scalabilità: l'infrastruttura assorbe un raddoppio del carico concorrente senza alcun impatto percepibile sulle prestazioni.

**Scenario 3 esteso (150 utenti) — primo segnale di rallentamento, senza rottura.** Aumentando ulteriormente il carico (+50% rispetto a 100 utenti), il throughput sale ma non linearmente (51.9 req/s contro un valore atteso di ~62 req/s in scaling perfettamente lineare), e la mediana peggiora (350 → 500 ms), con una coda più marcata (99° percentile 750 → 3400 ms). È il primo punto della progressione in cui si osserva un degrado sistemico (non solo outlier isolati), pur restando **zero i fallimenti**.

### 5.3 Verifica dei limiti di AWS (Service Quotas / CloudWatch)

Per capire se il rallentamento a 150 utenti fosse dovuto a un limite duro dell'account (l'infrastruttura gira su un account **AWS Academy Learner Lab**, con quote potenzialmente ridotte rispetto a un account standard), sono state controllate le seguenti metriche durante il test:

* **Service Quotas → AWS Lambda → Concurrent executions:** quota applicata 1000 (uguale al default AWS), con un picco di utilizzo osservato di sole **45 esecuzioni concorrenti** — circa il 4.5% della capacità disponibile.
* **CloudWatch → Throttles:** **0** per l'intera durata del test.

**Conclusione:** il rallentamento osservato a 150 utenti **non è causato da un limite di quota dell'account Academy**. È più probabile che sia dovuto al normale comportamento di scaling di AWS Lambda: gestire 45 esecuzioni concorrenti (contro le ~20 tipiche a 100 utenti) richiede l'istanziazione di più container nuovi rispetto a quanti erano già caldi, e ciascun nuovo container paga individualmente il costo di inizializzazione. Questo spiega perché il degrado colpisce una quota maggiore di richieste (mediana in aumento) ma non tutte.

Questa verifica conferma inoltre un margine ampio rispetto ai limiti imposti dall'account Academy: con throttling a zero e utilizzo al 4.5% della quota di concorrenza, resta ampio spazio per testare carichi ben superiori a 150 utenti concorrenti.

## 6. Piano dei Prossimi Test (entro i limiti dell'account Academy)

L'infrastruttura gira su un account **AWS Academy Learner Lab**, che impone vincoli non modificabili dall'utente (budget monetario limitato, tempo di sessione limitato, nessuna possibilità di richiedere aumenti di quota). L'obiettivo dei prossimi test è quindi individuare il vero limite di scalabilità del servizio **senza rischiare di esaurire il budget, la sessione, o di generare pattern di utilizzo anomali** che potrebbero attirare attenzione sull'account.

### 6.1 Controlli preliminari (da fare prima di ogni nuova sessione di test)

Prima di lanciare qualunque test aggiuntivo:
* Controllare il **countdown della sessione** e il **budget residuo** nel pannello del Learner Lab.
* Verificare su **Service Quotas → AWS Lambda → Concurrent executions** che la quota applicata sia ancora 1000 (nessuna riduzione imposta nel frattempo).
* Aprire **CloudWatch → Throttles** sulla funzione, da tenere sotto osservazione durante ogni test successivo: un valore diverso da zero è il segnale che si è vicini a un vero limite di concorrenza e che il test in corso va fermato.

### 6.2 Sequenza di test consigliata

I test vanno eseguiti in **ordine crescente e incrementale**, fermandosi non appena compare uno dei segnali di allarme descritti al punto 6.3 — non è necessario né consigliabile eseguire subito il test più pesante.

1. **Retest a 150 utenti (terzo tentativo, subito dopo un altro test a 150).** Serve a confermare, con container già caldi, che il servizio si avvicina al throughput teorico atteso (~62 req/s) e a una mediana vicina ai 350 ms. Costo e durata identici ai test già eseguiti (3 minuti, ~9000 richieste): nessun rischio aggiuntivo per l'account.
2. **200 utenti concorrenti**, stesso spawn rate proporzionale (~13 utenti/secondo), 3 minuti. A questo livello l'utilizzo di concurrent executions atteso resta nell'ordine delle 60-70 unità — ancora ben sotto il 10% della quota da 1000, quindi sicuro da eseguire.
3. **300 utenti concorrenti**, stesso criterio, 3 minuti. Utilizzo atteso ~90-100 esecuzioni concorrenti (~10% della quota): livello ancora sicuro, ma da qui in poi controllare CloudWatch Throttles ad ogni test prima di procedere oltre.
4. **500 utenti concorrenti**, solo se i test precedenti non hanno mostrato failure né throttling. A questo punto conviene ridurre la durata del test a 2 minuti per limitare il numero totale di invocazioni (e quindi il consumo di budget) mantenendo comunque un campione statistico sufficiente.

**Non superare i 500 utenti senza prima verificare il budget residuo**: oltre questa soglia il numero di invocazioni per test da 3 minuti supera le 15-20 mila richieste, con un impatto sul budget non trascurabile su un account con credito limitato.

### 6.3 Segnali di STOP (fermare immediatamente la campagna di test)

Interrompere subito la sequenza di test, senza salire ulteriormente di livello, se durante un test si osserva anche solo uno di questi segnali:
* **Failures > 0%** in Locust (errori 429, 500, 502, 503 o timeout).
* **CloudWatch Throttles > 0**.
* **CloudWatch ConcurrentExecutions** che si appiattisce su un valore costante per l'intera durata del test (segno che si è raggiunto un tetto, anche se non ancora quello di account).
* Budget residuo del Learner Lab sceso sotto una soglia di sicurezza (es. 10-15% del totale) o sessione in scadenza entro i successivi 15-20 minuti.

Il primo livello di carico in cui si osserva uno di questi segnali **è** il limite di scalabilità del servizio da riportare nella relazione finale — a quel punto i test possono fermarsi, perché l'obiettivo (trovare il limite, non superarlo a tutti i costi) è raggiunto.

### 6.4 Test complementari, a basso rischio, da eseguire in parallelo o dopo la sequenza principale

Questi test non aumentano il carico oltre quanto già pianificato al punto 6.2, quindi non introducono rischio aggiuntivo per l'account, ma arricchiscono l'analisi:
* **Monitoraggio sistematico di CloudWatch** (`ConcurrentExecutions`, `Throttles`, `Duration`, `Init Duration`) durante ogni test della sequenza sopra, per distinguere oggettivamente quanta latenza è dovuta a cold start e quanta a tempo di esecuzione del modello.
* **Test con spawn rate diverso a parità di utenti finali** (es. 150 utenti raggiunti in 5 secondi invece che 15), utile per capire se è la velocità della scalata, più che il numero assoluto di utenti, a generare il transiente di latenza osservato — da eseguire solo su un livello di utenti già validato come sicuro (es. 150), senza salire oltre.
* **Valutazione di Provisioned Concurrency** su un numero contenuto di container (10-20), come possibile mitigazione architetturale del transiente di cold start, da citare nella relazione come raccomandazione per un eventuale scenario di produzione (non richiede necessariamente nuovi test di carico se il budget residuo è scarso).

*Non è consigliato, in un account Academy, un test di tipo "sustained load" prolungato (15-30 minuti a carico costante): il rapporto tra informazione aggiuntiva ottenuta e consumo di budget/tempo sessione non è favorevole rispetto alla sequenza incrementale sopra descritta.*