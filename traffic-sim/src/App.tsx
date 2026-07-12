import { Dashboard } from './components/Dashboard'
import { SimulationCanvas } from './components/SimulationCanvas'
import { simulationDefaults, useSimulationStore } from './simulation/store'
import { useSimulationEngine } from './simulation/useSimulationEngine'

function App() {
    useSimulationEngine()
    const carCount = useSimulationStore((state) => state.cars.length)
    const running = useSimulationStore((state) => state.running)
    const spawnRate = useSimulationStore((state) => state.spawnRate)

    // Get edge count to show network complexity instead of grid dimensions
    const edgeCount = useSimulationStore((state) => state.edges.length)

    return (
        <div className="min-h-screen px-6 pb-12 pt-8">
            <div className="fixed right-4 top-4 z-50 w-[300px] max-w-[85vw] sm:right-6 sm:top-6 max-h-[calc(100vh-2rem)] sm:max-h-[calc(100vh-3rem)] flex flex-col">
                <Dashboard />
            </div>
            <header className="mx-auto flex w-full max-w-6xl flex-col gap-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.32em] text-slate-500">
                            Synthetic Congestion Lab
                        </p>
                        <h1 className="mt-3 text-3xl font-semibold text-slate-900 md:text-4xl">
                            2D Traffic Simulator
                        </h1>
                        <p className="mt-2 max-w-xl text-sm text-slate-600">
                            High-frequency canvas traffic flow for generating grounded
                            congestion datasets, powered by an IDM-inspired physics loop.
                        </p>
                    </div>
                    <div className="rounded-2xl border border-slate-200/70 bg-white/80 px-4 py-3 text-xs text-slate-600 shadow-[0_18px_40px_rgba(15,23,42,0.12)]">
                        <div className="flex flex-wrap items-center gap-4">
                            <div>
                                <p className="text-[10px] uppercase tracking-[0.28em] text-slate-400">
                                    Roads
                                </p>
                                <p className="text-sm font-semibold text-slate-700">
                                    {edgeCount} segments
                                </p>
                            </div>
                            <div className="h-6 w-px bg-slate-200" />
                            <div>
                                <p className="text-[10px] uppercase tracking-[0.28em] text-slate-400">
                                    Canvas
                                </p>
                                <p className="text-sm font-semibold text-slate-700">
                                    {simulationDefaults.width} x {simulationDefaults.height}
                                </p>
                            </div>
                            <div className="h-6 w-px bg-slate-200" />
                            <div>
                                <p className="text-[10px] uppercase tracking-[0.28em] text-slate-400">
                                    Cars
                                </p>
                                <p className="text-sm font-semibold text-slate-700">
                                    {carCount}
                                </p>
                            </div>
                            <div className="h-6 w-px bg-slate-200" />
                            <div>
                                <p className="text-[10px] uppercase tracking-[0.28em] text-slate-400">
                                    Spawn
                                </p>
                                <p className="text-sm font-semibold text-slate-700">
                                    {spawnRate.toFixed(1)}/s
                                </p>
                            </div>
                            <div className="h-6 w-px bg-slate-200" />
                            <div className="flex items-center gap-2">
                                <span
                                    className={`h-2.5 w-2.5 rounded-full ${running ? 'bg-emerald-500' : 'bg-amber-400'
                                        }`}
                                />
                                <p className="text-sm font-semibold text-slate-700">
                                    {running ? 'Running' : 'Paused'}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </header>

            <main className="mx-auto mt-8 w-full max-w-6xl">
                <section className="rounded-3xl border border-slate-200/70 bg-white/80 p-4 shadow-[0_24px_60px_rgba(15,23,42,0.14)] backdrop-blur">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">
                        <span>City Graph</span>
                        <span className="text-[11px] font-medium tracking-[0.2em] text-slate-500">
                            Sparse graph with custom road lengths and speeds
                        </span>
                    </div>
                    <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white">
                        <SimulationCanvas />
                    </div>
                </section>
            </main>
        </div>
    )
}

export default App