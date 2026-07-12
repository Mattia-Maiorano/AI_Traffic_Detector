import { Download, Network, Pause, Play, RotateCcw, Sliders, Brain } from 'lucide-react'
import { useSimulationStore } from '../simulation/store'
import { TOPOLOGY_CONFIG } from '../simulation/map'
import { useState, Fragment } from 'react'

const clamp = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, value))

export const Dashboard = () => {
    const running = useSimulationStore((state) => state.running)
    const spawnRate = useSimulationStore((state) => state.spawnRate)
    const setRunning = useSimulationStore((state) => state.setRunning)
    const setSpawnRate = useSimulationStore((state) => state.setSpawnRate)
    const resetSimulation = useSimulationStore((state) => state.resetSimulation)
    const edges = useSimulationStore((state) => state.edges)
    const nodes = useSimulationStore((state) => state.nodes)
    const autoSpawnRate = useSimulationStore((state) => state.autoSpawnRate)
    const setAutoSpawnRate = useSimulationStore((state) => state.setAutoSpawnRate)

    const predictionActive = useSimulationStore((state) => state.predictionActive)
    const predictionHorizonSeconds = useSimulationStore((state) => state.predictionHorizonSeconds)
    const predictionTargetSimTime = useSimulationStore((state) => state.predictionTargetSimTime)
    const predictionBalancedScore = useSimulationStore((state) => state.predictionBalancedScore)
    const predictionConfusionMatrix = useSimulationStore((state) => state.predictionConfusionMatrix)
    const simTime = useSimulationStore((state) => state.simTime)
    const setPrediction = useSimulationStore((state) => state.setPrediction)
    const setPredictionHorizonSeconds = useSimulationStore((state) => state.setPredictionHorizonSeconds)

    const [isPredicting, setIsPredicting] = useState(false)
    const [predictionError, setPredictionError] = useState<string | null>(null)

    const subEdgeCount = edges.filter(e => e.isSubedge).length
    const injectedNodeCount = nodes.filter(n => n.id.includes('_node_')).length

    const handleExport = () => {
        const { cars, edges: storeEdges } = useSimulationStore.getState()
        const counts = new Map(storeEdges.map((edge) => [edge.id, 0]))

        cars.forEach((car) => {
            counts.set(car.edgeId, (counts.get(car.edgeId) ?? 0) + 1)
        })

        const payload = {
            cars: cars.map((car) => ({
                id: car.id,
                edgeId: car.edgeId,
                distanceAlongEdge: Number(car.distanceAlongEdge.toFixed(2)),
            })),
            edges: storeEdges.map((edge) => {
                const density = counts.get(edge.id)! / edge.capacity
                let color = 120
                if (density >= 0.75) {
                    color = 3
                } else if (density >= 0.5) {
                    color = 2
                } else if (density >= 0.25) {
                    color = 1
                } else {
                    color = 0
                }
                return {
                    edgeId: edge.id,
                    carCount: counts.get(edge.id) ?? 0,
                    edgeCapacity: edge.capacity,
                    edgeDensity: density,
                    edgeColor: color,
                }
            }),
        }

        const blob = new Blob([JSON.stringify(payload, null, 2)], {
            type: 'application/json',
        })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `traffic-snapshot-${Date.now()}.json`
        link.click()
    }

    const handleExportGnn = () => {
        const { cars, edges: storeEdges, nodes: storeNodes, simTime, predictionHorizonSeconds } = useSimulationStore.getState()
        const counts = new Map(storeEdges.map((edge) => [edge.id, 0]))

        cars.forEach((car) => {
            counts.set(car.edgeId, (counts.get(car.edgeId) ?? 0) + 1)
        })

        const payload = {
            time: simTime,
            edges: storeEdges.map((edge) => {
                const count = counts.get(edge.id) ?? 0
                const density = count / edge.capacity

                const source = storeNodes.find(n => n.id === edge.sourceNodeId)
                const target = storeNodes.find(n => n.id === edge.targetNodeId)
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
                const phaseTimeRemaining = Number((5 - (simTime % 5)).toFixed(2))
                const spawnWeight = source?.type === 'entry' ? 2 : 1

                const edgeCars = cars.filter(car => car.edgeId === edge.id)
                const vehicles = edgeCars.map(car => ({
                    vehicleId: car.id,
                    averageCarSpeed: Number(car.speed.toFixed(1))
                }))

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
                    horizonTime: predictionHorizonSeconds,
                    vehicles
                }
            })
        }

        const blob = new Blob([JSON.stringify(payload, null, 2)], {
            type: 'application/json',
        })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `traffic-snapshot-gnn-${Date.now()}.json`
        link.click()
    }


    const handlePredict = async () => {
        setIsPredicting(true)
        setPredictionError(null)
        try {
            const { cars, edges: storeEdges, simTime } = useSimulationStore.getState()
            const counts = new Map(storeEdges.map((edge) => [edge.id, 0]))

            cars.forEach((car) => {
                counts.set(car.edgeId, (counts.get(car.edgeId) ?? 0) + 1)
            })

            const payload = {
                cars: cars.map((car) => ({
                    id: car.id,
                    edgeId: car.edgeId,
                    distanceAlongEdge: Number(car.distanceAlongEdge.toFixed(2)),
                })),
                edges: storeEdges.map((edge) => {
                    const density = counts.get(edge.id)! / edge.capacity
                    return {
                        edgeId: edge.id,
                        carCount: counts.get(edge.id) ?? 0,
                        edgeCapacity: edge.capacity,
                        edgeDensity: density,
                    }
                }),
            }

            const response = await fetch('http://localhost:5001/predict', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
            })

            if (!response.ok) {
                throw new Error(`Server returned status ${response.status}`)
            }

            const data = await response.json()
            const predictions = data.predictions || []
            const predictedStatusMap: Record<string, number> = {}
            predictions.forEach((pred: any) => {
                predictedStatusMap[pred.edgeId] = pred.predicted_status_code
            })

            const targetTime = simTime + predictionHorizonSeconds
            setPrediction(predictedStatusMap, targetTime)
        } catch (err: any) {
            setPredictionError(err.message || 'Failed to contact prediction server.')
        } finally {
            setIsPredicting(false)
        }
    }

    const handlePredictGnn = async () => {
        setIsPredicting(true)
        setPredictionError(null)
        try {
            const { cars, edges: storeEdges, nodes: storeNodes, simTime, predictionHorizonSeconds, gnnSnapshots } = useSimulationStore.getState()
            const counts = new Map(storeEdges.map((edge) => [edge.id, 0]))

            cars.forEach((car) => {
                counts.set(car.edgeId, (counts.get(car.edgeId) ?? 0) + 1)
            })

            const currentSnapshot = {
                time: simTime,
                edges: storeEdges.map((edge) => {
                    const count = counts.get(edge.id) ?? 0
                    const density = count / edge.capacity

                    const source = storeNodes.find(n => n.id === edge.sourceNodeId)
                    const target = storeNodes.find(n => n.id === edge.targetNodeId)
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
                    const phaseTimeRemaining = Number((5 - (simTime % 5)).toFixed(2))
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
                        horizonTime: predictionHorizonSeconds
                    }
                })
            }

            let snapsToSend = [...(gnnSnapshots || [])]
            if (snapsToSend.length === 0) {
                snapsToSend = Array(5).fill(currentSnapshot)
            } else {
                const firstSnap = snapsToSend[0]
                while (snapsToSend.length < 5) {
                    snapsToSend.unshift(firstSnap)
                }
            }

            const payload = {
                snapshots: snapsToSend
            }

            const response = await fetch('http://localhost:5001/predict-gnn', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
            })

            if (!response.ok) {
                throw new Error(`Server returned status ${response.status}`)
            }

            const data = await response.json()
            const predictions = data.predictions || []
            const predictedStatusMap: Record<string, number> = {}
            predictions.forEach((pred: any) => {
                predictedStatusMap[pred.edgeId] = pred.predicted_status_code
            })

            const targetTime = simTime + predictionHorizonSeconds
            setPrediction(predictedStatusMap, targetTime)
        } catch (err: any) {
            setPredictionError(err.message || 'Failed to contact GNN prediction server.')
        } finally {
            setIsPredicting(false)
        }
    }


    return (
        <section className="flex flex-col gap-6 rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-[0_24px_60px_rgba(15,23,42,0.15)] backdrop-blur overflow-y-auto max-h-full custom-scrollbar">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
                        Control Deck
                    </p>
                    <h2 className="mt-2 text-xl font-semibold text-slate-900">
                        Simulation Controls
                    </h2>
                </div>
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                    <span
                        className={`h-2.5 w-2.5 rounded-full ${running ? 'bg-emerald-500' : 'bg-amber-400'
                            }`}
                    />
                    {running ? 'Running' : 'Paused'}
                </div>
            </div>

            <div className="grid gap-3">
                <button
                    type="button"
                    onClick={() => setRunning(!running)}
                    className="flex items-center justify-between rounded-2xl border border-slate-200/80 bg-white px-4 py-3 text-sm font-semibold text-slate-900 transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg"
                >
                    <span className="flex items-center gap-2">
                        {running ? (
                            <Pause className="h-4 w-4" />
                        ) : (
                            <Play className="h-4 w-4" />
                        )}
                        {running ? 'Pause simulation' : 'Resume simulation'}
                    </span>
                    <span className="text-xs text-slate-500">Toggle</span>
                </button>

                <button
                    type="button"
                    onClick={resetSimulation}
                    className="flex items-center justify-between rounded-2xl border border-slate-200/80 bg-white px-4 py-3 text-sm font-semibold text-slate-900 transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg"
                >
                    <span className="flex items-center gap-2">
                        <RotateCcw className="h-4 w-4" />
                        Reset traffic state
                    </span>
                    <span className="text-xs text-slate-500">Clean slate</span>
                </button>
            </div>

            <div className="rounded-2xl border border-slate-200/70 bg-slate-50/70 p-4">
                <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">
                    <span className="flex items-center gap-2">
                        <Sliders className="h-4 w-4" />
                        Spawn Rate
                    </span>
                    <span className="text-slate-500">{spawnRate.toFixed(1)} / sec</span>
                </div>
                
                <div className="mt-3 flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-600">Auto Spawn Regulation</span>
                    <button
                        type="button"
                        onClick={() => {
                            const next = !autoSpawnRate
                            setAutoSpawnRate(next)
                            if (next) {
                                setSpawnRate(24.0)
                            }
                        }}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                            autoSpawnRate ? 'bg-teal-600' : 'bg-slate-300'
                        }`}
                    >
                        <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                autoSpawnRate ? 'translate-x-6' : 'translate-x-1'
                            }`}
                        />
                    </button>
                </div>

                <input
                    type="range"
                    min={0}
                    max={80}
                    step={0.2}
                    value={spawnRate}
                    onChange={(event) =>
                        setSpawnRate(clamp(Number(event.target.value), 0, 80))
                    }
                    disabled={autoSpawnRate}
                    className="mt-4 w-full accent-teal-600 disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
                    <span>0</span>
                    <span>80 cars/s</span>
                </div>
            </div>

            <div className="rounded-2xl border border-slate-200/70 bg-slate-50/70 p-4">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">
                    <Network className="h-4 w-4 text-teal-600" />
                    Topology Engine
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-slate-600">
                    <div className="rounded-xl border border-slate-200/50 bg-white p-2.5 shadow-sm">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Sub-edges</p>
                        <p className="mt-1 text-sm font-extrabold text-slate-800">{subEdgeCount}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200/50 bg-white p-2.5 shadow-sm">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Injected Nodes</p>
                        <p className="mt-1 text-sm font-extrabold text-slate-800">{injectedNodeCount}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200/50 bg-white p-2.5 shadow-sm">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Max Segment</p>
                        <p className="mt-1 text-sm font-extrabold text-slate-800">{TOPOLOGY_CONFIG.MAX_EDGE_LENGTH}px</p>
                    </div>
                    <div className="rounded-xl border border-slate-200/50 bg-white p-2.5 shadow-sm">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Pedestrian stops</p>
                        <p className="mt-1 text-sm font-extrabold text-slate-800 capitalize">
                            {TOPOLOGY_CONFIG.INTERMEDIATE_NODE_TYPE === 'pass-through' ? 'Disabled' : 'Enabled'}
                        </p>
                    </div>
                </div>
            </div>

            <div className="rounded-2xl border border-slate-200/70 bg-slate-50/70 p-4">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">
                    <Brain className="h-4 w-4 text-teal-600 animate-pulse" />
                    AI Traffic Predictor
                </div>

                <div className="mt-3 flex flex-col gap-3">
                    {/* Horizon Slider */}
                    <div>
                        <div className="flex justify-between text-xs text-slate-500 font-medium">
                            <span>Horizon lookahead:</span>
                            <span className="font-bold text-slate-800">{predictionHorizonSeconds} sec</span>
                        </div>
                        <input
                            type="range"
                            min={1}
                            max={30}
                            step={1}
                            value={predictionHorizonSeconds}
                            onChange={(e) => setPredictionHorizonSeconds(Number(e.target.value))}
                            className="mt-2 w-full accent-teal-600"
                        />
                    </div>

                    {/* Status & Results */}
                    {predictionActive && predictionTargetSimTime !== null && (
                        <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-2.5 text-center text-xs text-emerald-800 font-medium">
                            Prediction active. Verifying in{' '}
                            <span className="font-extrabold">
                                {Math.max(0, predictionTargetSimTime - simTime).toFixed(1)}s
                            </span>
                        </div>
                    )}

                    {predictionBalancedScore !== null && (
                        <div className="rounded-xl border border-teal-100 bg-teal-50/50 p-3 text-center text-xs text-teal-800 flex flex-col gap-2">
                            <div>
                                <p className="font-semibold uppercase tracking-wider text-[10px] text-teal-600">Balanced Prediction Score (Macro F1)</p>
                                <p className="mt-1 text-2xl font-black text-teal-700">{predictionBalancedScore}%</p>
                            </div>

                            {predictionConfusionMatrix && (
                                <div className="mt-2 pt-2 border-t border-teal-100/50">
                                    <p className="font-semibold uppercase tracking-wider text-[9px] text-teal-600 mb-2">Confusion Matrix (Actual vs Pred)</p>
                                    <div className="grid grid-cols-5 gap-1 text-[9px] font-mono select-none">
                                        {/* Header Row */}
                                        <div className="flex items-center justify-center text-slate-400 font-bold">A \ P</div>
                                        <div className="text-center font-bold text-slate-600 animate-pulse" title="Libero">Lib</div>
                                        <div className="text-center font-bold text-slate-600 animate-pulse" title="Rallentato">Ral</div>
                                        <div className="text-center font-bold text-slate-600 animate-pulse" title="Congestionato">Con</div>
                                        <div className="text-center font-bold text-slate-600 animate-pulse" title="Bloccato">Blo</div>

                                        {/* Matrix Rows */}
                                        {predictionConfusionMatrix.map((row, actualIdx) => {
                                            const classLabels = ['Lib', 'Ral', 'Con', 'Blo']
                                            const classFullNames = ['Libero', 'Rallentato', 'Congestionato', 'Bloccato']
                                            return (
                                                <Fragment key={actualIdx}>
                                                    {/* Row header (Actual class) */}
                                                    <div className="flex items-center justify-end pr-1 font-bold text-slate-600" title={classFullNames[actualIdx]}>
                                                        {classLabels[actualIdx]}
                                                    </div>
                                                    {/* Row values (Predicted classes) */}
                                                    {row.map((val, predIdx) => {
                                                        // Color scaling based on value
                                                        let bgClass = 'bg-slate-50/50 text-slate-400 border border-slate-100/40'
                                                        if (val > 0) {
                                                            if (actualIdx === predIdx) {
                                                                // Correct predictions (diagonal) - green/emerald shades
                                                                if (val < 5) bgClass = 'bg-emerald-100 text-emerald-800 font-bold border border-emerald-200'
                                                                else if (val < 15) bgClass = 'bg-emerald-300 text-emerald-900 font-bold border border-emerald-400'
                                                                else bgClass = 'bg-emerald-500 text-white font-extrabold border border-emerald-600'
                                                            } else {
                                                                // Incorrect predictions (off-diagonal) - warm orange/rose shades
                                                                if (val < 5) bgClass = 'bg-rose-100 text-rose-800 border border-rose-200'
                                                                else bgClass = 'bg-rose-300 text-rose-900 font-bold border border-rose-400'
                                                            }
                                                        }
                                                        return (
                                                            <div
                                                                key={predIdx}
                                                                className={`h-6 flex items-center justify-center rounded transition-all hover:scale-105 duration-100 ${bgClass}`}
                                                                title={`Actual: ${classFullNames[actualIdx]}, Predicted: ${classFullNames[predIdx]} - Count: ${val}`}
                                                            >
                                                                {val}
                                                            </div>
                                                        )
                                                    })}
                                                </Fragment>
                                            )
                                        })}
                                    </div>
                                    <div className="mt-2 text-[9px] text-slate-400 italic">
                                        Rows: Actual state | Columns: Predicted state
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {predictionError && (
                        <div className="text-[11px] font-semibold text-rose-500 bg-rose-50 border border-rose-100 p-2 rounded-xl text-center">
                            Error: {predictionError}
                        </div>
                    )}

                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={handlePredict}
                            disabled={isPredicting}
                            className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-3 py-2.5 text-xs font-semibold text-white shadow-md transition hover:-translate-y-0.5 hover:bg-slate-800 disabled:opacity-50"
                        >
                            Predict (RF)
                        </button>
                        <button
                            type="button"
                            onClick={handlePredictGnn}
                            disabled={isPredicting}
                            className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-3 py-2.5 text-xs font-semibold text-white shadow-md transition hover:-translate-y-0.5 hover:bg-slate-800 disabled:opacity-50"
                        >
                            Predict (GNN)
                        </button>
                    </div>
                </div>
            </div>

            <div className="flex gap-2">
                <button
                    type="button"
                    onClick={handleExport}
                    className="flex-1 flex items-center justify-center gap-2 rounded-2xl bg-slate-100 hover:bg-slate-200 px-4 py-3 text-sm font-semibold text-slate-800 transition hover:-translate-y-0.5"
                >
                    <Download className="h-4 w-4" />
                    Export Standard
                </button>
                <button
                    type="button"
                    onClick={handleExportGnn}
                    className="flex-1 flex items-center justify-center gap-2 rounded-2xl bg-teal-600 px-4 py-3 text-sm font-semibold text-white shadow-[0_18px_40px_rgba(13,148,136,0.35)] transition hover:-translate-y-0.5 hover:bg-teal-500"
                >
                    <Download className="h-4 w-4" />
                    Export GNN
                </button>
            </div>

            <div className="rounded-2xl border border-dashed border-slate-200 bg-white/70 p-4 text-xs text-slate-500">
                Cars accelerate up to the edge speed limit, brake for red lights, and
                maintain a 5px safety buffer within a 30px look-ahead radius.
            </div>
        </section>
    )
}
