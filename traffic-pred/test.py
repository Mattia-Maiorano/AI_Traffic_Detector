import json
import os
import random
import copy
import time
from locust import HttpUser, task, between, LoadTestShape

# =========================================================
# 1. BASELINE TOPOLOGY ENGINE
# =========================================================
FILE_PATH = "traffic-snapshot-gnn-199904.json"

try:
    with open(FILE_PATH, "r") as f:
        BASE_SNAPSHOT = json.load(f)
except FileNotFoundError:
    import glob
    files = sorted(glob.glob("processed_test/gnn_data/*.json"))
    if files:
        with open(files[0], "r") as f:
            BASE_SNAPSHOT = json.load(f)
    else:
        raise FileNotFoundError("Run your traffic simulation script to generate base topology.")

def generate_mutated_sequence(base_snap, sequence_length):
    sequence = []
    current_snap = base_snap
    for _ in range(sequence_length):
        snap_copy = copy.deepcopy(current_snap)
        for edge in snap_copy.get("edges", []):
            capacity = edge.get("edgeCapacity", 40)
            current_count = edge.get("count", 10)
            delta = random.randint(-int(capacity * 0.15), int(capacity * 0.15))
            new_count = max(0, min(capacity, current_count + delta))
            edge["count"] = new_count
            edge["edgeDensity"] = round(new_count / capacity, 3)
            if random.random() > 0.8:
                edge["trafficLightState"] = 1 - edge.get("trafficLightState", 1)
        sequence.append(snap_copy)
        current_snap = snap_copy
    return sequence

# =========================================================
# 2. LOAD GENERATION PROFILE (Safe Mode)
# =========================================================
class TrafficLoadTester(HttpUser):
    # INCREASED WAIT TIME: Wait 5 to 10 seconds between requests to avoid spamming
    wait_time = between(5.0, 10.0)

    def on_start(self):
        # SPOOF USER AGENT: Helps bypass basic bot-detection firewalls
        self.client.headers.update({
            'Content-Type': 'application/json',
            'Connection': 'keep-alive',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        })

    @task(4)
    def send_small_payload(self):
        payload = {"snapshots": generate_mutated_sequence(BASE_SNAPSHOT, 2)}
        self._post_inference("Small", payload)

    @task(4)
    def send_medium_payload(self):
        payload = {"snapshots": generate_mutated_sequence(BASE_SNAPSHOT, 5)}
        self._post_inference("Medium", payload)

    @task(2)
    def send_large_payload(self):
        payload = {"snapshots": generate_mutated_sequence(BASE_SNAPSHOT, 12)}
        self._post_inference("Large", payload)

    def _post_inference(self, label, payload):
        with self.client.post("", json=payload, catch_response=True) as response:
            if response.status_code == 200:
                response.success()
            elif response.status_code == 429:
                # PROPER 429 HANDLING: If we get rate limited, fail the request and back off for 15 seconds
                response.failure(f"[{label}] Rate Limited (429). Backing off.")
                time.sleep(15) 
            else:
                response.failure(f"[{label}] Failed with status {response.status_code}")

# =========================================================
# 3. CONTROL RAMP PROFILE (University Scaling Safe)
# =========================================================
class AutomatedStepLoadShape(LoadTestShape):
    # LOWER CONCURRENCY: CPU-heavy tasks will trigger scaling with far fewer users.
    stages = [
        {"duration": 120,  "users": 5,    "spawn_rate": 1},   # Warm up the load balancer
        {"duration": 300,  "users": 15,   "spawn_rate": 2},   # Induce enough CPU load to trigger scaling
        {"duration": 480,  "users": 30,   "spawn_rate": 2},   # Test the newly scaled instances
        {"duration": 600,  "users": 0,    "spawn_rate": 5}    # Gentle teardown
    ]

    def tick(self):
        run_time = self.get_run_time()
        for stage in self.stages:
            if run_time < stage["duration"]:
                return (stage["users"], stage["spawn_rate"])
        return None