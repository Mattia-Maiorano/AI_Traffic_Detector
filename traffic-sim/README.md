# 2D Traffic Simulator

Canvas-driven traffic simulation for generating synthetic congestion ground truth.

## Highlights
- 24x24 directed grid map with perimeter entry/exit nodes randomized 50/50 at startup
- IDM-inspired acceleration, look-ahead braking, and safe following distance logic
- Checkerboard traffic lights toggle every 5 seconds and block red intersections
- Canvas-only rendering of roads and cars for high performance
- Play/Pause/Reset controls, spawn rate slider, and JSON snapshot export

## Development
1. Install dependencies
   - `npm install`
2. Start the dev server
   - `npm run dev`
3. Production build
   - `npm run build`
4. Preview production build
   - `npm run preview`

## Export Format
The export button downloads a JSON snapshot:

```json
{
  "cars": [
      { "id": "car-0", "edgeId": "e-r0c0-r0c1", "distanceAlongEdge": 12.5 }
  ],
  "edges": [
    { "edgeId": "e-r0c0-r0c1", "carCount": 1 }
  ]
}
```
