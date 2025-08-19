#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Building Solana Privacy Pools...${NC}"

# Step 1: Build circuits if needed
if [ ! -f "src/verifying_key.rs" ]; then
    echo -e "${YELLOW}Verifying key not found. Building circuits first...${NC}"
    ./build-circuits.sh
fi

# Step 2: Build Solana program
echo -e "${YELLOW}Building Solana program...${NC}"
cargo build-sbf --release

echo -e "${GREEN}Build complete!${NC}"
echo "Deploy with:"
echo "solana program deploy target/deploy/solana_privacy_pools.so"