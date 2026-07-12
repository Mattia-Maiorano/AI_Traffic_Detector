import json
import os
import random
import copy
from locust import HttpUser, task, between, LoadTestShape

# =========================================================
# 1. PRE-LOADING THE TOPOLOGY BASELINE
# =========================================================
FILE_PATH = "processed_test/gnn_data/traffic-snapshot-gnn-1000.json"

try:
    with open(FILE_PATH, "r") as f:
        BASE_SNAPSHOT = json.load(f)
        print(f"[OK] Base network topology loaded from {FILE_PATH}!")
except FileNotFoundError:
    import glob
    files = sorted(glob.glob("processed_test/gnn_data/*.json"))
    if files:
        with open(files[0], "r") as f:
            BASE_SNAPSHOT = json.load(f)
            print(f"[OK] Dynamically loaded base topology from {files[0]}")
    else:
        raise FileNotFoundError("Could not find any valid GNN snapshot files. Please run simulate.py first.")

def generate_mutated_snapshot(base, variance=0.15):
    """
    Creates a structurally valid snapshot with altered traffic counts and densities.
    This preserves the map layout while changing the data values.
    """
    snap_copy = copy.deepcopy(base)
    for edge in snap_copy.get("edges", []):
        # Shift the vehicle metrics slightly to simulate moving traffic
        capacity = edge.get("edgeCapacity", 40)
        current_count = edge.get("count", 10)
        
        # Add random bounded noise
        delta = random.randint(-int(capacity * variance), int(capacity * variance))
        new_count = max(0, min(capacity, current_count + delta))
        
        edge["count"] = new_count
        edge["edgeDensity"] = round(new_count / capacity, 3)
        # Invert traffic light state occasionally
        if random.random() > 0.8:
            edge["trafficLightState"] = 1 - edge.get("trafficLightState", 1)
            
    return snap_copy

# =========================================================
# 2. SMART SIMULATED USER PHASES
# =========================================================
class TrafficSimulatorUser(HttpUser):
    wait_time = between(1.5, 3.5)

    def on_start(self):
        self.client.headers.update({
            'Content-Type': 'application/json',
            'Connection': 'keep-alive'
        })

    @task(3) 
    def send_light_traffic(self):
        """ TRULY LIGHT: Short sequence loop.
            Only unrolls the GRU for 2 steps, lowering hardware utilization. """
        light_payload = {
            "snapshots": [BASE_SNAPSHOT] * 2  # Length 2 instead of 5
        }
        with self.client.post("/predict-gnn", json=light_payload, catch_response=True) as response:
            if response.status_code == 200:
                response.success()
            elif response.status_code == 429:
                response.success()
            else:
                response.failure(f"Light Load Error {response.status_code}: {response.text[:100]}")

    @task(1) 
    def send_heavy_traffic(self):
        """ TRULY HEAVY: Long sequence loop.
            Forces the GRU to process an extended history timeline. """
        dynamic_snapshots = []
        current_snap = BASE_SNAPSHOT
        for _ in range(8):  # Length 8 instead of 5
            current_snap = generate_mutated_snapshot(current_snap)
            dynamic_snapshots.append(current_snap)

        heavy_payload = {
            "snapshots": dynamic_snapshots
        }
        with self.client.post("/predict-gnn", json=heavy_payload, catch_response=True) as response:
            if response.status_code == 200:
                response.success()
            elif response.status_code == 429:
                response.success()
            else:
                    response.failure(f"Heavy Load Error {response.status_code}: {response.text[:100]}")

# =========================================================
# 3. ANTI-BAN STEP RAMP SHAPE
# =========================================================
class AutomatedStepLoadShape(LoadTestShape):
    stages = [
        {"duration": 60,   "users": 20,   "spawn_rate": 1},   
        {"duration": 180,  "users": 60,   "spawn_rate": 2},   
        {"duration": 360,  "users": 120,  "spawn_rate": 4},   
        {"duration": 480,  "users": 0,    "spawn_rate": 5}    
    ]

    def tick(self):
        run_time = self.get_run_time()
        for stage in self.stages:
            if run_time < stage["duration"]:
                return (stage["users"], stage["spawn_rate"])
        return None