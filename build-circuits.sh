#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Building Circom circuits...${NC}"

# Circuit configurations: (circuit_file, circuit_name)
CIRCUITS=(
    "commitment_main.circom commitment"
    "merkleTree_main.circom merkleTree"
    "withdraw.circom withdraw"
)

# Powers of Tau file
PTAU_FILE="trusted-setup/powersOfTau28_hez_final_15.ptau"

# Download powers of tau if not present
if [ ! -f "$PTAU_FILE" ]; then
    echo -e "${YELLOW}Downloading powers of tau file...${NC}"
    mkdir -p trusted-setup
    wget -q https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_15.ptau \
        -O "$PTAU_FILE"
fi

# Build each circuit
for CIRCUIT_CONFIG in "${CIRCUITS[@]}"; do
    read -r CIRCUIT_FILE CIRCUIT_NAME <<< "$CIRCUIT_CONFIG"
    echo -e "${YELLOW}Building ${CIRCUIT_NAME} circuit...${NC}"
    
    # Create build directory for this circuit
    mkdir -p "build/${CIRCUIT_NAME}"
    
    # Step 1: Compile the circuit
    echo "  Compiling ${CIRCUIT_FILE}..."
    circom "circuits/${CIRCUIT_FILE}" \
        --r1cs \
        --wasm \
        --sym \
        -l node_modules \
        -o "build/${CIRCUIT_NAME}"
    
    # Step 2: Setup groth16
    echo "  Setting up groth16..."
    # Find the r1cs file (it may have the original circuit filename)
    R1CS_FILE=$(find "build/${CIRCUIT_NAME}" -name "*.r1cs" | head -1)
    snarkjs groth16 setup \
        "$R1CS_FILE" \
        "$PTAU_FILE" \
        "build/${CIRCUIT_NAME}/${CIRCUIT_NAME}_0000.zkey"
    
    # Step 3: Contribute to ceremony
    echo "  Contributing to ceremony..."
    snarkjs zkey contribute \
        "build/${CIRCUIT_NAME}/${CIRCUIT_NAME}_0000.zkey" \
        "build/${CIRCUIT_NAME}/groth16_pkey.zkey" \
        --name="1st Contributor" \
        -e="random entropy for ${CIRCUIT_NAME}"
    
    # Step 4: Export verification key
    echo "  Exporting verification key..."
    snarkjs zkey export verificationkey \
        "build/${CIRCUIT_NAME}/groth16_pkey.zkey" \
        "build/${CIRCUIT_NAME}/groth16_vkey.json"
    
    # Clean up intermediate files
    rm "build/${CIRCUIT_NAME}/${CIRCUIT_NAME}_0000.zkey"
    
    echo -e "${GREEN}  ✓ ${CIRCUIT_NAME} circuit built${NC}"
done

# Step 5: Convert withdraw circuit verifying key to Rust for Solana
echo -e "${YELLOW}Converting withdraw verifying key to Rust...${NC}"
if [ -f "scripts/parse_vk_to_rust.js" ]; then
    node scripts/parse_vk_to_rust.js build/withdraw/groth16_vkey.json src/
    echo -e "${GREEN}✓ Verifying key converted to src/verifying_key.rs${NC}"
else
    echo -e "${RED}parse_vk_to_rust.js not found in scripts/. Please ensure it's available.${NC}"
fi

# Copy final keys to trusted-setup
echo -e "${YELLOW}Copying final keys to trusted-setup...${NC}"
for CIRCUIT_CONFIG in "${CIRCUITS[@]}"; do
    read -r CIRCUIT_FILE CIRCUIT_NAME <<< "$CIRCUIT_CONFIG"
    cp "build/${CIRCUIT_NAME}/groth16_pkey.zkey" "trusted-setup/final-keys/${CIRCUIT_NAME}_final.zkey"
    cp "build/${CIRCUIT_NAME}/groth16_vkey.json" "trusted-setup/final-keys/${CIRCUIT_NAME}_vkey.json"
done

echo -e "${GREEN}All circuits built successfully!${NC}"
echo ""
echo "Build artifacts:"
echo "  - R1CS files: build/*/[circuit].r1cs"
echo "  - WASM files: build/*/[circuit]_js/"
echo "  - Proving keys: build/*/groth16_pkey.zkey"
echo "  - Verification keys: build/*/groth16_vkey.json"
echo "  - Rust verifying key: src/verifying_key.rs"