import json
import joblib
import pandas as pd
import os
from collections import Counter

# Caricamento del modello a livello globale.
# Questo è vitale per le performance: viene eseguito solo al "Cold Start".
# Nei "Warm Start" successivi, il modello è già in memoria RAM!
# CORRETTO: Cerca il modello nella stessa cartella di app.py
MODEL_PATH = os.path.join(os.path.dirname(__file__), 'model_rf.joblib')
model = joblib.load(MODEL_PATH)

# Il training costruisce 4 classi a partire da edgeDensity:
# 0 -> bassa densità, 3 -> densità molto alta.
status_mapping = {
    0: "Libero",
    1: "Rallentato",
    2: "Congestionato",
    3: "Bloccato",
}

MODEL_FEATURES = ['count', 'edgeCapacity', 'edgeDensity']


def _extract_snapshot(payload):
    """Accept either a raw snapshot or a wrapper produced by API Gateway."""
    if isinstance(payload, dict):
        if 'edges' in payload:
            return payload

        for key in ('snapshot', 'data', 'body'):
            nested = payload.get(key)
            if isinstance(nested, dict) and 'edges' in nested:
                return nested

    raise ValueError('Input non valido: atteso uno snapshot con chiave "edges".')


def _safe_float(value, default=None):
    try:
        if value is None:
            return default
        return float(value)
    except Exception:
        return default


def snapshot_to_dataframe(snapshot):
    """Convert a traffic snapshot into the exact training features."""
    edge_records = snapshot.get('edges', []) or []
    cars = snapshot.get('cars', []) or []

    car_counts = Counter()
    for car in cars:
        edge_id = car.get('edgeId')
        if edge_id:
            car_counts[edge_id] += 1

    edge_map = {}
    edge_order = []
    for edge in edge_records:
        edge_id = edge.get('edgeId')
        if not edge_id:
            continue
        edge_map[edge_id] = edge
        edge_order.append(edge_id)

    for edge_id in car_counts:
        if edge_id not in edge_map:
            edge_map[edge_id] = {'edgeId': edge_id}
            edge_order.append(edge_id)

    rows = []
    for edge_id in edge_order:
        edge = edge_map[edge_id]

        raw_count = edge.get('carCount', edge.get('count'))
        count = _safe_float(raw_count, None)
        if count is None:
            count = float(car_counts.get(edge_id, 0))

        raw_capacity = edge.get('edgeCapacity', 50)
        edge_capacity = _safe_float(raw_capacity, 50.0)
        if edge_capacity is None or edge_capacity <= 0:
            edge_capacity = 50.0

        raw_density = edge.get('edgeDensity')
        edge_density = _safe_float(raw_density, None)
        if edge_density is None:
            edge_density = float(count) / edge_capacity if edge_capacity > 0 else 0.0

        rows.append(
            {
                'edgeId': edge_id,
                'count': int(round(count)),
                'edgeCapacity': float(edge_capacity),
                'edgeDensity': float(edge_density),
            }
        )

    if not rows:
        raise ValueError('Snapshot senza edge validi.')

    return pd.DataFrame(rows)

def handler(event, context):
    try:
        if isinstance(event, dict) and 'body' in event:
            body = event['body']
            if isinstance(body, str):
                body = json.loads(body)
        else:
            body = event

        snapshot = _extract_snapshot(body)

        # Creazione del DataFrame con le stesse feature usate in training.
        df = snapshot_to_dataframe(snapshot)
        X = df[MODEL_FEATURES]

        # Esecuzione predizione
        predictions = model.predict(X)
        df['predicted_status_code'] = predictions
        df['predicted_status'] = df['predicted_status_code'].map(status_mapping)

        # Formattazione risultato: una previsione per ogni edge dello snapshot.
        risultato = df[
            [
                'edgeId',
                'predicted_status_code',
                'predicted_status',
            ]
        ].to_dict(orient='records')

        return {
            "statusCode": 200,
            "headers": {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*" # Fondamentale per far comunicare React
            },
            "body": json.dumps({
                "timestamp": snapshot.get('time', body.get('timestamp', '')),
                "predictions": risultato
            })
        }

    except json.JSONDecodeError:
        return {
            "statusCode": 400,
            "body": json.dumps({"error": "Body JSON non valido"})
        }

    except Exception as e:
        return {
            "statusCode": 500,
            "body": json.dumps({"error": str(e)})
        }
    
if __name__ == "__main__":
    # Test locale con un file di esempio.
    with open('processed_test/Session 6x/Traffic Snapshot (81).json', 'r') as f:
        sample_event = json.load(f)
    response = handler(sample_event, None)
    print(json.dumps(response['body'], indent=2))