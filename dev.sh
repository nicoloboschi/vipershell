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
  kill "$UI_PID" "$BACKEND_PID" 2>/dev/null || true
  wait "$UI_PID" "$BACKEND_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Start Vite dev server
(cd ui && npm run dev) &
UI_PID=$!

# Run backend with tsx watch
npx tsx watch src/index.ts --port 4445 --log-level debug &
BACKEND_PID=$!

echo ""
echo "  vipershell dev servers started"
echo "  UI:      http://localhost:4444"
echo "  Backend: http://localhost:4445"
echo ""

wait
