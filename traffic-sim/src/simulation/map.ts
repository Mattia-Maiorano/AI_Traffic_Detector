import type { Edge, Node } from './types'

export const TOPOLOGY_CONFIG = {
    // -------------------------------------------------------------
    // CHANGE THIS NUMBER TO SCALE GRID COMPLEXITY
    // 2 = 2x2 intersections, 4 = 4x4 grid (Manhattan style), etc.
    // -------------------------------------------------------------
    GRID_SIZE: 10,

    MAX_EDGE_LENGTH: 150,
    INTERMEDIATE_NODE_TYPE: 'pass-through' as 'pass-through' | 'semaphore',
}

/**
 * Procedurally generates a Manhattan-style grid with alternating one-way streets.
 */
export const generateManhattanMap = (gridSize: number) => {
    const nodes: Node[] = []
    const edges: Edge[] = []

    const spacing = 120 // Distance between intersections
    const padding = 100 // Border padding for entry/exit points

    // 1. Generate Grid Intersections
    for (let r = 0; r < gridSize; r++) {
        for (let c = 0; c < gridSize; c++) {
            nodes.push({
                id: `node-${r}-${c}`,
                x: padding + c * spacing,
                y: padding + r * spacing,
                type: 'intersection'
            })
        }
    }

    // 2. Generate Perimeter Entry/Exit Nodes
    for (let i = 0; i < gridSize; i++) {
        const firstPos = padding
        const lastPos = padding + (gridSize - 1) * spacing

        // Vertical boundary entry/exits (North & South)
        if (i % 2 === 0) {
            nodes.push({ id: `entry-n-${i}`, x: padding + i * spacing, y: firstPos - 60, type: 'entry' })
            nodes.push({ id: `exit-s-${i}`, x: padding + i * spacing, y: lastPos + 60, type: 'exit' })
        } else {
            nodes.push({ id: `entry-s-${i}`, x: padding + i * spacing, y: lastPos + 60, type: 'entry' })
            nodes.push({ id: `exit-n-${i}`, x: padding + i * spacing, y: firstPos - 60, type: 'exit' })
        }

        // Horizontal boundary entry/exits (West & East)
        if (i % 2 === 0) {
            nodes.push({ id: `entry-w-${i}`, x: firstPos - 60, y: padding + i * spacing, type: 'entry' })
            nodes.push({ id: `exit-e-${i}`, x: lastPos + 60, y: padding + i * spacing, type: 'exit' })
        } else {
            nodes.push({ id: `entry-e-${i}`, x: lastPos + 60, y: padding + i * spacing, type: 'entry' })
            nodes.push({ id: `exit-w-${i}`, x: firstPos - 60, y: padding + i * spacing, type: 'exit' })
        }
    }

    // 3. Connect Internal One-Way Grid Roads & Boundary Entry/Exits
    for (let r = 0; r < gridSize; r++) {
        for (let c = 0; c < gridSize; c++) {

            // --- HORIZONTAL EDGES (Avenues) ---
            if (c < gridSize - 1) {
                const eastBound = r % 2 === 0
                const sourceCol = eastBound ? c : c + 1
                const targetCol = eastBound ? c + 1 : c

                edges.push({
                    id: `h-street-${r}-${c}`,
                    sourceNodeId: `node-${r}-${sourceCol}`,
                    targetNodeId: `node-${r}-${targetCol}`,
                    speedLimit: 50,
                    capacity: 40
                })
            }

            // --- VERTICAL EDGES (Streets) ---
            if (r < gridSize - 1) {
                const southBound = c % 2 === 0
                const sourceRow = southBound ? r : r + 1
                const targetRow = southBound ? r + 1 : r

                edges.push({
                    id: `v-avenue-${r}-${c}`,
                    sourceNodeId: `node-${sourceRow}-${c}`,
                    targetNodeId: `node-${targetRow}-${c}`,
                    speedLimit: 50,
                    capacity: 40
                })
            }
        }
    }

    // 4. Connect Boundary Entries and Exits to the Outer Grid Elements
    for (let i = 0; i < gridSize; i++) {
        if (i % 2 === 0) {
            // North to South flows
            edges.push({ id: `v-in-n-${i}`, sourceNodeId: `entry-n-${i}`, targetNodeId: `node-0-${i}`, speedLimit: 60, capacity: 50 })
            edges.push({ id: `v-out-s-${i}`, sourceNodeId: `node-${gridSize - 1}-${i}`, targetNodeId: `exit-s-${i}`, speedLimit: 60, capacity: 50 })
            // West to East flows
            edges.push({ id: `h-in-w-${i}`, sourceNodeId: `entry-w-${i}`, targetNodeId: `node-${i}-0`, speedLimit: 60, capacity: 50 })
            edges.push({ id: `h-out-e-${i}`, sourceNodeId: `node-${i}-${gridSize - 1}`, targetNodeId: `exit-e-${i}`, speedLimit: 60, capacity: 50 })
        } else {
            // South to North flows
            edges.push({ id: `v-in-s-${i}`, sourceNodeId: `entry-s-${i}`, targetNodeId: `node-${gridSize - 1}-${i}`, speedLimit: 60, capacity: 50 })
            edges.push({ id: `v-out-n-${i}`, sourceNodeId: `node-0-${i}`, targetNodeId: `exit-n-${i}`, speedLimit: 60, capacity: 50 })
            // East to West flows
            edges.push({ id: `h-in-e-${i}`, sourceNodeId: `entry-e-${i}`, targetNodeId: `node-${i}-${gridSize - 1}`, speedLimit: 60, capacity: 50 })
            edges.push({ id: `h-out-w-${i}`, sourceNodeId: `node-${i}-0`, targetNodeId: `exit-w-${i}`, speedLimit: 60, capacity: 50 })
        }
    }

    return { nodes, edges }
}

// ... Keep your existing compileGraph and applyTrafficLightsForGraph functions exactly as they are ...
export const compileGraph = (rawNodes: Node[], rawEdges: Edge[], config: typeof TOPOLOGY_CONFIG): { nodes: Node[]; edges: Edge[] } => {
    const { MAX_EDGE_LENGTH } = config
    const nodeById = new Map(rawNodes.map((n) => [n.id, n]))
    const compiledNodes: Node[] = [...rawNodes]
    const compiledEdges: Edge[] = []

    rawEdges.forEach((parentEdge) => {
        const source = nodeById.get(parentEdge.sourceNodeId)
        const target = nodeById.get(parentEdge.targetNodeId)
        if (!source || !target) { compiledEdges.push(parentEdge); return }

        const dx = target.x - source.x
        const dy = target.y - source.y
        const L = Math.hypot(dx, dy)
        const N = Math.ceil(L / MAX_EDGE_LENGTH)

        if (N <= 1) {
            compiledEdges.push({ ...parentEdge, isSubedge: false })
            return
        }

        const intermediateNodeIds: string[] = []
        for (let i = 1; i < N; i++) {
            const nodeId = `${parentEdge.id}_node_${i}`
            const t = i / N
            const newNode: Node = { id: nodeId, x: source.x + t * dx, y: source.y + t * dy, type: 'intersection' }
            compiledNodes.push(newNode)
            intermediateNodeIds.push(nodeId)
        }

        const subCapacity = parentEdge.capacity / N
        for (let i = 0; i < N; i++) {
            const subEdgeId = `${parentEdge.id}_sub_${i}_of_${N}`
            const edgeSourceId = i === 0 ? parentEdge.sourceNodeId : intermediateNodeIds[i - 1]
            const edgeTargetId = i === N - 1 ? parentEdge.targetNodeId : intermediateNodeIds[i]

            compiledEdges.push({
                id: subEdgeId, sourceNodeId: edgeSourceId, targetNodeId: edgeTargetId,
                speedLimit: parentEdge.speedLimit, capacity: subCapacity, parentEdgeId: parentEdge.id,
                subEdgeIndex: i, totalSubEdges: N, isSubedge: true
            })
        }
    })
    return { nodes: compiledNodes, edges: compiledEdges }
}

export const applyTrafficLightsForGraph = (edges: Edge[], phase: 0 | 1, intermediateNodeType: 'pass-through' | 'semaphore'): Edge[] => {
    return edges.map((edge) => {
        if (edge.isSubedge && edge.subEdgeIndex !== undefined && edge.totalSubEdges !== undefined && edge.subEdgeIndex < edge.totalSubEdges - 1) {
            return { ...edge, trafficLight: intermediateNodeType === 'pass-through' ? undefined : (phase === 0 ? 'red' : 'green') }
        }
        const isHorizontal = (edge.parentEdgeId ?? edge.id).startsWith('h-')
        return { ...edge, trafficLight: (isHorizontal ? 0 : 1) === phase ? 'green' : 'red' }
    })
}

export const createTownMap = (_width: number, _height: number) => {
    const { nodes, edges } = generateManhattanMap(TOPOLOGY_CONFIG.GRID_SIZE);
    const compiled = compileGraph(nodes, edges, TOPOLOGY_CONFIG);

    // Gather the standard perimeter entry nodes
    const perimeterEntries = compiled.nodes.filter((n) => n.type === 'entry').map((n) => n.id);

    // Gather all internal crossroads/intersections to use as random internal spawn points
    const internalCrossroads = compiled.nodes
        .filter((n) => n.type === 'intersection' && !n.id.includes('_node_')) // Exclude intermediate sub-edge nodes
        .map((n) => n.id);

    return {
        nodes: compiled.nodes,
        edges: applyTrafficLightsForGraph(compiled.edges, 0, TOPOLOGY_CONFIG.INTERMEDIATE_NODE_TYPE),

        // Combine both perimeter and internal crossroads so your spawning engine can use them
        entryNodeIds: [...perimeterEntries, ...internalCrossroads],
        exitNodeIds: compiled.nodes.filter((n) => n.type === 'exit').map((n) => n.id),

        width: padding * 2 + (TOPOLOGY_CONFIG.GRID_SIZE - 1) * 120,
        height: padding * 2 + (TOPOLOGY_CONFIG.GRID_SIZE - 1) * 120,
    };
};
const padding = 100 // Local alias for map calculation boundary matching