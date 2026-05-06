import type { Edge, Node } from './types'

export const applyTrafficLights = (edges: Edge[], phase: 0 | 1): Edge[] => {
    return edges.map((edge) => {
        // h- = Horizontal (Phase 0), v- = Vertical (Phase 1)
        const isHorizontal = edge.id.startsWith('h-');
        const edgeParity = isHorizontal ? 0 : 1;
        return {
            ...edge,
            trafficLight: edgeParity === phase ? 'green' : 'red'
        };
    });
};

export const createTownMap = (width: number, height: number) => {
    const nodes: Node[] = [
        // Perimeter Spoke Nodes[cite: 1, 4]
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
    ];

    const edges: Edge[] = [
        // --- IN-ROUTES (Radial Inward) ---[cite: 4]
        { id: 'v-in-n', sourceNodeId: 'entry-n', targetNodeId: 'b-ne', speedLimit: 80, capacity: 50 },
        { id: 'v-in-s', sourceNodeId: 'entry-s', targetNodeId: 'b-sw', speedLimit: 80, capacity: 50 },
        { id: 'h-in-w', sourceNodeId: 'entry-w', targetNodeId: 'b-nw', speedLimit: 80, capacity: 50 },
        { id: 'h-in-e', sourceNodeId: 'entry-e', targetNodeId: 'b-se', speedLimit: 80, capacity: 50 },

        // --- BYPASS RING (Clockwise) ---[cite: 1, 4]
        { id: 'h-b-nw-ne', sourceNodeId: 'b-nw', targetNodeId: 'b-ne', speedLimit: 60, capacity: 70 },
        { id: 'v-b-ne-se', sourceNodeId: 'b-ne', targetNodeId: 'b-se', speedLimit: 60, capacity: 70 },
        { id: 'h-b-se-sw', sourceNodeId: 'b-se', targetNodeId: 'b-sw', speedLimit: 60, capacity: 70 },
        { id: 'v-b-sw-nw', sourceNodeId: 'b-sw', targetNodeId: 'b-nw', speedLimit: 60, capacity: 70 },

        // --- INWARD CORE SPOKES ---[cite: 4]
        { id: 'v-b-nw-cnw', sourceNodeId: 'b-nw', targetNodeId: 'c-nw', speedLimit: 40, capacity: 40 },
        { id: 'h-b-ne-cne', sourceNodeId: 'b-ne', targetNodeId: 'c-ne', speedLimit: 40, capacity: 40 },
        { id: 'h-b-sw-csw', sourceNodeId: 'b-sw', targetNodeId: 'c-sw', speedLimit: 40, capacity: 40 },
        { id: 'v-b-se-cse', sourceNodeId: 'b-se', targetNodeId: 'c-se', speedLimit: 40, capacity: 40 },

        // --- CENTRAL CORE (Counter-Clockwise Loop) ---[cite: 1, 4]
        { id: 'v-c-nw-sw', sourceNodeId: 'c-nw', targetNodeId: 'c-sw', speedLimit: 30, capacity: 10 },
        { id: 'h-c-sw-se', sourceNodeId: 'c-sw', targetNodeId: 'c-se', speedLimit: 30, capacity: 10 },
        { id: 'v-c-se-ne', sourceNodeId: 'c-se', targetNodeId: 'c-ne', speedLimit: 30, capacity: 10 },
        { id: 'h-c-ne-nw', sourceNodeId: 'c-ne', targetNodeId: 'c-nw', speedLimit: 30, capacity: 10 },

        // --- OUTWARD CORE SPOKES (The Escape Hatches) ---[cite: 1, 4]
        // These allow cars to move from the inner loop back to the bypass ring
        { id: 'h-c-nw-bnw', sourceNodeId: 'c-nw', targetNodeId: 'b-nw', speedLimit: 40, capacity: 40 },
        { id: 'v-c-ne-bne', sourceNodeId: 'c-ne', targetNodeId: 'b-ne', speedLimit: 40, capacity: 40 },
        { id: 'v-c-sw-bsw', sourceNodeId: 'c-sw', targetNodeId: 'b-sw', speedLimit: 40, capacity: 40 },
        { id: 'h-c-se-bse', sourceNodeId: 'c-se', targetNodeId: 'b-se', speedLimit: 40, capacity: 40 },

        // --- OUT-ROUTES (Radial Outward) ---[cite: 1, 4]
        { id: 'v-out-n', sourceNodeId: 'b-ne', targetNodeId: 'exit-n', speedLimit: 70, capacity: 50 },
        { id: 'v-out-s', sourceNodeId: 'b-sw', targetNodeId: 'exit-s', speedLimit: 70, capacity: 50 },
        { id: 'h-out-w', sourceNodeId: 'b-nw', targetNodeId: 'exit-w', speedLimit: 70, capacity: 50 },
        { id: 'h-out-e', sourceNodeId: 'b-se', targetNodeId: 'exit-e', speedLimit: 70, capacity: 50 },
    ];

    return {
        nodes,
        edges: applyTrafficLights(edges, 0),
        entryNodeIds: nodes.filter(n => n.type === 'entry').map(n => n.id),
        exitNodeIds: nodes.filter(n => n.type === 'exit').map(n => n.id),
        width,
        height,
    };
};