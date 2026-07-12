import os
import sys
import json
import random
import math
import argparse
from pathlib import Path

LOOK_AHEAD = 30
SAFE_DISTANCE = 5
ACCELERATION = 42
DECELERATION = 92
LIGHT_INTERVAL = 5.0
MAX_EDGE_LENGTH = 150

def distance(x1, y1, x2, y2):
    return math.hypot(x2 - x1, y2 - y1)

def randomize_max_speed(speed_limit):
    return speed_limit * (0.85 + random.random() * 0.3)

class Node:
    def __init__(self, node_id, x, y, node_type):
        self.id = node_id
        self.x = x
        self.y = y
        self.type = node_type 

class Edge:
    def __init__(self, edge_id, source_id, target_id, speed_limit, capacity, parent_edge_id=None, sub_edge_index=None, total_sub_edges=None, is_subedge=False):
        self.id = edge_id
        self.sourceNodeId = source_id
        self.targetNodeId = target_id
        self.speedLimit = speed_limit
        self.capacity = capacity
        self.parentEdgeId = parent_edge_id
        self.subEdgeIndex = sub_edge_index
        self.totalSubEdges = total_sub_edges
        self.isSubedge = is_subedge
        self.trafficLight = None

class Car:
    def __init__(self, car_id, edge_id, distance_along_edge, speed, max_speed):
        self.id = car_id
        self.edgeId = edge_id
        self.distanceAlongEdge = distance_along_edge
        self.speed = speed
        self.maxSpeed = max_speed

def generate_manhattan_map(grid_size):
    nodes = []
    edges = []
    spacing = 120
    padding = 100

    for r in range(grid_size):
        for c in range(grid_size):
            nodes.append(Node(f"node-{r}-{c}", padding + c * spacing, padding + r * spacing, 'intersection'))

    for i in range(grid_size):
        first_pos = padding
        last_pos = padding + (grid_size - 1) * spacing
        if i % 2 == 0:
            nodes.append(Node(f"entry-n-{i}", padding + i * spacing, first_pos - 60, 'entry'))
            nodes.append(Node(f"exit-s-{i}", padding + i * spacing, last_pos + 60, 'exit'))
        else:
            nodes.append(Node(f"entry-s-{i}", padding + i * spacing, last_pos + 60, 'entry'))
            nodes.append(Node(f"exit-n-{i}", padding + i * spacing, first_pos - 60, 'exit'))

        if i % 2 == 0:
            nodes.append(Node(f"entry-w-{i}", first_pos - 60, padding + i * spacing, 'entry'))
            nodes.append(Node(f"exit-e-{i}", last_pos + 60, padding + i * spacing, 'exit'))
        else:
            nodes.append(Node(f"entry-e-{i}", last_pos + 60, padding + i * spacing, 'exit'))
            nodes.append(Node(f"exit-w-{i}", first_pos - 60, padding + i * spacing, 'exit'))

    for r in range(grid_size):
        for c in range(grid_size):
            if c < grid_size - 1:
                east_bound = r % 2 == 0
                source_col = c if east_bound else c + 1
                target_col = c + 1 if east_bound else c
                edges.append(Edge(f"h-street-{r}-{c}", f"node-{r}-{source_col}", f"node-{r}-{target_col}", 50, 40))

            if r < grid_size - 1:
                south_bound = c % 2 == 0
                source_row = r if south_bound else r + 1
                target_row = r + 1 if south_bound else r
                edges.append(Edge(f"v-avenue-{r}-{c}", f"node-{source_row}-{c}", f"node-{target_row}-{c}", 50, 40))

    for i in range(grid_size):
        if i % 2 == 0:
            edges.append(Edge(f"v-in-n-{i}", f"entry-n-{i}", f"node-0-{i}", 60, 50))
            edges.append(Edge(f"v-out-s-{i}", f"node-{grid_size - 1}-{i}", f"exit-s-{i}", 60, 50))
            edges.append(Edge(f"h-in-w-{i}", f"entry-w-{i}", f"node-{i}-0", 60, 50))
            edges.append(Edge(f"h-out-e-{i}", f"node-{i}-{grid_size - 1}", f"exit-e-{i}", 60, 50))
        else:
            edges.append(Edge(f"v-in-s-{i}", f"entry-s-{i}", f"node-{grid_size - 1}-{i}", 60, 50))
            edges.append(Edge(f"v-out-n-{i}", f"node-0-{i}", f"exit-n-{i}", 60, 50))
            edges.append(Edge(f"h-in-e-{i}", f"entry-e-{i}", f"node-{i}-{grid_size - 1}", 60, 50))
            edges.append(Edge(f"h-out-w-{i}", f"node-{i}-0", f"exit-w-{i}", 60, 50))

    return nodes, edges

def compile_graph(raw_nodes, raw_edges):
    node_by_id = {n.id: n for n in raw_nodes}
    compiled_nodes = list(raw_nodes)
    compiled_edges = []

    for parent_edge in raw_edges:
        source = node_by_id.get(parent_edge.sourceNodeId)
        target = node_by_id.get(parent_edge.targetNodeId)
        if not source or not target:
            compiled_edges.append(parent_edge)
            continue

        dx = target.x - source.x
        dy = target.y - source.y
        L = math.hypot(dx, dy)
        N = math.ceil(L / MAX_EDGE_LENGTH)

        if N <= 1:
            parent_edge.isSubedge = False
            compiled_edges.append(parent_edge)
            continue

        intermediate_ids = []
        for i in range(1, N):
            node_id = f"{parent_edge.id}_node_{i}"
            t = i / N
            new_node = Node(node_id, source.x + t * dx, source.y + t * dy, 'intersection')
            compiled_nodes.append(new_node)
            intermediate_ids.append(node_id)

        sub_capacity = parent_edge.capacity / N
        for i in range(N):
            sub_id = f"{parent_edge.id}_sub_{i}_of_{N}"
            edge_src = parent_edge.sourceNodeId if i == 0 else intermediate_ids[i - 1]
            edge_tgt = parent_edge.targetNodeId if i == N - 1 else intermediate_ids[i]

            compiled_edges.append(Edge(
                sub_id, edge_src, edge_tgt, parent_edge.speedLimit, sub_capacity,
                parent_edge.id, i, N, True
            ))

    return compiled_nodes, compiled_edges

def apply_traffic_lights(edges, phase):
    for edge in edges:
        if '-out-' in edge.id:
            edge.trafficLight = None
            continue
        if edge.isSubedge and edge.subEdgeIndex is not None and edge.totalSubEdges is not None and edge.subEdgeIndex < edge.totalSubEdges - 1:
            edge.trafficLight = None
            continue
        is_horizontal = (edge.parentEdgeId or edge.id).startswith('h-')
        edge.trafficLight = 'green' if (0 if is_horizontal else 1) == phase else 'red'

def pick_next_edge(outgoing, current_edge, target_node_id):
    options = outgoing.get(target_node_id, [])
    if not options:
        return None
    filtered = [e for e in options if e.targetNodeId != current_edge.sourceNodeId]
    pool = filtered if filtered else options
    return random.choice(pool)

def step_cars(cars, dt, node_by_id, edge_by_id, edge_len_by_id, outgoing):
    cars_by_edge = {}
    for car in cars:
        cars_by_edge.setdefault(car.edgeId, []).append(car)

    for edge_id in cars_by_edge:
        cars_by_edge[edge_id].sort(key=lambda c: c.distanceAlongEdge)

    next_cars = []
    for edge_id, list_cars in cars_by_edge.items():
        edge = edge_by_id.get(edge_id)
        if not edge:
            continue
        edge_len = edge_len_by_id.get(edge_id, 0.0)

        for index, car in enumerate(list_cars):
            front = list_cars[index + 1] if index + 1 < len(list_cars) else None
            
            obstacle_dist = None
            obstacle_speed = None

            if front:
                obstacle_dist = front.distanceAlongEdge - car.distanceAlongEdge
                obstacle_speed = front.speed

            if edge.trafficLight == 'red':
                dist_to_light = edge_len - car.distanceAlongEdge
                if obstacle_dist is None or dist_to_light < obstacle_dist:
                    obstacle_dist = dist_to_light
                    obstacle_speed = 0.0

            next_speed = min(car.maxSpeed, car.speed + ACCELERATION * dt)
            if obstacle_dist is not None and obstacle_dist < LOOK_AHEAD:
                gap = obstacle_dist - SAFE_DISTANCE
                if gap <= 0:
                    next_speed = 0.0
                else:
                    pressure = min(1.0, max(0.0, (LOOK_AHEAD - gap) / LOOK_AHEAD))
                    next_speed = max(0.0, next_speed - DECELERATION * pressure * dt)
                    if obstacle_speed is not None and next_speed > obstacle_speed:
                        next_speed = max(obstacle_speed, next_speed - DECELERATION * 0.5 * dt)

            next_dist = car.distanceAlongEdge + next_speed * dt

            if next_dist >= edge_len and edge_len > 0:
                if edge.trafficLight == 'red':
                    next_dist = max(0.0, edge_len - SAFE_DISTANCE)
                    next_speed = 0.0
                else:
                    target_node = node_by_id.get(edge.targetNodeId)
                    if target_node and target_node.type == 'exit':
                        continue 

                    next_edge = pick_next_edge(outgoing, edge, edge.targetNodeId)
                    next_edge_cars = len(cars_by_edge.get(next_edge.id, [])) if next_edge else 0
                    is_full = next_edge and next_edge_cars >= next_edge.capacity

                    if not next_edge or is_full:
                        next_dist = max(0.0, edge_len - SAFE_DISTANCE)
                        next_speed = 0.0
                    else:
                        next_cars.append(Car(
                            car.id, next_edge.id, 0.0, next_speed, randomize_max_speed(next_edge.speedLimit)
                        ))
                        continue

            next_cars.append(Car(car.id, car.edgeId, next_dist, next_speed, car.maxSpeed))

    return next_cars

def simulate():
    parser = argparse.ArgumentParser(description="Markov-Chain driven Traffic Simulation purely in Python CLI")
    parser.add_argument('--grid-size', type=int, default=8)
    parser.add_argument('--spawn-min', type=float, default=0.0)  
    parser.add_argument('--spawn-max', type=float, default=80.0) 
    parser.add_argument('--steps', type=int, default=40000)
    parser.add_argument('--dt', type=float, default=0.05)
    parser.add_argument('--output-dir', type=str, default='processed_test/gnn_data')
    parser.add_argument('--horizon-min', type=float, default=5.0)
    parser.add_argument('--horizon-max', type=float, default=30.0)
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)
    raw_nodes, raw_edges = generate_manhattan_map(args.grid_size)
    nodes, edges = compile_graph(raw_nodes, raw_edges)

    node_by_id = {n.id: n for n in nodes}
    edge_by_id = {e.id: e for e in edges}
    
    edge_len_by_id = {}
    outgoing = {}
    for edge in edges:
        src = node_by_id.get(edge.sourceNodeId)
        tgt = node_by_id.get(edge.targetNodeId)
        if src and tgt:
            edge_len_by_id[edge.id] = distance(src.x, src.y, tgt.x, tgt.y)
        outgoing.setdefault(edge.sourceNodeId, []).append(edge)

    perimeter_entries = [n.id for n in nodes if n.type == 'entry']
    crossroads = [n.id for n in nodes if n.type == 'intersection' and '_node_' not in n.id]
    entry_nodes = perimeter_entries + crossroads

    cars = []
    sim_time = 0.0
    light_timer = 0.0
    light_phase = 0
    car_counter = 0
    spawn_accumulator = 0.0
    current_spawn_rate = 20.0

    speeds = []
    congestion_stats = []

    apply_traffic_lights(edges, light_phase)
    print(f"Starting simulation of {args.steps} steps. Map size: {args.grid_size}x{args.grid_size} grid.\n")

    congestion_pct = 0.0

    for step in range(args.steps):
        # Console Progress Output (inline rewrite using carriage return)
        if step % 1000 == 0 or step == args.steps - 1:
            progress = (step + 1) / args.steps * 100
            sys.stdout.write(f"\rSimulation Progress: {progress:6.2f}% | Current Active Cars: {len(cars):4d}")
            sys.stdout.flush()

        target_congestion = 30.0 + 20.0 * math.sin(sim_time * (2 * math.pi / 450.0))
        
        error = target_congestion - congestion_pct
        if error < 0:
            current_spawn_rate += error * 0.4 + random.uniform(-0.2, 0.2)
        else:
            current_spawn_rate += error * 0.08 + random.uniform(-0.2, 0.2)
            
        current_spawn_rate = min(args.spawn_max, max(args.spawn_min, current_spawn_rate))

        sim_time += args.dt
        light_timer += args.dt
        if light_timer >= LIGHT_INTERVAL:
            light_timer -= LIGHT_INTERVAL
            light_phase = 1 - light_phase
            apply_traffic_lights(edges, light_phase)

        spawn_accumulator += args.dt * current_spawn_rate
        spawn_count = int(spawn_accumulator)
        if spawn_count > 0:
            spawn_accumulator -= spawn_count
            for _ in range(spawn_count):
                entry = random.choice(entry_nodes)
                options = outgoing.get(entry, [])
                if options:
                    edge = random.choice(options)
                    current_edge_cars = sum(1 for c in cars if c.edgeId == edge.id)
                    
                    if current_edge_cars < edge.capacity:
                        cars.append(Car(f"car-{car_counter}", edge.id, 0.0, 0.0, randomize_max_speed(edge.speedLimit)))
                        car_counter += 1

        cars = step_cars(cars, args.dt, node_by_id, edge_by_id, edge_len_by_id, outgoing)

        counts = {e.id: 0 for e in edges}
        edge_cars_map = {e.id: [] for e in edges}
        for car in cars:
            counts[car.edgeId] = counts.get(car.edgeId, 0) + 1
            edge_cars_map.setdefault(car.edgeId, []).append(car)
            speeds.append(car.speed)

        congested_edges = 0
        for edge in edges:
            density = counts[edge.id] / edge.capacity
            if density >= 0.75:
                congested_edges += 1
        congestion_pct = (congested_edges / len(edges)) * 100
        congestion_stats.append(congestion_pct)

        if step % 20 == 0 and congestion_pct >= 10.0:
            horizon = round(random.uniform(args.horizon_min, args.horizon_max), 1)
            payload_edges = []
            for edge in edges:
                count = counts[edge.id]
                density = count / edge.capacity

                src = node_by_id.get(edge.sourceNodeId)
                tgt = node_by_id.get(edge.targetNodeId)
                flow_dir = 'E'
                if src and tgt:
                    dx = tgt.x - src.x
                    dy = tgt.y - src.y
                    if abs(dx) > abs(dy):
                        flow_dir = 'E' if dx > 0 else 'W'
                    else:
                        flow_dir = 'S' if dy > 0 else 'N'

                traffic_light_state = 0 if edge.trafficLight == 'red' else 1
                phase_remaining = round(max(0.0, LIGHT_INTERVAL - light_timer), 2)
                spawn_w = 2 if src.type == 'entry' else 1

                vehicles = [{
                    "vehicleId": c.id,
                    "averageCarSpeed": round(c.speed, 1)
                } for c in edge_cars_map.get(edge.id, [])]

                payload_edges.append({
                    "edgeId": edge.id,
                    "count": count,
                    "edgeCapacity": edge.capacity,
                    "edgeDensity": round(density, 3),
                    "flowDirection": flow_dir,
                    "speedLimit": edge.speedLimit,
                    "trafficLightState": traffic_light_state,
                    "phaseTimeRemaining": phase_remaining,
                    "spawnWeight": spawn_w,
                    "horizonTime": horizon,
                    "vehicles": vehicles
                })

            snapshot = {
                "time": round(sim_time, 2),
                "edges": payload_edges
            }

            filename = os.path.join(args.output_dir, f"traffic-snapshot-gnn-{int(sim_time*100)}.json")
            with open(filename, 'w') as f:
                json.dump(snapshot, f, indent=2)

    # Clean line break after carriage-returned progress logs finish
    print("\n")

    avg_speed = sum(speeds) / len(speeds) if speeds else 0.0
    max_speed = max(speeds) if speeds else 0.0
    avg_congestion = sum(congestion_stats) / len(congestion_stats) if congestion_stats else 0.0

    print("--- Simulation Metrics ---")
    print(f"Total Steps Simulated: {args.steps}")
    print(f"Current Active Cars:   {len(cars)}")
    print(f"Average Vehicle Speed: {avg_speed:.2f} px/s")
    print(f"Average System Congestion: {avg_congestion:.2f}%")
    print("--------------------------\n")

if __name__ == "__main__":
    simulate()