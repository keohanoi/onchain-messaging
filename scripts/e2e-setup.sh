#!/bin/bash

# E2E Test Setup Script
# This script starts the Hardhat node and deploys contracts for E2E testing

set -e

echo "=== E2E Test Setup ==="

# Kill any existing hardhat node on port 8545
echo "Cleaning up any existing Hardhat node..."
lsof -ti:8545 | xargs kill -9 2>/dev/null || true

# Start Hardhat node in background
echo "Starting Hardhat node..."
npx hardhat node &
HARDHAT_PID=$!

# Wait for node to be ready
echo "Waiting for Hardhat node to be ready..."
sleep 5

# Check if node is running
for i in {1..10}; do
  if curl -s -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' http://127.0.0.1:8545 > /dev/null 2>&1; then
    echo "Hardhat node is ready!"
    break
  fi
  echo "Waiting... ($i/10)"
  sleep 2
done

# Deploy contracts
echo "Deploying contracts..."
npx hardhat run scripts/deploy.js --network localhost

# Export ABIs
echo "Exporting ABIs..."
node scripts/export-abis.js

echo "=== Setup Complete ==="
echo "Hardhat node PID: $HARDHAT_PID"
echo ""
echo "To run E2E tests:"
echo "  bun run test:e2e"
echo ""
echo "To stop the Hardhat node:"
echo "  kill $HARDHAT_PID"
