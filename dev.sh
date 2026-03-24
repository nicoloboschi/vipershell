#!/usr/bin/env bash
set -e

# Install UI deps if needed
if [ ! -d ui/node_modules ]; then
  echo "Installing UI dependencies..."
  cd ui && npm install && cd ..
fi

# Install backend deps if needed
if [ ! -d node_modules ]; then
  echo "Installing backend dependencies..."
  npm install
fi

cleanup() {
  echo "Shutting down..."
  kill "$BACKEND_PID" "$VITE_PID" 2>/dev/null || true
  wait "$BACKEND_PID" "$VITE_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Backend on port 4445 (API + WebSocket)
NODE_ENV=development npx tsx watch src/index.ts --port 4445 --log-level debug &
BACKEND_PID=$!

# Vite dev server on port 4444 (UI + HMR, proxies /api and /ws to backend)
cd ui && npx vite --host 0.0.0.0 --port 4444 &
VITE_PID=$!
cd ..

echo ""
echo "  vipershell dev:"
echo "    UI:      http://localhost:4444"
echo "    Backend: http://localhost:4445"
echo ""

wait
