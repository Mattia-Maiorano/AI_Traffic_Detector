from pathlib import Path
import json
import argparse
import pandas as pd
import joblib
import torch
from torch import nn
from torch.utils.data import DataLoader, TensorDataset
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, f1_score


def extract_snapshot_objects(payload):
    if isinstance(payload, dict) and 'edges' in payload:
        yield payload
        return

    if isinstance(payload, list):
        for item in payload:
            if isinstance(item, dict) and 'edges' in item:
                yield item


def density_to_edge_color(edge_density):

    if 0 <= edge_density < 0.25:
        return 0
    if 0.25 <= edge_density < 0.5:
        return 1
    if 0.5 <= edge_density < 0.75:
        return 2
    if 0.75 <= edge_density < 1:
        return 3
    if edge_density >= 1:
        return 3
    return None


def load_snapshot_sessions(path: Path):
    """Load simulator snapshots grouped by session.

    Accepts either a directory with nested session folders or a single file
    (JSON or JSONL). Returns a mapping of session IDs to sorted lists of
    (simTime, sourceName, sourceIndex, snapshot_object) tuples.
    """
    path = Path(path)
    sessions = {}

    def extract_sim_time(snapshot_obj, default_time):
        """Extract a timestamp from the snapshot.

        Looks for `simTime` (legacy) or `time` (exported snapshots). Falls
        back to the progressive index when missing.
        """
        if not isinstance(snapshot_obj, dict):
            return default_time
        # prefer explicit simTime, otherwise accept 'time' field
        sim_time = snapshot_obj.get('simTime')
        if sim_time is None:
            sim_time = snapshot_obj.get('time')
        # coerce numeric-like strings to numbers when possible
        try:
            if sim_time is not None:
                return float(sim_time)
        except Exception:
            pass
        return default_time

    def add_session_snapshot(session_id, snapshot_obj, default_time, source_name, source_index):
        sessions.setdefault(session_id, []).append(
            (
                extract_sim_time(snapshot_obj, default_time),
                source_name,
                source_index,
                snapshot_obj,
            )
        )

    print(f'Loading snapshots from {path}...')
    # Read snapshots from a directory of JSON files or from a JSONL/single JSON file.
    if path.is_dir():
        files = sorted([p for p in path.rglob('*.json') if p.is_file()])
        for p in files:
            try:
                with p.open('r') as fh:
                    payload = json.load(fh)
            except Exception:
                continue

            try:
                session_id = str(p.parent.relative_to(path))
            except Exception:
                session_id = str(p.parent.name)
            if session_id == '.':
                session_id = path.name

            for idx, snapshot_obj in enumerate(extract_snapshot_objects(payload)):
                add_session_snapshot(session_id, snapshot_obj, idx, p.name, idx)
    else:
        with path.open('r') as fh:
            raw_text = fh.read().strip()

            if not raw_text:
                raise RuntimeError(f'Empty snapshot file: {path}')

            # 1) Try full JSON parsing first (works with pretty-printed single snapshot files).
            try:
                obj = json.loads(raw_text)
            except Exception:
                obj = None

            session_id = path.stem
            if obj is not None:
                snapshots = list(extract_snapshot_objects(obj))
                for idx, snapshot_obj in enumerate(snapshots):
                    add_session_snapshot(session_id, snapshot_obj, idx, path.name, idx)
            else:
                # 2) Fallback: treat content as JSONL.
                for idx, line in enumerate(raw_text.splitlines()):
                    if not line.strip():
                        continue
                    try:
                        snapshot_obj = json.loads(line)
                        if isinstance(snapshot_obj, dict) and 'edges' in snapshot_obj:
                            add_session_snapshot(session_id, snapshot_obj, idx, path.name, idx)
                    except Exception:
                        continue

                if session_id not in sessions:
                    raise RuntimeError(f'Unable to parse snapshots from {path}')

    if not sessions:
        raise RuntimeError(f'No valid snapshots found in {path}')

    for session_id in sessions:
        sessions[session_id].sort(key=lambda item: (item[0], item[1], item[2]))

    total_snapshots = sum(len(items) for items in sessions.values())
    print(f'Loaded {total_snapshots} snapshots across {len(sessions)} sessions')
    return sessions


def session_snapshots_to_dense_df(session_id, snapshots, all_edge_ids, edge_capacity_by_id):
    """Convert a single session's snapshots into a dense DataFrame."""

    def summarize_cars_by_edge(snapshot_obj):
        """Aggregate car positions in the snapshot by edgeId."""
        grouped = {}
        for car in snapshot_obj.get('cars', []):
            eid = car.get('edgeId')
            if not eid:
                continue
            distance = car.get('distanceAlongEdge')
            if distance is None:
                continue
            try:
                distance_value = float(distance)
            except Exception:
                continue
            grouped.setdefault(eid, []).append(distance_value)

        summary = {}
        for eid, distances in grouped.items():
            distances_sorted = sorted(distances)
            total = len(distances_sorted)
            mean_distance = sum(distances_sorted) / total
            variance = sum((value - mean_distance) ** 2 for value in distances_sorted) / total
            summary[eid] = {
                'avgDistanceAlongEdge': mean_distance,
                'minDistanceAlongEdge': distances_sorted[0],
                'maxDistanceAlongEdge': distances_sorted[-1],
                'stdDistanceAlongEdge': variance ** 0.5,
            }
        return summary

    # build dense rows: for each time and each edge, record the state of that
    # edge in the current snapshot plus the aggregated cars on that edge.
    rows = []
    for snapshot_record in snapshots:
        if len(snapshot_record) == 4:
            t, _, _, s = snapshot_record
        elif len(snapshot_record) == 2:
            t, s = snapshot_record
        else:
            raise ValueError(
                'Unexpected snapshot record format. Expected 2 or 4 values, '
                f'got {len(snapshot_record)}.'
            )
        edge_map = {e.get('edgeId'): e for e in s.get('edges', [])}
        cars_summary = summarize_cars_by_edge(s)
        for eid in all_edge_ids:
            e = edge_map.get(eid, {})
            count = e.get('carCount', e.get('count', 0)) or 0
            raw_capacity = e.get('edgeCapacity', edge_capacity_by_id.get(eid, 50))
            try:
                edge_capacity = float(raw_capacity)
            except Exception:
                edge_capacity = 50.0
            if edge_capacity <= 0:
                edge_capacity = 50.0

            raw_density = e.get('edgeDensity')
            if raw_density is None:
                edge_density = float(count) / edge_capacity
            else:
                try:
                    edge_density = float(raw_density)
                except Exception:
                    edge_density = float(count) / edge_capacity

            raw_color = e.get('edgeColor')
            edge_color = None
            try:
                if raw_color is not None:
                    edge_color = int(raw_color)
            except Exception:
                edge_color = None
            if edge_color is None:
                edge_color = density_to_edge_color(edge_density)

            car_stats = cars_summary.get(
                eid,
                {
                    'avgDistanceAlongEdge': 0.0,
                    'minDistanceAlongEdge': 0.0,
                    'maxDistanceAlongEdge': 0.0,
                    'stdDistanceAlongEdge': 0.0,
                },
            )

            rows.append(
                {
                    'sessionId': session_id,
                    'simTime': t,
                    'edgeId': eid,
                    'count': int(count),
                    'edgeCapacity': edge_capacity,
                    'edgeDensity': edge_density,
                    'edgeColor': edge_color,
                    'avgDistanceAlongEdge': float(car_stats['avgDistanceAlongEdge']),
                    'minDistanceAlongEdge': float(car_stats['minDistanceAlongEdge']),
                    'maxDistanceAlongEdge': float(car_stats['maxDistanceAlongEdge']),
                    'stdDistanceAlongEdge': float(car_stats['stdDistanceAlongEdge']),
                }
            )

    return pd.DataFrame(rows)


def load_snapshots(path: Path):
    """Load simulator snapshots into a dense DataFrame.

    This keeps the old single-DataFrame behavior by flattening all sessions,
    but adds a sessionId column so downstream code can split per session.
    """
    sessions = load_snapshot_sessions(path)

    dfs = []
    for session_id, snapshots in sessions.items():
        all_edge_ids = set()
        edge_capacity_by_id = {}
        for _, _, _, snapshot_obj in snapshots:
            for edge in snapshot_obj.get('edges', []):
                edge_id = edge.get('edgeId')
                if edge_id:
                    all_edge_ids.add(edge_id)
                    capacity = edge.get('edgeCapacity')
                    if capacity is not None:
                        try:
                            capacity_value = float(capacity)
                        except Exception:
                            capacity_value = None
                        if capacity_value is not None and capacity_value > 0:
                            edge_capacity_by_id[edge_id] = capacity_value

        dense_df = session_snapshots_to_dense_df(
            session_id,
            [(sim_time, snapshot_obj) for sim_time, _, _, snapshot_obj in snapshots],
            sorted(all_edge_ids),
            edge_capacity_by_id,
        )
        dfs.append(dense_df)

    if not dfs:
        raise RuntimeError(f'No valid snapshots found in {path}')

    df = pd.concat(dfs, ignore_index=True)
    print(f'Loaded dense dataset with {len(df)} rows')
    return df


def build_features(df: pd.DataFrame, H=1):
    """Build features/targets for model training.

    For each (edge, time) the function uses only the current snapshot state of
    that edge. It constructs features from the edge itself:
    - count
    - edgeCapacity
    - edgeDensity
    - avg/min/max/std distance of cars on the edge

    Each training row represents the state of ONE edge only, so the model
    input does not contain values from other edges.

    The target is edgeColor at t+H (future horizon). Returns numpy arrays
    (X, y, times) where X has shape (n_samples, n_features), y has shape
    (n_samples,) and times contains the timestamp for each row.

    The `K` argument is kept for compatibility but is not used because the
    model is fed the current state only.
    """
    if 'sessionId' not in df.columns:
        df = df.copy()
        df['sessionId'] = '__default__'

    dfs = []
    for (session_id, edge), sub in df.groupby(['sessionId', 'edgeId'], sort=False):
        sub = sub.sort_values('simTime').set_index('simTime')

        # Compute a robust capacity column to avoid division by zero.
        if 'edgeCapacity' in sub.columns:
            sub['edgeCapacity'] = pd.to_numeric(sub['edgeCapacity'], errors='coerce')
            edge_cap_default = sub['edgeCapacity'].dropna().median()
            if pd.isna(edge_cap_default) or edge_cap_default <= 0:
                edge_cap_default = 50.0
            sub['edgeCapacity'] = sub['edgeCapacity'].fillna(edge_cap_default)
            sub.loc[sub['edgeCapacity'] <= 0, 'edgeCapacity'] = edge_cap_default
        sub['density'] = pd.to_numeric(sub['edgeDensity'], errors='coerce')
        if 'edgeColor' in sub.columns:
            sub['edgeColor'] = pd.to_numeric(sub['edgeColor'], errors='coerce')
        else:
            sub['edgeColor'] = sub['density'].map(density_to_edge_color)

        sub['cap'] = sub['edgeCapacity']
        sub['target'] = sub['edgeColor'].shift(-H)
        sub['edgeId'] = edge
        sub['sessionId'] = session_id
        dfs.append(sub.reset_index())

    allf = pd.concat(dfs, ignore_index=True)
    # drop rows with NaN in target
    feats = [
        'count',
        'edgeCapacity',
        'edgeDensity',
    ]
    allf = allf.dropna(subset=feats + ['target'])

    if allf.empty:
        raise RuntimeError(
            'No training rows available after feature building. '
        )

    X = allf[feats].values
    y = allf['target'].astype(int).values
    times = allf['simTime'].values
    return X, y, times


def split_session_snapshots(session_snapshots, train_ratio=0.8):
    """Split each session independently into train and test snapshot lists."""
    train_sessions = {}
    test_sessions = {}

    for session_id, snapshots in session_snapshots.items():
        if len(snapshots) < 2:
            train_sessions[session_id] = snapshots
            test_sessions[session_id] = []
            continue

        split_index = int(len(snapshots) * train_ratio)
        split_index = max(1, min(split_index, len(snapshots) - 1))
        train_sessions[session_id] = snapshots[:split_index]
        test_sessions[session_id] = snapshots[split_index:]

    return train_sessions, test_sessions


class TabularRNNRegressor(nn.Module):
    def __init__(self, input_size: int, hidden_size: int = 64, num_layers: int = 1):
        super().__init__()
        self.rnn = nn.RNN(
            input_size=input_size,
            hidden_size=hidden_size,
            num_layers=num_layers,
            batch_first=True,
        )
        self.head = nn.Linear(hidden_size, 4)

    def forward(self, x):
        output, _ = self.rnn(x)
        last_state = output[:, -1, :]
        return self.head(last_state)


def train_rnn_model(
    X_train,
    y_train,
    X_test,
    y_test,
    *,
    hidden_size=64,
    num_layers=1,
    epochs=50,
    batch_size=64,
    lr=1e-3,
):
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    torch.manual_seed(42)

    X_train_tensor = torch.tensor(X_train, dtype=torch.float32).unsqueeze(1)
    y_train_tensor = torch.tensor(y_train, dtype=torch.long)
    train_loader = DataLoader(
        TensorDataset(X_train_tensor, y_train_tensor),
        batch_size=batch_size,
        shuffle=True,
    )

    model = TabularRNNRegressor(
        input_size=X_train.shape[1],
        hidden_size=hidden_size,
        num_layers=num_layers,
    ).to(device)
    optimizer = torch.optim.Adam(model.parameters(), lr=lr)
    criterion = nn.CrossEntropyLoss()

    model.train()
    for _ in range(epochs):
        for batch_x, batch_y in train_loader:
            batch_x = batch_x.to(device)
            batch_y = batch_y.to(device)
            optimizer.zero_grad()
            predictions = model(batch_x)
            loss = criterion(predictions, batch_y)
            loss.backward()
            optimizer.step()

    model.eval()
    with torch.no_grad():
        X_test_tensor = torch.tensor(X_test, dtype=torch.float32).unsqueeze(1).to(device)
        preds = model(X_test_tensor).argmax(dim=1).cpu().numpy()

    return model, preds


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data', required=True, help='Path to snapshots.jsonl')
    parser.add_argument('--out-model', required=True, help='Path to save trained model')
    parser.add_argument(
        '--model',
        choices=['rf', 'rnn'],
        default='rf',
        help='Model to train',
    )
    parser.add_argument('--H', type=int, default=1, help='Prediction horizon (steps)')
    parser.add_argument('--rnn-hidden-size', type=int, default=32)
    parser.add_argument('--rnn-layers', type=int, default=1)
    parser.add_argument('--rnn-epochs', type=int, default=50)
    parser.add_argument('--rnn-batch-size', type=int, default=64)
    parser.add_argument('--rnn-lr', type=float, default=1e-4)
    args = parser.parse_args()

    session_snapshots = load_snapshot_sessions(Path(args.data))
    train_sessions, test_sessions = split_session_snapshots(session_snapshots, train_ratio=0.8)

    train_frames = []
    test_frames = []
    for session_id, snapshots in session_snapshots.items():
        all_edge_ids = set()
        edge_capacity_by_id = {}
        for _, _, _, snapshot_obj in snapshots:
            for edge in snapshot_obj.get('edges', []):
                edge_id = edge.get('edgeId')
                if edge_id:
                    all_edge_ids.add(edge_id)
                    capacity = edge.get('edgeCapacity')
                    if capacity is not None:
                        try:
                            capacity_value = float(capacity)
                        except Exception:
                            capacity_value = None
                        if capacity_value is not None and capacity_value > 0:
                            edge_capacity_by_id[edge_id] = capacity_value

        train_frames.append(
            session_snapshots_to_dense_df(
                session_id,
                train_sessions.get(session_id, []),
                sorted(all_edge_ids),
                edge_capacity_by_id,
            )
        )
        test_frames.append(
            session_snapshots_to_dense_df(
                session_id,
                test_sessions.get(session_id, []),
                sorted(all_edge_ids),
                edge_capacity_by_id,
            )
        )

    train_df = pd.concat([frame for frame in train_frames if not frame.empty], ignore_index=True)
    test_df = pd.concat([frame for frame in test_frames if not frame.empty], ignore_index=True)

    if train_df.empty or test_df.empty:
        raise RuntimeError(
            'Train/test split produced an empty partition. '
            'Increase snapshots or check the session folders.'
        )

    X_train, y_train, train_times = build_features(train_df, H=args.H)
    X_test, y_test, test_times = build_features(test_df, H=args.H)

    if len(X_train) == 0 or len(X_test) == 0:
        raise RuntimeError(
            'No training rows available after per-session splitting. '
            'Increase snapshots or reduce H.'
        )

    print(
        f'Total samples: train={len(train_times)}, test={len(test_times)}, '
        f'train rows={len(X_train)}, test rows={len(X_test)}'
    )

    if args.model == 'rf':
        model = RandomForestClassifier(n_estimators=100, n_jobs=-1, random_state=42)
        model.fit(X_train, y_train)
        preds = model.predict(X_test)
    else:
        model, preds = train_rnn_model(
            X_train,
            y_train,
            X_test,
            y_test,
            hidden_size=args.rnn_hidden_size,
            num_layers=args.rnn_layers,
            epochs=args.rnn_epochs,
            batch_size=args.rnn_batch_size,
            lr=args.rnn_lr,
        )

    print(y_test[:10])
    print(preds[:10])
    accuracy = accuracy_score(y_test, preds)
    macro_f1 = f1_score(y_test, preds, average='macro')

    print(f'Accuracy: {accuracy:.4f}, Macro-F1: {macro_f1:.4f}')

    if args.model == 'rf':
        joblib.dump(model, "models/" + args.out_model)
    else:
        torch.save(
            {
                'model_type': 'rnn',
                'input_size': X_train.shape[1],
                'hidden_size': args.rnn_hidden_size,
                'num_layers': args.rnn_layers,
                'state_dict': model.state_dict(),
            },
            "models/" + args.out_model,
        )
    print('Model saved to', "models/" + args.out_model)


if __name__ == '__main__':
    main()
