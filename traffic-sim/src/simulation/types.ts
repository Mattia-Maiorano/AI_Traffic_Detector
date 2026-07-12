export type TrafficLight = 'red' | 'green'

export type NodeType = 'entry' | 'exit' | 'intersection'

export type Node = {
    id: string
    x: number
    y: number
    type: NodeType
}

export type Edge = {
    id: string
    sourceNodeId: string
    targetNodeId: string
    speedLimit: number
    trafficLight?: TrafficLight
    capacity: number
    parentEdgeId?: string
    subEdgeIndex?: number
    totalSubEdges?: number
    isSubedge?: boolean
}

export type Car = {
    id: string
    edgeId: string
    distanceAlongEdge: number
    speed: number
    maxSpeed: number
}

export type SimulationStore = {
    nodes: Node[]
    edges: Edge[]
    cars: Car[]
    entryNodeIds: string[]
    exitNodeIds: string[]
    canvasWidth: number
    canvasHeight: number
    running: boolean
    spawnRate: number
    lightPhase: 0 | 1
    simTime: number
    resetToken: number
    autoSpawnRate: boolean
    // Prediction State
    predictionActive: boolean
    predictedStatus: Record<string, number> | null
    predictionTargetSimTime: number | null
    predictionHorizonSeconds: number
    predictionBalancedScore: number | null
    predictionConfusionMatrix: number[][] | null
    gnnSnapshots: any[]

    setRunning: (running: boolean) => void
    setSpawnRate: (spawnRate: number) => void
    setAutoSpawnRate: (autoSpawnRate: boolean) => void
    setCars: (cars: Car[]) => void
    setSimTime: (time: number) => void
    setLightPhase: (phase: 0 | 1) => void
    toggleLightPhase: () => void
    resetSimulation: () => void
    setPrediction: (status: Record<string, number>, targetTime: number) => void
    clearPrediction: () => void
    setPredictionBalancedScore: (score: number | null) => void
    setPredictionConfusionMatrix: (matrix: number[][] | null) => void
    setPredictionHorizonSeconds: (horizon: number) => void
}
