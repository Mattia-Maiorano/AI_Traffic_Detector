#!/bin/bash

# Kill all background jobs started by this script on exit
trap "kill 0" EXIT

echo "================================================================="
echo " Starting AI Traffic Detector - Local Model & Simulation"
echo "================================================================="

# 1. Start the local python prediction server
echo "[+] Starting Python ML server on http://localhost:5001..."
python3 traffic-pred/run_server.py &

# 2. Start the React simulation dev server
echo "[+] Starting Vite dev server for React simulation..."
npm run dev --prefix traffic-sim &

# Keep script running to allow trap to handle clean exit
wait
