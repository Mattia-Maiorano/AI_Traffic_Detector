from locust import HttpUser, task, between
import json
import os

# =========================================================
# 1. PRE-CARICAMENTO DEI DATI REALI (OTTIMIZZAZIONE PRESTAZIONI)
# Leggiamo il file una volta sola in memoria RAM per evitare
# di saturare il disco rigido durante lo stress test.
# =========================================================
FILE_PATH = "prova_snapshot.json"

try:
    with open(FILE_PATH, "r") as f:
        PRELOADED_PAYLOAD = json.load(f)
        print(f"[OK] File {FILE_PATH} caricato in memoria con successo!")
except FileNotFoundError:
    print(f"[ERRORE] Il file {FILE_PATH} non è stato trovato!")
    # Fallback fittizio per evitare il blocco totale del codice in caso di errore
    PRELOADED_PAYLOAD = {"error": "file_not_found"}

# =========================================================
# 2. DEFINIZIONE DELL'UTENTE SIMULATO
# =========================================================
class TrafficSimulatorUser(HttpUser):
    # Simula un ritardo tra 1 e 3 secondi tra una richiesta e l'altra del singolo utente
    wait_time = between(1.0, 3.0)

    @task
    def send_traffic_data(self):
        # Se c'è stato un errore nel caricamento, fermiamo il task
        if "error" in PRELOADED_PAYLOAD:
            return

        # Invio della richiesta POST all'API Gateway usando i dati REALI
        with self.client.post("", json=PRELOADED_PAYLOAD, catch_response=True) as response:
            if response.status_code == 200:
                response.success()
            else:
                response.failure(f"Errore API: {response.status_code} - {response.text}")