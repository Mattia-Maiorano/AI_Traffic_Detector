import type { Edge, Node } from './types'

// ==========================================
// 1. CONFIGURATION
// ==========================================

export const TOPOLOGY_CONFIG = {
    MAX_EDGE_LENGTH: 150, // Compile-time maximum segment length in pixels
    INTERMEDIATE_NODE_TYPE: 'pass-through' as 'pass-through' | 'semaphore',
}

export interface CityGenerationOptions {
    numRings?: number;          // Number of concentric loops (e.g., Core, Inner, Outer, Bypass)
    sidesPerRing?: number;      // 4 for a square city, 6 for hexagonal, 8 for octagonal, etc.
    positionJitter?: number;    // Max pixels nodes can randomly shift (gives organic/curved roads)
    edgeOmissionChance?: number;// Probability (0.0 to 1.0) that optional connecting streets are skipped
    maxRetries?: number;        // Safety cutoff for the randomized generation loop
    internalSpawnCount?: number; // Number of internal spawn points to create (in addition to perimeter entries)
}

// ==========================================
// 2. CORE TOPOLOGY COMPILATION
// ==========================================

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

// ==========================================
// 3. TRAFFIC LIGHT LOGIC
// ==========================================

export const applyRealisticTrafficLights = (
    edges: Edge[],
    globalTimeSeconds: number,
    cycleLength: number = 30 // total duration for a full red/green loop
): Edge[] => {
    return edges.map((edge) => {
        // Fix: intermediateNodeType is read directly from TOPOLOGY_CONFIG now
        if (
            edge.isSubedge &&
            edge.subEdgeIndex !== undefined &&
            edge.totalSubEdges !== undefined &&
            edge.subEdgeIndex < edge.totalSubEdges - 1
        ) {
            if (TOPOLOGY_CONFIG.INTERMEDIATE_NODE_TYPE === 'pass-through') {
                return { ...edge, trafficLight: undefined }
            } else {
                // If it's a structural intermediate semaphore, cycle it normally over global time
                const progress = globalTimeSeconds % cycleLength;
                return { ...edge, trafficLight: progress < cycleLength / 2 ? 'red' : 'green' }
            }
        }

        const isHorizontal = (edge.parentEdgeId ?? edge.id).startsWith('h-')
        // Pseudo-random offset unique to each intersection's ID or coordinates
        const stableHash = edge.targetNodeId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        const localizedOffset = stableHash % cycleLength;

        // Determine where this specific light is in its own cycle
        const currentCycleProgress = (globalTimeSeconds + localizedOffset) % cycleLength;
        const isGreenPhase = currentCycleProgress < (cycleLength / 2);

        // Assign green/red based on direction and localized cycle phase
        let trafficLight: 'green' | 'red';
        if (isHorizontal) {
            trafficLight = isGreenPhase ? 'green' : 'red';
        } else {
            trafficLight = isGreenPhase ? 'red' : 'green'; // Vertical is inverted
        }

        return { ...edge, trafficLight };
    });
}

// ==========================================
// 4. TOPOLOGY VALIDATION GUARD
// ==========================================

export const validateTopology = (nodes: Node[], edges: Edge[]): void => {
    const exitNodes = nodes.filter((n) => n.type === 'exit');
    if (exitNodes.length === 0) {
        throw new Error("Validation Failed: The map contains zero exit nodes.");
    }

    const adjList = new Map<string, string[]>();
    nodes.forEach((n) => adjList.set(n.id, []));
    edges.forEach((e) => {
        if (adjList.has(e.sourceNodeId)) {
            adjList.get(e.sourceNodeId)!.push(e.targetNodeId);
        }
    });

    const exitNodeIds = new Set(exitNodes.map((n) => n.id));

    for (const node of nodes) {
        if (node.type === 'exit') continue;

        const visited = new Set<string>([node.id]);
        const queue: string[] = [node.id];
        let canEscape = false;

        while (queue.length > 0) {
            const currentId = queue.shift()!;

            if (exitNodeIds.has(currentId)) {
                canEscape = true;
                break;
            }

            const neighbors = adjList.get(currentId) || [];
            for (const neighbor of neighbors) {
                if (!visited.has(neighbor)) {
                    visited.add(neighbor);
                    queue.push(neighbor);
                }
            }
        }

        if (!canEscape) {
            throw new Error(`Topology Failure: Node "${node.id}" forms a well or dead-end.`);
        }
    }
};

// ==========================================
// 5. AUTONOMOUS MAP GENERATOR
// ==========================================

/**
 * Fully autonomous, randomized procedural city generator.
 * Automatically loops and self-corrects if it rolls an inescapable trap.
 */
export const createRandomTownMap = (
    width: number,
    height: number,
    options: CityGenerationOptions = {}
) => {
    const numRings = options.numRings ?? 3; // Fixed default ring depth to prevent layout overcrowding
    const sidesPerRing = options.sidesPerRing ?? 8;
    const positionJitter = options.positionJitter ?? 50;
    const edgeOmissionChance = options.edgeOmissionChance ?? 0.15;
    const maxRetries = options.maxRetries ?? 50;
    const internalSpawnCount = options.internalSpawnCount ?? 15;

    const centerX = width / 2;
    const centerY = height / 2;

    let attempts = 0;

    while (attempts < maxRetries) {
        attempts++;
        try {
            const rawNodes: Node[] = [];
            const rawEdges: Edge[] = [];

            const maxRadius = Math.min(centerX, centerY) * 0.85;
            const ringSpacing = maxRadius / numRings;

            // --- A: RINGS ---
            for (let ringIdx = 0; ringIdx < numRings; ringIdx++) {
                const currentRadius = (ringIdx + 1) * ringSpacing;
                const speedLimit = 30 + ringIdx * 15;
                const capacity = 20 + ringIdx * 20;
                const isClockwise = ringIdx % 2 === 0;

                for (let i = 0; i < sidesPerRing; i++) {
                    const baseAngle = (i * 2 * Math.PI) / sidesPerRing;
                    const angleJitter = (Math.random() - 0.5) * 0.15;
                    const finalAngle = baseAngle + angleJitter;
                    const finalRadius = currentRadius + (Math.random() - 0.5) * positionJitter;

                    const x = Math.max(20, Math.min(width - 20, centerX + Math.cos(finalAngle) * finalRadius));
                    const y = Math.max(20, Math.min(height - 20, centerY + Math.sin(finalAngle) * finalRadius));

                    rawNodes.push({ id: `node-r${ringIdx}-v${i}`, x, y, type: 'intersection' });
                }

                for (let i = 0; i < sidesPerRing; i++) {
                    const nextIdx = isClockwise ? (i + 1) % sidesPerRing : (i + sidesPerRing - 1) % sidesPerRing;
                    const sourceId = `node-r${ringIdx}-v${i}`;
                    const targetId = `node-r${ringIdx}-v${nextIdx}`;
                    const prefix = Math.abs(i - nextIdx) % 2 === 0 ? 'h-' : 'v-';

                    rawEdges.push({
                        id: `${prefix}ring-${ringIdx}-edge-${i}`,
                        sourceNodeId: sourceId,
                        targetNodeId: targetId,
                        speedLimit,
                        capacity,
                    });
                }
            }

            // --- B: INTER-RING RADIAL SPOKES ---
            for (let ringIdx = 0; ringIdx < numRings - 1; ringIdx++) {
                for (let i = 0; i < sidesPerRing; i++) {
                    const currentRingNodeId = `node-r${ringIdx}-v${i}`;
                    const nextRingNodeId = `node-r${ringIdx + 1}-v${i}`;

                    if (Math.random() > edgeOmissionChance) {
                        rawEdges.push({
                            id: `h-spoke-out-r${ringIdx}-v${i}`,
                            sourceNodeId: currentRingNodeId,
                            targetNodeId: nextRingNodeId,
                            speedLimit: 40,
                            capacity: 30,
                        });
                    }

                    if (Math.random() > edgeOmissionChance) {
                        rawEdges.push({
                            id: `v-spoke-in-r${ringIdx}-v${i}`,
                            sourceNodeId: nextRingNodeId,
                            targetNodeId: currentRingNodeId,
                            speedLimit: 40,
                            capacity: 30,
                        });
                    }
                }
            }

            // --- C: PERIMETER GATEWAYS ---
            const outerRingIdx = numRings - 1;
            const entrySides = [
                0,
                Math.floor(sidesPerRing / 4),
                Math.floor(sidesPerRing / 2),
                Math.floor((3 * sidesPerRing) / 4)
            ];

            [...new Set(entrySides)].forEach((sideIdx) => {
                const ringNodeId = `node-r${outerRingIdx}-v${sideIdx}`;
                const baseNode = rawNodes.find(n => n.id === ringNodeId)!;

                const dx = baseNode.x - centerX;
                const dy = baseNode.y - centerY;
                const length = Math.hypot(dx, dy);

                const edgeX = Math.max(10, Math.min(width - 10, centerX + (dx / length) * (width * 0.48)));
                const edgeY = Math.max(10, Math.min(height - 10, centerY + (dy / length) * (height * 0.48)));

                const entryId = `entry-side-${sideIdx}`;
                const exitId = `exit-side-${sideIdx}`;

                rawNodes.push({ id: entryId, x: edgeX - 15, y: edgeY - 15, type: 'entry' });
                rawNodes.push({ id: exitId, x: edgeX + 15, y: edgeY + 15, type: 'exit' });

                rawEdges.push({
                    id: `h-inbound-${sideIdx}`,
                    sourceNodeId: entryId,
                    targetNodeId: ringNodeId,
                    speedLimit: 80,
                    capacity: 60,
                });

                rawEdges.push({
                    id: `v-outbound-${sideIdx}`,
                    sourceNodeId: ringNodeId,
                    targetNodeId: exitId,
                    speedLimit: 80,
                    capacity: 60,
                });
            });

            // --- C.2: INTERNAL SPAWN POINTS (DRIVEWAYS/PARKING LOTS) ---
            const innerIntersections = rawNodes.filter(n => n.type === 'intersection');

            for (let i = 0; i < internalSpawnCount; i++) {
                if (innerIntersections.length === 0) break;

                const targetNode = innerIntersections[Math.floor(Math.random() * innerIntersections.length)];
                const spawnId = `internal-spawn-${i}`;

                const spawnX = targetNode.x + (Math.random() > 0.5 ? 25 : -25);
                const spawnY = targetNode.y + (Math.random() > 0.5 ? 25 : -25);

                rawNodes.push({
                    id: spawnId,
                    x: spawnX,
                    y: spawnY,
                    type: 'entry'
                });

                rawEdges.push({
                    id: `edge-spawn-to-${targetNode.id}-${i}`,
                    sourceNodeId: spawnId,
                    targetNodeId: targetNode.id,
                    speedLimit: 30,
                    capacity: 20,
                });
            }

            // --- D: COMPILE & VALIDATE ---
            const compiled = compileGraph(rawNodes, rawEdges, TOPOLOGY_CONFIG);
            validateTopology(compiled.nodes, compiled.edges);

            // Fix: Call applyRealisticTrafficLights instead of the old function name, initialization phase = 0s
            return {
                nodes: compiled.nodes,
                edges: applyRealisticTrafficLights(
                    compiled.edges,
                    0
                ),
                entryNodeIds: compiled.nodes.filter((n) => n.type === 'entry').map((n) => n.id),
                exitNodeIds: compiled.nodes.filter((n) => n.type === 'exit').map((n) => n.id),
                width,
                height,
            };

        } catch (error) {
            console.warn(`Generation attempt ${attempts} rejected: ${(error as Error).message}. Retrying...`);
        }
    }

    throw new Error(`Failed to generate a valid topology after ${maxRetries} attempts.`);
};

// Backward compatibility
export const createTownMap = createRandomTownMap;