#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Running Privacy Pool Test with solana-test-validator ===${NC}\n"

# Check if program is built
if [ ! -f "target/deploy/solana_privacy_pools.so" ]; then
    echo -e "${RED}Error: Program not built. Run: cargo build-sbf${NC}"
    exit 1
fi

# Get or generate program keypair
KEYPAIR_PATH="target/deploy/solana_privacy_pools-keypair.json"
if [ ! -f "$KEYPAIR_PATH" ]; then
    echo -e "${YELLOW}Generating new program keypair...${NC}"
    solana-keygen new --no-passphrase --silent --outfile "$KEYPAIR_PATH"
fi

# Extract program ID
PROGRAM_ID=$(solana address -k "$KEYPAIR_PATH")
echo -e "${GREEN}Program ID: ${PROGRAM_ID}${NC}"

# Kill any existing validator
echo -e "\n${YELLOW}Stopping any existing validator...${NC}"
pkill -f solana-test-validator || true
sleep 2

# Remove test-ledger to start fresh
echo -e "${YELLOW}Removing test-ledger...${NC}"
rm -rf test-ledger

# Start validator with program
echo -e "\n${GREEN}Starting solana-test-validator with program...${NC}"
solana-test-validator \
    --bpf-program "$PROGRAM_ID" target/deploy/solana_privacy_pools.so \
    > validator.log 2>&1 &

VALIDATOR_PID=$!
echo -e "${GREEN}Validator started (PID: $VALIDATOR_PID)${NC}"

# Wait for validator to start
echo -e "\n${YELLOW}Waiting for validator to start...${NC}"
sleep 5

# Check if validator is running
if ! kill -0 $VALIDATOR_PID 2>/dev/null; then
    echo -e "${RED}Validator failed to start. Check validator.log${NC}"
    exit 1
fi

# Run the test
echo -e "\n${GREEN}Running test...${NC}\n"
# Allow specifying which test to run via environment variable
TEST_FILE=${TEST_FILE:-tests/privacy-pool.test.js}
node "$TEST_FILE"

TEST_EXIT_CODE=$?

# Clean up
echo -e "\n${YELLOW}Stopping validator...${NC}"
kill $VALIDATOR_PID 2>/dev/null || true

if [ $TEST_EXIT_CODE -eq 0 ]; then
    echo -e "\n${GREEN}✅ Test completed successfully!${NC}"
else
    echo -e "\n${RED}❌ Test failed with exit code $TEST_EXIT_CODE${NC}"
fi

exit $TEST_EXIT_CODE