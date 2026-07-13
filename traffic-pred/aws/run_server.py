import json
import os
import sys

# Removed broken 'import app' statements

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

def process_gnn_prediction(payload):
    """Encapsulates the exact mathematical transformation and GNN inference logic."""
    if gnn_model is None:
        return {"statusCode": 500, "body": json.dumps({'error': 'GNN model not loaded or trained.'})}

    snapshots = payload.get('snapshots', [])
    if not snapshots:
        raise ValueError("No snapshots provided")
        
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
        
    x_tensor = torch.tensor(x_seq, dtype=torch.float32)
    if scaler is not None:
        mean_t = scaler['mean']
        std_t = scaler['std']
        x_tensor = (x_tensor - mean_t) / std_t
    
    x_tensor = x_tensor.unsqueeze(0)
    
    with torch.no_grad():
        out = gnn_model(x_tensor, adj)
        preds = torch.argmax(out[0], dim=1).numpy()
        
    status_mapping = {0: "Libero", 1: "Rallentato", 2: "Congestionato", 3: "Bloccato"}
    
    predictions = []
    for idx, edge in enumerate(latest_edges):
        pred_code = int(preds[idx])
        predictions.append({
            "edgeId": edge['edgeId'],
            "predicted_status_code": pred_code,
            "predicted_status": status_mapping.get(pred_code, "Libero")
        })
    
    return {
        "statusCode": 200,
        "body": json.dumps({
            "timestamp": latest_snapshot.get('time', ''),
            "predictions": predictions
        })
    }

# =========================================================
# AWS LAMBDA ENTRYPOINT HANDLER
# =========================================================
def lambda_handler(event, context):
    """Processes incoming proxy events directly from AWS API Gateway."""
    try:
        # Parse body depending on if it arrives as a string or raw dict
        body_raw = event.get('body', '{}')
        if isinstance(body_raw, str):
            payload = json.loads(body_raw)
        else:
            payload = body_raw
            
        # Run prediction
        response = process_gnn_prediction(payload)
        
        # Add required CORS headers for AWS API Gateway Proxy outputs
        response["headers"] = {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, GET, OPTIONS"
        }
        return response
    except Exception as e:
        return {
            "statusCode": 500,
            "headers": {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"},
            "body": json.dumps({'error': str(e)})
        }