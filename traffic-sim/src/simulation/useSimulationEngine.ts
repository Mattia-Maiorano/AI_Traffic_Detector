import { useEffect, useRef } from 'react'
import type { Car, Edge, Node } from './types'
import { useSimulationStore } from './store'

const LOOK_AHEAD = 30
const SAFE_DISTANCE = 5
const ACCELERATION = 42
const DECELERATION = 92
const LIGHT_INTERVAL = 5
const MAX_DT = 0.05

const clamp = (value: number, min: number, max: number) => {
    return Math.min(max, Math.max(min, value))
}

const distance = (a: Node, b: Node) => {
    const dx = a.x - b.x
    const dy = a.y - b.y
    return Math.hypot(dx, dy)
}

type EdgeMeta = {
    nodeById: Map<string, Node>
    edgeById: Map<string, Edge>
    edgeLengthById: Map<string, number>
    outgoingEdgesByNodeId: Map<string, Edge[]>
}

const buildEdgeMeta = (nodes: Node[], edges: Edge[]): EdgeMeta => {
    const nodeById = new Map(nodes.map((node) => [node.id, node]))
    const edgeById = new Map(edges.map((edge) => [edge.id, edge]))
    const edgeLengthById = new Map<string, number>()
    const outgoingEdgesByNodeId = new Map<string, Edge[]>()

    edges.forEach((edge) => {
        const source = nodeById.get(edge.sourceNodeId)
        const target = nodeById.get(edge.targetNodeId)
        if (source && target) {
            edgeLengthById.set(edge.id, distance(source, target))
        }

        const list = outgoingEdgesByNodeId.get(edge.sourceNodeId) ?? []
        list.push(edge)
        outgoingEdgesByNodeId.set(edge.sourceNodeId, list)
    })

    return { nodeById, edgeById, edgeLengthById, outgoingEdgesByNodeId }
}

const randomizeMaxSpeed = (speedLimit: number) => {
    return speedLimit * (0.85 + Math.random() * 0.3)
}

const pickNextEdge = (
    outgoingEdgesByNodeId: Map<string, Edge[]>,
    currentEdge: Edge,
    targetNodeId: string,
) => {
    const options = outgoingEdgesByNodeId.get(targetNodeId) ?? []
    if (options.length === 0) {
        return null
    }

    const filtered = options.filter(
        (edge) => edge.targetNodeId !== currentEdge.sourceNodeId,
    )
    const pool = filtered.length > 0 ? filtered : options
    return pool[Math.floor(Math.random() * pool.length)] ?? null
}

type Obstacle = {
    distance: number
    speed: number | null
}

const getObstacle = (
    car: Car,
    front: Car | undefined,
    edgeLength: number,
    edge: Edge, // Pass the edge instead of targetNode
): Obstacle | null => {
    let obstacle: Obstacle | null = null

    if (front) {
        obstacle = {
            distance: front.distanceAlongEdge - car.distanceAlongEdge,
            speed: front.speed,
        }
    }

    // Check directional light on the current edge[cite: 2]
    if (edge.trafficLight === 'red') {
        const distToLight = edgeLength - car.distanceAlongEdge
        if (!obstacle || distToLight < obstacle.distance) {
            obstacle = { distance: distToLight, speed: 0 }
        }
    }

    return obstacle
}

const stepCars = (
    cars: Car[],
    dt: number,
    meta: EdgeMeta,
): Car[] => {
    const carsByEdge = new Map<string, Car[]>()

    cars.forEach((car) => {
        const list = carsByEdge.get(car.edgeId) ?? []
        list.push(car)
        carsByEdge.set(car.edgeId, list)
    })

    carsByEdge.forEach((list) => {
        list.sort((a, b) => a.distanceAlongEdge - b.distanceAlongEdge)
    })

    const nextCars: Car[] = []

    for (const [edgeId, list] of carsByEdge.entries()) {
        const edge = meta.edgeById.get(edgeId)
        if (!edge) {
            continue
        }

        const edgeLength = meta.edgeLengthById.get(edgeId) ?? 0

        for (let index = 0; index < list.length; index += 1) {
            const car = list[index]
            const front = list[index + 1]
            const obstacle = getObstacle(car, front, edgeLength, edge);

            let nextSpeed = Math.min(car.maxSpeed, car.speed + ACCELERATION * dt)

            if (obstacle && obstacle.distance < LOOK_AHEAD) {
                const gap = obstacle.distance - SAFE_DISTANCE
                if (gap <= 0) {
                    nextSpeed = 0
                } else {
                    const pressure = clamp((LOOK_AHEAD - gap) / LOOK_AHEAD, 0, 1)
                    nextSpeed = Math.max(0, nextSpeed - DECELERATION * pressure * dt)
                    if (obstacle.speed !== null && nextSpeed > obstacle.speed) {
                        nextSpeed = Math.max(
                            obstacle.speed,
                            nextSpeed - DECELERATION * 0.5 * dt,
                        )
                    }
                }
            }

            let nextDistance = car.distanceAlongEdge + nextSpeed * dt;

            if (nextDistance >= edgeLength && edgeLength > 0) {
                // FIX: Check edge.trafficLight instead of target.trafficLight[cite: 7]
                if (edge.trafficLight === 'red') {
                    nextDistance = Math.max(edgeLength - SAFE_DISTANCE, 0);
                    nextSpeed = 0;
                } else {
                    const target = meta.nodeById.get(edge.targetNodeId);
                    if (target?.type === 'exit') continue;

                    const nextEdge = pickNextEdge(meta.outgoingEdgesByNodeId, edge, edge.targetNodeId);
                    const nextEdgeCars = carsByEdge.get(nextEdge?.id ?? '')?.length ?? 0
                    const isNextEdgeFull = nextEdge && nextEdgeCars >= nextEdge.capacity

                    if (!nextEdge || isNextEdgeFull) {
                        // Treat as a stop if there's no path or the next road is full[cite: 7]
                        nextDistance = Math.max(edgeLength - SAFE_DISTANCE, 0)
                        nextSpeed = 0;
                    } else {
                        // Move to next edge[cite: 7]
                        nextCars.push({
                            ...car,
                            edgeId: nextEdge.id,
                            distanceAlongEdge: 0,
                            speed: nextSpeed,
                            maxSpeed: randomizeMaxSpeed(nextEdge.speedLimit),
                        })
                        continue
                    }
                }
            }
            nextCars.push({ ...car, distanceAlongEdge: nextDistance, speed: nextSpeed });
        }
    }

    return nextCars
}

const spawnCars = (
    count: number,
    entryNodeIds: string[],
    meta: EdgeMeta,
    nextId: () => string,
): Car[] => {
    const spawned: Car[] = []

    for (let index = 0; index < count; index += 1) {
        const entry =
            entryNodeIds[Math.floor(Math.random() * entryNodeIds.length)]
        if (!entry) {
            continue
        }

        const options = meta.outgoingEdgesByNodeId.get(entry) ?? []
        if (options.length === 0) {
            continue
        }

        const edge = options[Math.floor(Math.random() * options.length)]
        if (!edge) {
            continue
        }

        spawned.push({
            id: nextId(),
            edgeId: edge.id,
            distanceAlongEdge: 0,
            speed: 0,
            maxSpeed: randomizeMaxSpeed(edge.speedLimit),
        })
    }

    return spawned
}

export const useSimulationEngine = () => {
    const store = useSimulationStore
    const runningRef = useRef(store.getState().running)
    const spawnRateRef = useRef(store.getState().spawnRate)
    const autoSpawnRateRef = useRef(store.getState().autoSpawnRate)
    const resetPendingRef = useRef(false)
    const carIdRef = useRef(0)
    const metaRef = useRef<EdgeMeta | null>(null)

    useEffect(() => {
        const unsubRunning = store.subscribe(
            (state) => state.running,
            (running: boolean) => {
                runningRef.current = running
            },
        )
        const unsubSpawn = store.subscribe(
            (state) => state.spawnRate,
            (spawnRate: number) => {
                spawnRateRef.current = spawnRate
            },
        )
        const unsubAutoSpawn = store.subscribe(
            (state) => state.autoSpawnRate,
            (autoSpawnRate: boolean) => {
                autoSpawnRateRef.current = autoSpawnRate
            },
        )
        const unsubReset = store.subscribe(
            (state) => state.resetToken,
            () => {
                resetPendingRef.current = true
            },
        )

        return () => {
            unsubRunning()
            unsubSpawn()
            unsubAutoSpawn()
            unsubReset()
        }
    }, [store])

    useEffect(() => {
        let frameId = 0
        let lastTime = performance.now()
        let spawnAccumulator = 0
        let lightTimer = 0
        let stepCount = 0

        if (!metaRef.current) {
            const state = store.getState()
            metaRef.current = buildEdgeMeta(state.nodes, state.edges)
        }

        const nextId = () => `car-${carIdRef.current++}`

        const tick = (now: number) => {
            const dt = Math.min((now - lastTime) / 1000, MAX_DT)
            lastTime = now

            if (resetPendingRef.current) {
                spawnAccumulator = 0
                lightTimer = 0
                carIdRef.current = 0
                stepCount = 0
                lastTime = now
                resetPendingRef.current = false

                // Rebuild engine's edge and node cache
                const state = store.getState()
                metaRef.current = buildEdgeMeta(state.nodes, state.edges)
            }

            if (runningRef.current) {
                const state = store.getState();
                const meta = metaRef.current;
                stepCount++;
                if (!meta) {
                    frameId = requestAnimationFrame(tick);
                    return;
                }
                if (metaRef.current) {
                    lightTimer += dt;
                    if (lightTimer >= LIGHT_INTERVAL) {
                        lightTimer -= LIGHT_INTERVAL;
                        state.toggleLightPhase();

                        // FIX: Must update BOTH nodeById AND edgeById in the cache[cite: 7]
                        const freshEdges = store.getState().edges;
                        const freshNodes = store.getState().nodes;
                        metaRef.current.edgeById = new Map(freshEdges.map(e => [e.id, e]));
                        metaRef.current.nodeById = new Map(freshNodes.map(n => [n.id, n]));
                    }

                    if (metaRef.current) {
                        const freshNodes = store.getState().nodes
                        metaRef.current.nodeById = new Map(freshNodes.map((node) => [node.id, node]))
                    }

                    if (autoSpawnRateRef.current) {
                        const counts = new Map<string, number>()
                        state.cars.forEach((car) => {
                            counts.set(car.edgeId, (counts.get(car.edgeId) ?? 0) + 1)
                        })
                        let congestedEdges = 0
                        state.edges.forEach((edge) => {
                            const count = counts.get(edge.id) ?? 0
                            const density = count / edge.capacity
                            if (density >= 0.75) {
                                congestedEdges++
                            }
                        })
                        const congestionPct = state.edges.length > 0 ? (congestedEdges / state.edges.length) * 100 : 0
                        const targetCongestion = 30.0 + 20.0 * Math.sin(state.simTime * (2 * Math.PI / 450.0))
                        
                        const error = targetCongestion - congestionPct
                        let nextSpawnRate = spawnRateRef.current
                        if (error < 0) {
                            nextSpawnRate += error * 0.4 + (Math.random() * 0.4 - 0.2)
                        } else {
                            nextSpawnRate += error * 0.08 + (Math.random() * 0.4 - 0.2)
                        }
                        
                        nextSpawnRate = Math.min(80.0, Math.max(0.0, nextSpawnRate))
                        state.setSpawnRate(nextSpawnRate)
                    }

                    spawnAccumulator += dt * spawnRateRef.current
                    const spawnCount = Math.floor(spawnAccumulator)
                    let cars = state.cars
                    if (spawnCount > 0) {
                        spawnAccumulator -= spawnCount
                        const spawned = spawnCars(
                            spawnCount,
                            state.entryNodeIds,
                            meta,
                            nextId,
                        )
                        cars = [...cars, ...spawned]
                    }

                    const nextSimTime = state.simTime + dt
                    const updatedCars = stepCars(cars, dt, meta)

                    // Prediction Verification Logic
                    if (state.predictionActive && state.predictionTargetSimTime !== null && nextSimTime >= state.predictionTargetSimTime) {
                        const predictedStatus = state.predictedStatus || {}
                        const carCounts = new Map<string, number>()
                        updatedCars.forEach(car => {
                            carCounts.set(car.edgeId, (carCounts.get(car.edgeId) || 0) + 1)
                        })

                        const numClasses = 4
                        const confusionMatrix: number[][] = Array.from({ length: numClasses }, () => Array(numClasses).fill(0))
                        const actuals: number[] = []
                        const preds: number[] = []

                        state.edges.forEach(edge => {
                            const pred = predictedStatus[edge.id]
                            if (pred !== undefined) {
                                const count = carCounts.get(edge.id) || 0
                                const density = count / edge.capacity
                                let actualCode = 0
                                if (density >= 0.75) {
                                    actualCode = 3
                                } else if (density >= 0.5) {
                                    actualCode = 2
                                } else if (density >= 0.25) {
                                    actualCode = 1
                                } else {
                                    actualCode = 0
                                }

                                actuals.push(actualCode)
                                preds.push(pred)
                                confusionMatrix[actualCode][pred] += 1
                            }
                        })

                        let f1Sum = 0
                        for (let c = 0; c < numClasses; c++) {
                            let tp = 0
                            let fp = 0
                            let fn = 0
                            for (let i = 0; i < actuals.length; i++) {
                                const actual = actuals[i]
                                const pred = preds[i]
                                if (actual === c && pred === c) tp++
                                if (actual !== c && pred === c) fp++
                                if (actual === c && pred !== c) fn++
                            }
                            const precision = (tp + fp) > 0 ? tp / (tp + fp) : 0
                            const recall = (tp + fn) > 0 ? tp / (tp + fn) : 0
                            const f1 = (precision + recall) > 0 ? (2 * precision * recall) / (precision + recall) : 0
                            f1Sum += f1
                        }
                        const macroF1 = f1Sum / numClasses

                        store.setState({
                            predictionActive: false,
                            predictionBalancedScore: Number((macroF1 * 100).toFixed(1)),
                            predictionConfusionMatrix: confusionMatrix,
                        })
                    }

                    if (stepCount % 20 === 0) {
                        const carCounts = new Map<string, number>()
                        updatedCars.forEach((car) => {
                            carCounts.set(car.edgeId, (carCounts.get(car.edgeId) ?? 0) + 1)
                        })

                        const snap = {
                            time: nextSimTime,
                            edges: state.edges.map((edge) => {
                                const count = carCounts.get(edge.id) ?? 0
                                const density = count / edge.capacity

                                const source = state.nodes.find(n => n.id === edge.sourceNodeId)
                                const target = state.nodes.find(n => n.id === edge.targetNodeId)
                                let flowDirection = 'E'
                                if (source && target) {
                                    const dx = target.x - source.x
                                    const dy = target.y - source.y
                                    if (Math.abs(dx) > Math.abs(dy)) {
                                        flowDirection = dx > 0 ? 'E' : 'W'
                                    } else {
                                        flowDirection = dy > 0 ? 'S' : 'N'
                                    }
                                }

                                const trafficLightState = edge.trafficLight === 'red' ? 0 : 1
                                const phaseTimeRemaining = Number((5 - (nextSimTime % 5)).toFixed(2))
                                const spawnWeight = source?.type === 'entry' ? 2 : 1

                                return {
                                    edgeId: edge.id,
                                    count,
                                    edgeCapacity: edge.capacity,
                                    edgeDensity: Number(density.toFixed(3)),
                                    flowDirection,
                                    speedLimit: edge.speedLimit,
                                    trafficLightState,
                                    phaseTimeRemaining,
                                    spawnWeight,
                                    horizonTime: state.predictionHorizonSeconds
                                }
                            })
                        }

                        const currentSnaps = [...(store.getState().gnnSnapshots || []), snap].slice(-5)
                        store.setState({
                            cars: updatedCars,
                            simTime: nextSimTime,
                            gnnSnapshots: currentSnaps
                        })
                    } else {
                        store.setState({
                            cars: updatedCars,
                            simTime: nextSimTime,
                        })
                    }
                }
            }

            frameId = requestAnimationFrame(tick)
        }

        frameId = requestAnimationFrame(tick)

        return () => cancelAnimationFrame(frameId)
    }, [store])
}
