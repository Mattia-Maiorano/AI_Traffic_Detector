import os
import json
import glob
import torch
import torch.nn as nn
import torch.optim as optim
import numpy as np
from torch.utils.data import Dataset, DataLoader
from sklearn.metrics import accuracy_score, f1_score

class GCNConv(nn.Module):
    def __init__(self, in_features, out_features):
        super().__init__()
        self.linear = nn.Linear(in_features, out_features)

    def forward(self, x, adj):
        if x.dim() == 4:
            out = torch.matmul(adj.unsqueeze(1), x)
            return self.linear(out)
        out = torch.matmul(adj, x)
        return self.linear(out)

class TrafficGNN(nn.Module):
    def __init__(self, in_features, hidden_dim=256, num_classes=4, seq_len=5):
        super().__init__()
        self.seq_len = seq_len
        
        self.feature_map = nn.Sequential(
            nn.Linear(in_features, hidden_dim),
            nn.LayerNorm(hidden_dim),
            nn.ReLU(),
            nn.Dropout(0.2)
        )
        
        self.conv1 = GCNConv(hidden_dim, hidden_dim)
        self.conv2 = GCNConv(hidden_dim, hidden_dim)
        
        # --- FIXED: Swapped nn.RReLU out for MPS-native nn.LeakyReLU ---
        self.relu = nn.LeakyReLU(0.1)
        self.dropout = nn.Dropout(0.2)
        self.layer_norm = nn.LayerNorm(hidden_dim)
        
        self.gru = nn.GRU(
            input_size=hidden_dim, 
            hidden_size=hidden_dim, 
            num_layers=3, 
            batch_first=True, 
            bidirectional=False,
            dropout=0.25
        )
        
        self.classifier = nn.Sequential(
            nn.Linear(hidden_dim, hidden_dim),
            nn.LayerNorm(hidden_dim),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(hidden_dim, hidden_dim // 2),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(hidden_dim // 2, num_classes)
        )

    def forward(self, x, adj):
        batch_size, seq_len, num_nodes, in_features = x.shape
        x_mapped = self.feature_map(x) 
        
        spatial_embeddings = []
        for t in range(seq_len):
            xt = x_mapped[:, t, :, :] 
            h1 = self.relu(self.layer_norm(self.conv1(xt, adj)))
            h1 = self.dropout(h1)
            
            h2 = self.relu(self.layer_norm(self.conv2(h1, adj)))
            h_spatial = self.dropout(h2 + h1)
            spatial_embeddings.append(h_spatial)
            
        spatial_embeddings = torch.stack(spatial_embeddings, dim=0).permute(1, 2, 0, 3)
        spatial_embeddings = spatial_embeddings.reshape(batch_size * num_nodes, seq_len, -1)
        
        out, _ = self.gru(spatial_embeddings)
        latest_temporal_state = out[:, -1, :] 
        
        logits = self.classifier(latest_temporal_state)
        return logits.view(batch_size, num_nodes, -1)

class TrafficDataset(Dataset):
    def __init__(self, data_list):
        self.data_list = data_list

    def __len__(self):
        return len(self.data_list)

    def __getitem__(self, idx):
        return self.data_list[idx]

def collate_fn(batch):
    xs = torch.stack([item[0] for item in batch], dim=0)   
    adjs = torch.stack([item[1] for item in batch], dim=0) 
    ys = torch.stack([item[2] for item in batch], dim=0)   
    return xs, adjs, ys

def density_to_class(density):
    if density < 0.25: return 0
    elif density < 0.5: return 1
    elif density < 0.75: return 2
    else: return 3

def parse_flow_dir(flow_dir):
    mapping = {'N': [1, 0, 0, 0], 'S': [0, 1, 0, 0], 'E': [0, 0, 1, 0], 'W': [0, 0, 0, 1]}
    return mapping.get(flow_dir, [0, 0, 0, 0])

def build_adjacency_matrix(edges):
    num_nodes = len(edges)
    A = torch.zeros((num_nodes, num_nodes), dtype=torch.float32)
    
    def get_endpoints(edge_id):
        if edge_id.startswith('h-street-'):
            parts = edge_id.split('-')
            r, c = int(parts[2]), int(parts[3])
            return (f"node-{r}-{c}", f"node-{r}-{c+1}") if r % 2 == 0 else (f"node-{r}-{c+1}", f"node-{r}-{c}")
        elif edge_id.startswith('v-avenue-'):
            parts = edge_id.split('-')
            r, c = int(parts[2]), int(parts[3])
            return (f"node-{r}-{c}", f"node-{r+1}-{c}") if c % 2 == 0 else (f"node-{r+1}-{c}", f"node-{r}-{c}")
        elif edge_id.startswith('v-in-n-'):
            i = int(edge_id.split('-')[-1])
            return f"entry-n-{i}", f"node-0-{i}"
        elif edge_id.startswith('v-out-s-'):
            return f"node-grid-{int(edge_id.split('-')[-1])}", f"exit-s-{int(edge_id.split('-')[-1])}"
        if '_sub_' in edge_id:
            parent_id = edge_id.split('_sub_')[0]
            sub_idx = int(edge_id.split('_sub_')[1].split('_of_')[0])
            total_subs = int(edge_id.split('_of_')[-1])
            p_src, p_tgt = get_endpoints(parent_id)
            if p_src and p_tgt:
                node_src = p_src if sub_idx == 0 else f"{parent_id}_node_{sub_idx}"
                node_tgt = p_tgt if sub_idx == total_subs - 1 else f"{parent_id}_node_{sub_idx+1}"
                return node_src, node_tgt
        return None, None

    for i, edge in enumerate(edges):
        src_node, tgt_node = get_endpoints(edge['edgeId'])
        edge['src_node'] = src_node
        edge['tgt_node'] = tgt_node

    for i, edge_a in enumerate(edges):
        for j, edge_b in enumerate(edges):
            if edge_a['tgt_node'] and edge_b['src_node'] and edge_a['tgt_node'] == edge_b['src_node']:
                A[i, j] = 1.0

    A_tilde = A + torch.eye(num_nodes)
    D_diag = torch.sum(A_tilde, dim=1)
    D_inv = 1.0 / D_diag
    D_inv[torch.isinf(D_inv)] = 0.0
    return A_tilde * D_inv.unsqueeze(1)

def load_dataset(data_dir, seq_len=5):
    files = sorted(glob.glob(os.path.join(data_dir, "*.json")))
    if not files:
        raise FileNotFoundError(f"No GNN JSON snapshots found in {data_dir}")
    
    snapshots = []
    for file in files:
        with open(file, 'r') as f:
            snapshots.append(json.load(f))
            
    dataset = []
    for i in range(seq_len - 1, len(snapshots)):
        snap = snapshots[i]
        current_time = snap['time']
        if not snap['edges']:
            continue
        horizon = snap['edges'][0]['horizonTime']
        target_time = current_time + horizon
        
        future_snap = None
        min_diff = float('inf')
        for potential_future in snapshots[i:]:
            diff = abs(potential_future['time'] - target_time)
            if diff < min_diff:
                min_diff = diff
                future_snap = potential_future
        
        if future_snap is None or min_diff > 1.5:
            continue
            
        future_densities = {e['edgeId']: e['edgeDensity'] for e in future_snap['edges']}
        adj = build_adjacency_matrix(snap['edges'])
        
        x_seq = []
        valid_sequence = True
        for t in range(i - seq_len + 1, i + 1):
            s = snapshots[t]
            x_list = []
            for edge in s['edges']:
                flow_features = parse_flow_dir(edge['flowDirection'])
                feats = [
                    edge['count'],
                    edge['edgeCapacity'],
                    edge['edgeDensity'],
                    edge['speedLimit'],
                    edge['trafficLightState'],
                    edge['phaseTimeRemaining'],
                    edge['spawnWeight'],
                    edge['horizonTime']
                ] + flow_features
                x_list.append(feats)
            if not x_list:
                valid_sequence = False
                break
            x_seq.append(x_list)
            
        if not valid_sequence:
            continue
            
        y_list = []
        for edge in snap['edges']:
            edge_id = edge['edgeId']
            future_density = future_densities.get(edge_id, edge['edgeDensity'])
            y_list.append(density_to_class(future_density))
            
        dataset.append((torch.tensor(x_seq, dtype=torch.float32), adj, torch.tensor(y_list, dtype=torch.long)))
        
    print(f"Dataset successfully compiled. Total training snapshots: {len(dataset)}")
    return dataset

def main():
    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    
    data_dir = 'processed_test/gnn_data'
    try:
        dataset = load_dataset(data_dir)
    except FileNotFoundError as e:
        print(f"Error: {e}")
        return

    split_idx = int(len(dataset) * 0.8)
    train_raw = dataset[:split_idx]
    val_raw = dataset[split_idx:]

    if not train_raw:
        print("Not enough data to train.")
        return

    in_features = dataset[0][0].shape[2]
    hidden_dim = 256 
    num_classes = 4
    
    all_feats = []
    for x, _, _ in train_raw:
        all_feats.append(x.numpy().reshape(-1, in_features))
    all_feats = np.concatenate(all_feats, axis=0)
    mean = np.mean(all_feats, axis=0)
    std = np.std(all_feats, axis=0)
    std[std == 0.0] = 1.0
    
    def scale_dataset(data, mean, std):
        mean_t = torch.tensor(mean, dtype=torch.float32)
        std_t = torch.tensor(std, dtype=torch.float32)
        return [( (x - mean_t) / std_t, adj, y ) for x, adj, y in data]

    train_data = scale_dataset(train_raw, mean, std)
    val_data = scale_dataset(val_raw, mean, std)

    train_loader = DataLoader(TrafficDataset(train_data), batch_size=32, shuffle=True, collate_fn=collate_fn)
    val_loader = DataLoader(TrafficDataset(val_data), batch_size=32, shuffle=False, collate_fn=collate_fn)

    all_y = []
    for _, _, y in train_data:
        all_y.extend(y.tolist())
    all_y = np.array(all_y)
    
    class_counts = np.bincount(all_y, minlength=num_classes)
    total_samples = len(all_y)
    
    class_weights = np.zeros(num_classes, dtype=np.float32)
    for c in range(num_classes):
        count = class_counts[c]
        class_weights[c] = total_samples / (num_classes * count) if count > 0 else 1.0
        
    class_weights_tensor = torch.tensor(class_weights, dtype=torch.float32)

    model = TrafficGNN(in_features, hidden_dim, num_classes).to(device)
    optimizer = optim.AdamW(model.parameters(), lr=0.0004, weight_decay=2e-3) 
    criterion = nn.CrossEntropyLoss(weight=class_weights_tensor.to(device))
    scheduler = optim.lr_scheduler.ReduceLROnPlateau(optimizer, mode='max', factor=0.5, patience=4)

    print(f"Starting High-Capacity GNN Training. Hardware target: {device.type.upper()}")
    
    best_f1 = 0.0
    for epoch in range(1, 41):
        model.train()
        epoch_loss = 0.0
        train_preds, train_targets = [], []
        
        for x_b, adj_b, y_b in train_loader:
            x_b, adj_b, y_b = x_b.to(device), adj_b.to(device), y_b.to(device)
            
            optimizer.zero_grad()
            out = model(x_b, adj_b) 
            
            loss = criterion(out.view(-1, num_classes), y_b.view(-1))
            loss.backward()
            
            nn.utils.clip_grad_norm_(model.parameters(), max_norm=4.0)
            optimizer.step()
            epoch_loss += loss.item() * x_b.size(0)
            
            train_preds.extend(torch.argmax(out, dim=-1).view(-1).cpu().numpy())
            train_targets.extend(y_b.view(-1).cpu().numpy())
            
        train_acc = accuracy_score(train_targets, train_preds)
        train_f1 = f1_score(train_targets, train_preds, average='macro')
        
        model.eval()
        val_preds, val_targets = [], []
        val_loss = 0.0
        with torch.no_grad():
            for x_b, adj_b, y_b in val_loader:
                x_b, adj_b, y_b = x_b.to(device), adj_b.to(device), y_b.to(device)
                
                out = model(x_b, adj_b)
                loss = criterion(out.view(-1, num_classes), y_b.view(-1))
                val_loss += loss.item() * x_b.size(0)
                val_preds.extend(torch.argmax(out, dim=-1).view(-1).cpu().numpy())
                val_targets.extend(y_b.view(-1).cpu().numpy())
                
        val_acc = accuracy_score(val_targets, val_preds) if val_targets else 0.0
        val_f1 = f1_score(val_targets, val_preds, average='macro') if val_targets else 0.0
        
        scheduler.step(val_f1)
        
        if val_f1 > best_f1:
            best_f1 = val_f1
            os.makedirs('models', exist_ok=True)
            torch.save(model.to('cpu').state_dict(), 'models/model_gnn.pt')
            model.to(device) 
            torch.save({'mean': torch.tensor(mean, dtype=torch.float32), 'std': torch.tensor(std, dtype=torch.float32)}, 'models/scaler.pt')

        if epoch % 5 == 0 or epoch == 1:
            print(f"Epoch {epoch:02d} | Train Loss: {epoch_loss/len(train_data):.4f} | Train Acc: {train_acc:.3f} | Train F1: {train_f1:.3f} || Val Loss: {val_loss/len(val_data):.4f} | Val Acc: {val_acc:.3f} | Val F1: {val_f1:.3f}")

    print(f"\nGNN training complete! Best Validation Macro-F1 reached: {best_f1:.4f}")

if __name__ == "__main__":
    main()