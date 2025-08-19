#!/bin/bash

echo "Privacy Pool E2E Tests"
echo "====================="

# Check if dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

# Check if program is built
if [ ! -f "../target/deploy/solana_privacy_pools.so" ]; then
    echo "Building Solana program..."
    cd ..
    cargo build-sbf --release
    cd tests
fi

# Check if circuits are built
if [ ! -d "../build/withdraw_js" ]; then
    echo "Building circuits..."
    cd ..
    ./build-circuits.sh
    cd tests
fi

echo ""
echo "Running tests..."
echo ""

# Run the tests
npm test

echo ""
echo "Tests complete!"