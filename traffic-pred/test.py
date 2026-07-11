import json
from locust import HttpUser, task, between, LoadTestShape

# =========================================================
# 1. PRE-LOADING REAL DATA (PERFORMANCE OPTIMIZATION)
# Pre-load payloads into memory to eliminate disk I/O bottlenecks 
# on the load generator during testing.
# =========================================================
FILE_PATH = "prova_snapshot.json"

try:
    with open(FILE_PATH, "r") as f:
        BASE_PAYLOAD = json.load(f)
        print(f"[OK] File {FILE_PATH} successfully loaded into RAM!")
except FileNotFoundError:
    print(f"[ERROR] File {FILE_PATH} not found! Using a minimal fallback payload.")
    BASE_PAYLOAD = {"fallback": True}

# Define a light payload variant (simulating a lightweight request)
LIGHT_PAYLOAD = {
    "edges": BASE_PAYLOAD.get("edges", []), 
    "is_light_test": True
}
# Define a heavy payload variant (simulating a complex request/batch evaluation)
HEAVY_PAYLOAD = BASE_PAYLOAD 

# =========================================================
# 2. SIMULATED USER BEHAVIOR (MIXED WORKLOAD INTERACTION)
# Uses task weighting to simulate realistic traffic diversity.
# =========================================================
class TrafficSimulatorUser(HttpUser):
    # Simulates a think-time delay between 1.0 and 3.0 seconds per request
    wait_time = between(1.0, 3.0)

    @task(3)  # Weight 3: Occurs 75% of the time (Standard/Light request)
    def send_light_traffic(self):
        headers = {'Content-Type': 'application/json'}
        with self.client.post("/default/TrafficPredictor", json=LIGHT_PAYLOAD, headers=headers, catch_response=True) as response:
            if response.status_code == 200:
                response.success()
            else:
                response.failure(f"API Error: {response.status_code} - {response.text}")

    @task(1)  # Weight 1: Occurs 25% of the time (Complex/Heavy request)
    def send_heavy_traffic(self):
        headers = {'Content-Type': 'application/json'}
        with self.client.post("/default/TrafficPredictor", json=HEAVY_PAYLOAD, headers=headers, catch_response=True) as response:
            if response.status_code == 200:
                response.success()
            else:
                response.failure(f"API Error: {response.status_code} - {response.text}")


# =========================================================
# 3. EXPERIMENTAL TIMELINE SHAPE (AUTOMATED SCALING PHASES)
# Automatically transitions through Warm-up, Ramp-up, Steady, 
# and Ramp-down states without manual intervention.
# =========================================================
class AutomatedStepLoadShape(LoadTestShape):
    # Setup timeline stages: (Time elapsed in seconds, Target User Count, Spawn Rate)
    stages = [
        {"duration": 90,   "users": 30,   "spawn_rate": 1},   # Phase 1: Warm-up (Isolate Cold Starts)
        {"duration": 300,  "users": 100,  "spawn_rate": 2},   # Phase 2: Ramp-up (Scale-out)
        {"duration": 600,  "users": 150,  "spawn_rate": 5},   # Phase 3: Steady State (Peak Load Analysis)
        {"duration": 720,  "users": 0,   "spawn_rate": 3}    # Phase 4: Ramp-down (Scale-in verification)
    ]

    def tick(self):
        run_time = self.get_run_time()

        for stage in self.stages:
            if run_time < stage["duration"]:
                tick_data = (stage["users"], stage["spawn_rate"])
                return tick_data
        return None