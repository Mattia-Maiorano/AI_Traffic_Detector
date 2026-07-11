import json
from locust import HttpUser, task, between, LoadTestShape

# =========================================================
# CONFIGURATION
# =========================================================
FILE_PATH = "prova_snapshot.json"
LIGHT_PERCENT = 0.75  # 75%
HEAVY_PERCENT = 0.25  # 25%

# Load data
try:
    with open(FILE_PATH, "r") as f:
        BASE_PAYLOAD = json.load(f)
except FileNotFoundError:
    BASE_PAYLOAD = {"error": "not_found"}

LIGHT_PAYLOAD = {"edges": BASE_PAYLOAD.get("edges", []), "type": "light"}
HEAVY_PAYLOAD = BASE_PAYLOAD

class TrafficSimulatorUser(HttpUser):
    wait_time = between(1.0, 3.0)

    # Use task(int) to define the ratio. Locust handles the math.
    @task(int(LIGHT_PERCENT * 100))
    def send_light_traffic(self):
        # The 'name' parameter overrides the default POST /... path
        self.client.post(
            "/default/TrafficPredictor", 
            json=LIGHT_PAYLOAD, 
            name=f"Light Request ({int(LIGHT_PERCENT*100)}%)",
            catch_response=True
        )

    @task(int(HEAVY_PERCENT * 100))
    def send_heavy_traffic(self):
        self.client.post(
            "/default/TrafficPredictor", 
            json=HEAVY_PAYLOAD, 
            name=f"Heavy Request ({int(HEAVY_PERCENT*100)}%)",
            catch_response=True
        )

class AutomatedStepLoadShape(LoadTestShape):
    # Stages defined for your presentation report
    stages = [
        {"duration": 90,  "users": 5,  "spawn_rate": 1},
        {"duration": 300, "users": 30, "spawn_rate": 2},
        {"duration": 600, "users": 30, "spawn_rate": 5},
        {"duration": 720, "users": 0,  "spawn_rate": 3}
    ]

    def tick(self):
        run_time = self.get_run_time()
        for stage in self.stages:
            if run_time < stage["duration"]:
                return (stage["users"], stage["spawn_rate"])
        return None