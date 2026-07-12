import type { Edge, Node } from './types'

export const TOPOLOGY_CONFIG = {
    MAX_EDGE_LENGTH: 15, // Compile-time maximum segment length in pixels
    INTERMEDIATE_NODE_TYPE: 'pass-through' as 'pass-through' | 'semaphore', // 'pass-through' or 'semaphore'
}

export const RAW_TOWN_NODES: Node[] = [
    // Perimeter Spoke Nodes
    { id: 'entry-n', x: 450, y: 20, type: 'entry' },
    { id: 'exit-n', x: 480, y: 20, type: 'exit' },
    { id: 'entry-s', x: 450, y: 580, type: 'entry' },
    { id: 'exit-s', x: 420, y: 580, type: 'exit' },
    { id: 'entry-w', x: 20, y: 300, type: 'entry' },
    { id: 'exit-w', x: 20, y: 330, type: 'exit' },
    { id: 'entry-e', x: 880, y: 300, type: 'entry' },
    { id: 'exit-e', x: 880, y: 270, type: 'exit' },

    // Bypass Ring Nodes (Outer Loop)
    { id: 'b-nw', x: 200, y: 150, type: 'intersection' },
    { id: 'b-ne', x: 700, y: 150, type: 'intersection' },
    { id: 'b-sw', x: 200, y: 450, type: 'intersection' },
    { id: 'b-se', x: 700, y: 450, type: 'intersection' },

    // Central Core Nodes (Inner Loop)
    { id: 'c-nw', x: 400, y: 250, type: 'intersection' },
    { id: 'c-ne', x: 500, y: 250, type: 'intersection' },
    { id: 'c-sw', x: 400, y: 350, type: 'intersection' },
    { id: 'c-se', x: 500, y: 350, type: 'intersection' },
]

export const RAW_TOWN_EDGES: Edge[] = [
    // --- IN-ROUTES (Radial Inward) ---
    { id: 'v-in-n', sourceNodeId: 'entry-n', targetNodeId: 'b-ne', speedLimit: 80, capacity: 50 },
    { id: 'v-in-s', sourceNodeId: 'entry-s', targetNodeId: 'b-sw', speedLimit: 80, capacity: 50 },
    { id: 'h-in-w', sourceNodeId: 'entry-w', targetNodeId: 'b-nw', speedLimit: 80, capacity: 50 },
    { id: 'h-in-e', sourceNodeId: 'entry-e', targetNodeId: 'b-se', speedLimit: 80, capacity: 50 },

    // --- BYPASS RING (Clockwise) ---
    { id: 'h-b-nw-ne', sourceNodeId: 'b-nw', targetNodeId: 'b-ne', speedLimit: 60, capacity: 70 },
    { id: 'v-b-ne-se', sourceNodeId: 'b-ne', targetNodeId: 'b-se', speedLimit: 60, capacity: 70 },
    { id: 'h-b-se-sw', sourceNodeId: 'b-se', targetNodeId: 'b-sw', speedLimit: 60, capacity: 70 },
    { id: 'v-b-sw-nw', sourceNodeId: 'b-sw', targetNodeId: 'b-nw', speedLimit: 60, capacity: 70 },

    // --- INWARD CORE SPOKES ---
    { id: 'v-b-nw-cnw', sourceNodeId: 'b-nw', targetNodeId: 'c-nw', speedLimit: 40, capacity: 40 },
    { id: 'h-b-ne-cne', sourceNodeId: 'b-ne', targetNodeId: 'c-ne', speedLimit: 40, capacity: 40 },
    { id: 'h-b-sw-csw', sourceNodeId: 'b-sw', targetNodeId: 'c-sw', speedLimit: 40, capacity: 40 },
    { id: 'v-b-se-cse', sourceNodeId: 'b-se', targetNodeId: 'c-se', speedLimit: 40, capacity: 40 },

    // --- CENTRAL CORE (Counter-Clockwise Loop) ---
    { id: 'v-c-nw-sw', sourceNodeId: 'c-nw', targetNodeId: 'c-sw', speedLimit: 30, capacity: 10 },
    { id: 'h-c-sw-se', sourceNodeId: 'c-sw', targetNodeId: 'c-se', speedLimit: 30, capacity: 10 },
    { id: 'v-c-se-ne', sourceNodeId: 'c-se', targetNodeId: 'c-ne', speedLimit: 30, capacity: 10 },
    { id: 'h-c-ne-nw', sourceNodeId: 'c-ne', targetNodeId: 'c-nw', speedLimit: 30, capacity: 10 },

    // --- OUTWARD CORE SPOKES (The Escape Hatches) ---
    { id: 'h-c-nw-bnw', sourceNodeId: 'c-nw', targetNodeId: 'b-nw', speedLimit: 40, capacity: 40 },
    { id: 'v-c-ne-bne', sourceNodeId: 'c-ne', targetNodeId: 'b-ne', speedLimit: 40, capacity: 40 },
    { id: 'v-c-sw-bsw', sourceNodeId: 'c-sw', targetNodeId: 'b-sw', speedLimit: 40, capacity: 40 },
    { id: 'h-c-se-bse', sourceNodeId: 'c-se', targetNodeId: 'b-se', speedLimit: 40, capacity: 40 },

    // --- OUT-ROUTES (Radial Outward) ---
    { id: 'v-out-n', sourceNodeId: 'b-ne', targetNodeId: 'exit-n', speedLimit: 70, capacity: 50 },
    { id: 'v-out-s', sourceNodeId: 'b-sw', targetNodeId: 'exit-s', speedLimit: 70, capacity: 50 },
    { id: 'h-out-w', sourceNodeId: 'b-nw', targetNodeId: 'exit-w', speedLimit: 70, capacity: 50 },
    { id: 'h-out-e', sourceNodeId: 'b-se', targetNodeId: 'exit-e', speedLimit: 70, capacity: 50 },
]

export const compileGraph = (
    rawNodes: Node[],
    rawEdges: Edge[],
    config: typeof TOPOLOGY_CONFIG
): { nodes: Node[]; edges: Edge[] } => {
    const { MAX_EDGE_LENGTH } = config
    const nodeById = new Map(rawNodes.map((n) => [n.id, n]))

    const compiledNodes: Node[] = [...rawNodes]
    const compiledEdges: Edge[] = []

    rawEdges.forEach((parentEdge) => {
        const source = nodeById.get(parentEdge.sourceNodeId)
        const target = nodeById.get(parentEdge.targetNodeId)

        if (!source || !target) {
            compiledEdges.push(parentEdge)
            return
        }

        const dx = target.x - source.x
        const dy = target.y - source.y
        const L = Math.hypot(dx, dy)

        const N = Math.ceil(L / MAX_EDGE_LENGTH)

        if (N <= 1) {
            compiledEdges.push({
                ...parentEdge,
                isSubedge: false,
            })
            return
        }

        // Insert N-1 intermediate nodes
        const intermediateNodeIds: string[] = []
        for (let i = 1; i < N; i++) {
            const nodeId = `${parentEdge.id}_node_${i}`
            const t = i / N
            const x = source.x + t * dx
            const y = source.y + t * dy

            const newNode: Node = {
                id: nodeId,
                x,
                y,
                type: 'intersection',
            }
            compiledNodes.push(newNode)
            intermediateNodeIds.push(nodeId)
        }

        // Create N sub-edges
        const subCapacity = parentEdge.capacity / N

        for (let i = 0; i < N; i++) {
            const subEdgeId = `${parentEdge.id}_sub_${i}_of_${N}`
            const edgeSourceId = i === 0 ? parentEdge.sourceNodeId : intermediateNodeIds[i - 1]
            const edgeTargetId = i === N - 1 ? parentEdge.targetNodeId : intermediateNodeIds[i]

            const subEdge: Edge = {
                id: subEdgeId,
                sourceNodeId: edgeSourceId,
                targetNodeId: edgeTargetId,
                speedLimit: parentEdge.speedLimit,
                capacity: subCapacity,
                parentEdgeId: parentEdge.id,
                subEdgeIndex: i,
                totalSubEdges: N,
                isSubedge: true,
            }
            compiledEdges.push(subEdge)
        }
    })

    return {
        nodes: compiledNodes,
        edges: compiledEdges,
    }
}

export const applyTrafficLightsForGraph = (
    edges: Edge[],
    phase: 0 | 1,
    intermediateNodeType: 'pass-through' | 'semaphore'
): Edge[] => {
    return edges.map((edge) => {
        // If it's an intermediate subedge (i.e., not the final one in the split chain)
        if (
            edge.isSubedge &&
            edge.subEdgeIndex !== undefined &&
            edge.totalSubEdges !== undefined &&
            edge.subEdgeIndex < edge.totalSubEdges - 1
        ) {
            if (intermediateNodeType === 'pass-through') {
                return {
                    ...edge,
                    trafficLight: undefined, // Free flow
                }
            } else {
                // If it is 'semaphore', it acts as a pedestrian stop.
                // They do not need directions (alternating orientation parity). They all toggle together as inline stops.
                return {
                    ...edge,
                    trafficLight: phase === 0 ? 'red' : 'green',
                }
            }
        }

        // For undivided edges or the last sub-edge in a split chain (which leads to the real intersection)
        const isHorizontal = (edge.parentEdgeId ?? edge.id).startsWith('h-')
        const edgeParity = isHorizontal ? 0 : 1
        return {
            ...edge,
            trafficLight: edgeParity === phase ? 'green' : 'red',
        }
    })
}

export const createTownMap = (width: number, height: number) => {
    const compiled = compileGraph(RAW_TOWN_NODES, RAW_TOWN_EDGES, TOPOLOGY_CONFIG)

    return {
        nodes: compiled.nodes,
        edges: applyTrafficLightsForGraph(
            compiled.edges,
            0,
            TOPOLOGY_CONFIG.INTERMEDIATE_NODE_TYPE
        ),
        entryNodeIds: compiled.nodes.filter((n) => n.type === 'entry').map((n) => n.id),
        exitNodeIds: compiled.nodes.filter((n) => n.type === 'exit').map((n) => n.id),
        width,
        height,
    }
}