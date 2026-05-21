import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { SimulationStore } from './types'
import { applyTrafficLightsForGraph, createTownMap, TOPOLOGY_CONFIG } from './map'

// 1. Define global application constants
const DEFAULT_SPAWN_RATE = 2
const CANVAS_WIDTH = 900
const CANVAS_HEIGHT = 600

// 2. Initialize the manual town map instead of the procedural grid
const mapData = createTownMap(CANVAS_WIDTH, CANVAS_HEIGHT)

export const useSimulationStore = create<SimulationStore>()(
    subscribeWithSelector((set) => ({
        // Map Geometry and Logic
        nodes: mapData.nodes,
        edges: mapData.edges,
        entryNodeIds: mapData.entryNodeIds,
        exitNodeIds: mapData.exitNodeIds,
        canvasWidth: mapData.width,
        canvasHeight: mapData.height,

        // Simulation State
        cars: [],
        running: true,
        spawnRate: DEFAULT_SPAWN_RATE,
        lightPhase: 0,
        simTime: 0,
        resetToken: 0,

        // Actions
        setRunning: (running) => set({ running }),
        setSpawnRate: (spawnRate) => set({ spawnRate }),
        setCars: (cars) => set({ cars }),
        setSimTime: (simTime) => set({ simTime }),

        setLightPhase: (phase) =>
            set((state) => ({
                lightPhase: phase,
                edges: applyTrafficLightsForGraph(state.edges, phase, TOPOLOGY_CONFIG.INTERMEDIATE_NODE_TYPE),
            })),

        toggleLightPhase: () =>
            set((state) => {
                const nextPhase: 0 | 1 = state.lightPhase === 0 ? 1 : 0
                return {
                    lightPhase: nextPhase,
                    edges: applyTrafficLightsForGraph(state.edges, nextPhase, TOPOLOGY_CONFIG.INTERMEDIATE_NODE_TYPE),
                }
            }),

        resetSimulation: () =>
            set((state) => ({
                cars: [],
                simTime: 0,
                lightPhase: 0,
                resetToken: state.resetToken + 1,
                edges: applyTrafficLightsForGraph(state.edges, 0, TOPOLOGY_CONFIG.INTERMEDIATE_NODE_TYPE),
            })),
    })),
)

// Updated defaults for UI components[cite: 3]
export const simulationDefaults = {
    spawnRate: DEFAULT_SPAWN_RATE,
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
}