import json
import os
import random
import copy
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
    """Generates a list of logically chained traffic snapshots."""
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
# 2. LOAD GENERATION PROFILE
# =========================================================
class TrafficLoadTester(HttpUser):
    wait_time = between(1.5, 3.5)

    def on_start(self):
        self.client.headers.update({
            'Content-Type': 'application/json',
            'Connection': 'keep-alive'
        })

    @task(4)
    def send_small_payload(self):
        """SMALL: 2 Snapshots"""
        payload = {"snapshots": generate_mutated_sequence(BASE_SNAPSHOT, 2)}
        self._post_inference("Small", payload)

    @task(4)
    def send_medium_payload(self):
        """MEDIUM: 5 Snapshots"""
        payload = {"snapshots": generate_mutated_sequence(BASE_SNAPSHOT, 5)}
        self._post_inference("Medium", payload)

    @task(2)
    def send_large_payload(self):
        """LARGE: 12 Snapshots"""
        payload = {"snapshots": generate_mutated_sequence(BASE_SNAPSHOT, 12)}
        self._post_inference("Large", payload)

    def _post_inference(self, label, payload):
        # Change the path from "/predict-gnn" to "" 
        # This prevents Locust from appending anything extra to the AWS URL
        with self.client.post("", json=payload, catch_response=True) as response:
            if response.status_code in [200, 429]:
                response.success()
            else:
                response.failure(f"[{label}] Failed with status {response.status_code}")

# =========================================================
# 3. CONTROL RAMP PROFILE (AWS Learner Lab Compliant)
# =========================================================
class AutomatedStepLoadShape(LoadTestShape):
    stages = [
        {"duration": 60,   "users": 20,   "spawn_rate": 2},   # Low load / Baseline
        {"duration": 180,  "users": 60,   "spawn_rate": 4},   # Moderate scaling
        {"duration": 360,  "users": 120,  "spawn_rate": 6},   # Peak stress testing
        {"duration": 480,  "users": 0,    "spawn_rate": 10}   # Teardown
    ]

    def tick(self):
        run_time = self.get_run_time()
        for stage in self.stages:
            if run_time < stage["duration"]:
                return (stage["users"], stage["spawn_rate"])
        return None