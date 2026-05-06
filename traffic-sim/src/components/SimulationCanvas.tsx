import { useEffect, useRef } from 'react'
import type { Edge, Node } from '../simulation/types'
import { useSimulationStore } from '../simulation/store'

type EdgeRender = {
    id: string
    x1: number
    y1: number
    x2: number
    y2: number
    length: number
    dx: number
    dy: number
}

const buildEdgeRender = (nodes: Node[], edges: Edge[]) => {
    const nodeById = new Map(nodes.map((node) => [node.id, node]))
    const edgeRenderById = new Map<string, EdgeRender>()

    edges.forEach((edge) => {
        const source = nodeById.get(edge.sourceNodeId)
        const target = nodeById.get(edge.targetNodeId)
        if (!source || !target) {
            return
        }
        const dx = target.x - source.x
        const dy = target.y - source.y
        const length = Math.hypot(dx, dy)
        edgeRenderById.set(edge.id, {
            id: edge.id,
            x1: source.x,
            y1: source.y,
            x2: target.x,
            y2: target.y,
            dx,
            dy,
            length,
        })
    })

    return edgeRenderById
}

export const SimulationCanvas = () => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const renderMetaRef = useRef<Map<string, EdgeRender> | null>(null)
    const canvasWidth = useSimulationStore((state) => state.canvasWidth)
    const canvasHeight = useSimulationStore((state) => state.canvasHeight)

    useEffect(() => {
        const state = useSimulationStore.getState()
        renderMetaRef.current = buildEdgeRender(state.nodes, state.edges)
    }, [])

    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return

        const dpr = window.devicePixelRatio || 1
        canvas.width = canvasWidth * dpr
        canvas.height = canvasHeight * dpr
        canvas.style.width = '100%'
        canvas.style.height = 'auto'

        const ctx = canvas.getContext('2d')
        if (!ctx) return

        let frameId = 0

        const draw = () => {
            const meta = renderMetaRef.current
            if (!meta) {
                frameId = requestAnimationFrame(draw)
                return
            }

            // 1. Get current snapshot of the world
            const { cars, edges } = useSimulationStore.getState()

            // 2. Map cars to their edges for fast density calculation
            const carCounts = new Map<string, number>()
            cars.forEach(car => {
                carCounts.set(car.edgeId, (carCounts.get(car.edgeId) || 0) + 1)
            })

            ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
            ctx.clearRect(0, 0, canvasWidth, canvasHeight)

            // 3. Draw Edges with Heatmap Logic
            ctx.lineWidth = 3.0 // Thicker lines help visualize the heatmap

            edges.forEach((edgeData) => {
                const renderEdge = meta.get(edgeData.id)
                if (!renderEdge) return

                const count = carCounts.get(edgeData.id) || 0

                /**
                 * DENSITY CALCULATION
                 * We use the capacity property defined in map.ts/types.ts
                 */
                const density = Math.min(count / edgeData.capacity, 1)

                /**
                 * COLOR MAPPING (HSL)
                 * Hue: 120 (Green) -> 0 (Red)
                 * Formula: $Hue = 120 \times (1 - Density)$
                 */
                const hue = 120 * (1 - density)
                ctx.strokeStyle = `hsl(${hue}, 80%, 45%)`

                // Draw individual segment
                ctx.beginPath()
                ctx.moveTo(renderEdge.x1, renderEdge.y1)
                ctx.lineTo(renderEdge.x2, renderEdge.y2)
                ctx.stroke()
            })

            // 4. Draw Cars (the "dots")[cite: 8]
            ctx.fillStyle = '#1e293b' // Darker color for contrast against heatmap
            cars.forEach((car) => {
                const edge = meta.get(car.edgeId)
                if (!edge || edge.length === 0) return

                const t = Math.min(car.distanceAlongEdge / edge.length, 1)
                const x = edge.x1 + edge.dx * t
                const y = edge.y1 + edge.dy * t

                ctx.beginPath()
                ctx.arc(x, y, 3.8, 0, Math.PI * 2)
                ctx.fill()
            })

            frameId = requestAnimationFrame(draw)
        }

        frameId = requestAnimationFrame(draw)
        return () => cancelAnimationFrame(frameId)
    }, [canvasHeight, canvasWidth])

    return (
        <canvas
            ref={canvasRef}
            aria-label="Traffic simulation canvas"
        />
    )
}