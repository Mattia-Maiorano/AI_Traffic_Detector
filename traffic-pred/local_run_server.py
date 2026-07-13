import json
import os
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler

# Import AWS Lambda handler to reuse the feature extraction & prediction logic
sys.path.append(os.path.join(os.path.dirname(__file__), 'aws'))
import app

# GNN Import & Init
try:
    import torch
    from train_gnn import TrafficGNN, parse_flow_dir, build_adjacency_matrix
    
    MODEL_GNN_PATH = os.path.join(os.path.dirname(__file__), 'models/model_gnn.pt')
    SCALER_PATH = os.path.join(os.path.dirname(__file__), 'models/scaler.pt')
    gnn_model = None
    scaler = None
    if os.path.exists(MODEL_GNN_PATH):
        # ALIGNED: 12 input features, 256 hidden dim (matching train_gnn), 4 classes
        gnn_model = TrafficGNN(in_features=12, hidden_dim=256, num_classes=4)
        gnn_model.load_state_dict(torch.load(MODEL_GNN_PATH, map_location=torch.device('cpu'), weights_only=True))
        gnn_model.eval()
        print("Loaded local GNN model successfully!")
        
        if os.path.exists(SCALER_PATH):
            scaler = torch.load(SCALER_PATH, map_location=torch.device('cpu'), weights_only=False)
            print("Loaded local GNN feature scaler successfully!")
except Exception as e:
    print(f"Warning: Could not initialize GNN predictor: {e}")
    gnn_model = None
    scaler = None

class PredictionServerHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        # Handle CORS preflight requests
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_POST(self):
        if self.path == '/predict':
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            
            try:
                event = json.loads(post_data.decode('utf-8'))
                result = app.handler(event, None)
                
                self.send_response(result.get('statusCode', 200))
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(result.get('body', '{}').encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode('utf-8'))
        elif self.path == '/predict-gnn':
            if gnn_model is None:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'error': 'GNN model not loaded or trained.'}).encode('utf-8'))
                return

            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            
            try:
                payload = json.loads(post_data.decode('utf-8'))
                snapshots = payload.get('snapshots', [])
                if not snapshots:
                    raise ValueError("No snapshots provided")
                # Sequence check restriction removed to handle dynamic sequence footprints organically.
                # if len(snapshots) != 5:
                #     raise ValueError(f"Expected exactly 5 snapshots, got {len(snapshots)}")
                
                latest_snapshot = snapshots[-1]
                latest_edges = latest_snapshot.get('edges', [])
                if not latest_edges:
                    raise ValueError("No edges in the latest snapshot")
                
                adj = build_adjacency_matrix(latest_edges)
                
                x_seq = []
                for snap in snapshots:
                    x_list = []
                    edges = snap.get('edges', [])
                    if not edges:
                        raise ValueError("Snapshot must contain edges")
                    for edge in edges:
                        flow_features = parse_flow_dir(edge.get('flowDirection', 'E'))
                        feats = [
                            edge.get('count', 0),
                            edge.get('edgeCapacity', 40),
                            edge.get('edgeDensity', 0.0),
                            edge.get('speedLimit', 50),
                            edge.get('trafficLightState', 1),
                            edge.get('phaseTimeRemaining', 5.0),
                            edge.get('spawnWeight', 1),
                            edge.get('horizonTime', 5.0)
                        ] + flow_features
                        x_list.append(feats)
                    x_seq.append(x_list)
                    
                x_tensor = torch.tensor(x_seq, dtype=torch.float32) # Shape: [Seq, num_edges, 12]
                if scaler is not None:
                    # Scale the input features identically to the training logic
                    mean_t = scaler['mean']
                    std_t = scaler['std']
                    x_tensor = (x_tensor - mean_t) / std_t
                
                # --- Batch Dimension Handler: Make it 4D [Batch, Seq, Nodes, Features] -> [1, Seq, num_edges, 12] ---
                x_tensor = x_tensor.unsqueeze(0)
                
                with torch.no_grad():
                    out = gnn_model(x_tensor, adj)
                    # --- Extract index 0 to drop the batch dimension wrapper during inference ---
                    preds = torch.argmax(out[0], dim=1).numpy()
                    
                status_mapping = {
                    0: "Libero",
                    1: "Rallentato",
                    2: "Congestionato",
                    3: "Bloccato",
                }
                
                predictions = []
                for idx, edge in enumerate(latest_edges):
                    pred_code = int(preds[idx])
                    predictions.append({
                        "edgeId": edge['edgeId'],
                        "predicted_status_code": pred_code,
                        "predicted_status": status_mapping.get(pred_code, "Libero")
                    })
                
                response_body = {
                    "timestamp": latest_snapshot.get('time', ''),
                    "predictions": predictions
                }
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps(response_body).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode('utf-8'))
        else:
            self.send_response(404)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()

def run(port=5001):
    server_address = ('', port)
    httpd = HTTPServer(server_address, PredictionServerHandler)
    print(f"Starting local TrafficPredictor model server on port {port}...")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping model server...")
        httpd.server_close()

if __name__ == '__main__':
    run()