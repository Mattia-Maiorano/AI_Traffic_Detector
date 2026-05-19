import { Download, Pause, Play, RotateCcw, Sliders } from 'lucide-react'
import { useSimulationStore } from '../simulation/store'

const clamp = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, value))

export const Dashboard = () => {
    const running = useSimulationStore((state) => state.running)
    const spawnRate = useSimulationStore((state) => state.spawnRate)
    const setRunning = useSimulationStore((state) => state.setRunning)
    const setSpawnRate = useSimulationStore((state) => state.setSpawnRate)
    const resetSimulation = useSimulationStore((state) => state.resetSimulation)

    const handleExport = () => {
        const { cars, edges } = useSimulationStore.getState()
        const counts = new Map(edges.map((edge) => [edge.id, 0]))

        cars.forEach((car) => {
            counts.set(car.edgeId, (counts.get(car.edgeId) ?? 0) + 1)
        })

        const payload = {
            cars: cars.map((car) => ({
                id: car.id,
                edgeId: car.edgeId,
                distanceAlongEdge: Number(car.distanceAlongEdge.toFixed(2)),
            })),
            edges: edges.map((edge) => ({
                edgeId: edge.id,
                carCount: counts.get(edge.id) ?? 0,
                edgeCapacity: edge.capacity,
                edgeDensity: counts.get(edge.id)! / edge.capacity,
            })),
        }

        const blob = new Blob([JSON.stringify(payload, null, 2)], {
            type: 'application/json',
        })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `traffic-snapshot-${Date.now()}.json`
        link.click()
        URL.revokeObjectURL(url)
    }

    return (
        <section className="flex flex-col gap-6 rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-[0_24px_60px_rgba(15,23,42,0.15)] backdrop-blur">
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
                <input
                    type="range"
                    min={0}
                    max={8}
                    step={0.2}
                    value={spawnRate}
                    onChange={(event) =>
                        setSpawnRate(clamp(Number(event.target.value), 0, 8))
                    }
                    className="mt-4 w-full accent-teal-600"
                />
                <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
                    <span>0</span>
                    <span>8 cars/s</span>
                </div>
            </div>

            <button
                type="button"
                onClick={handleExport}
                className="flex items-center justify-center gap-2 rounded-2xl bg-teal-600 px-4 py-3 text-sm font-semibold text-white shadow-[0_18px_40px_rgba(13,148,136,0.35)] transition hover:-translate-y-0.5 hover:bg-teal-500"
            >
                <Download className="h-4 w-4" />
                Export JSON snapshot
            </button>

            <div className="rounded-2xl border border-dashed border-slate-200 bg-white/70 p-4 text-xs text-slate-500">
                Cars accelerate up to the edge speed limit, brake for red lights, and
                maintain a 5px safety buffer within a 30px look-ahead radius.
            </div>
        </section>
    )
}
