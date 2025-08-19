# ZK Proof Integration for Solana Privacy Pools

This document describes the integration of zero-knowledge proofs with the Solana Privacy Pool E2E tests.

## Architecture

### Proof Generation Pipeline

1. **Circuit Inputs** → 2. **snarkjs** → 3. **Proof Encoding** → 4. **Solana Transaction**

### Key Components

#### 1. ProofGenerator (`utils/proof-generator.js`)
- Handles circuit loading and proof generation
- Encodes proofs for Solana's alt_bn128 precompiles
- Manages commitment and nullifier generation using Poseidon

#### 2. Proof Encoding
The encoding follows Solana's expected format for Groth16 verification:

```javascript
// G1 Point (64 bytes): [x, y] with negated y-coordinate
proofA = [x_bytes(32), neg_y_bytes(32)]

// G2 Point (128 bytes): [x_im, x_re, y_im, y_re]
proofB = [x_im(32), x_re(32), y_im(32), y_re(32)]

// G1 Point (64 bytes): [x, y]
proofC = [x_bytes(32), y_bytes(32)]
```

#### 3. Public Signals
Each public signal is encoded as a 32-byte big-endian value:
- Withdrawal: 8 signals (withdrawn_value, state_root, state_depth, asp_root, asp_depth, context, new_commitment, nullifier)
- Ragequit: 4 signals (value, label, commitment_hash, nullifier_hash)

## Circuits

### Withdrawal Circuit
Proves knowledge of a commitment's preimage while creating a new commitment for remaining funds.

**Inputs:**
- Private: existingSecret, newSecret, siblings
- Public: withdrawnValue, roots, context, commitments

### Ragequit Circuit
Proves ownership of a commitment by revealing the label.

**Inputs:**
- Private: secret
- Public: value, label, commitment_hash, nullifier_hash

### Commitment Circuit
Computes commitment hash from inputs (used for testing).

**Inputs:**
- Private: secret, nullifier
- Public: value, label

## Testing

### Unit Tests
```bash
# Run Rust unit tests
cargo test
```

### E2E Tests with Proofs
```bash
cd tests
npm test
```

### Test Files

1. **`privacy-pool-with-proofs.test.js`**
   - Full deposit/withdrawal flow with real ZK proofs
   - Partial withdrawal with new commitment
   - Ragequit proof generation
   - Edge cases and validation

2. **`privacy-pool.test.js`**
   - Basic functionality tests
   - Transaction structure validation
   - Error handling

3. **`integration.test.js`**
   - Complex multi-user scenarios
   - Attack prevention tests
   - Concurrent operations

## Proof Verification on Solana

The Solana program uses the `groth16-solana` library to verify proofs:

```rust
// In withdraw.rs
if !verify_withdraw_proof(&proof_data) {
    return Err(ProgramError::InvalidArgument);
}
```

The verification process:
1. Deserialize proof components (A, B, C)
2. Prepare public inputs using alt_bn128_multiplication
3. Perform pairing check using alt_bn128_pairing
4. Verify pairing result equals 1

## Known Limitations

1. **LiteSVM Support**: The test framework (LiteSVM) may not support alt_bn128 syscalls
2. **Trusted Setup**: Tests use the existing trusted setup from `trusted-setup/final-keys/`
3. **Performance**: Proof generation can take 5-10 seconds per proof

## Circuit Building

Circuits must be built before running tests:

```bash
# Build all circuits
./build-circuits.sh

# This generates:
# - build/withdraw_js/withdraw.wasm
# - build/ragequit_js/ragequit.wasm  
# - build/commitment_js/commitment.wasm
# - trusted-setup/final-keys/*.zkey files
```

## Debugging

### Common Issues

1. **"Circuit WASM file not found"**
   - Run `./build-circuits.sh` to build circuits

2. **"Program not built"**
   - Run `cargo build-sbf --release` to build the Solana program

3. **Proof verification fails**
   - Check verifying key matches between circuits and program
   - Verify public signals ordering
   - Ensure proper endianness conversion

### Logging

Enable debug output:
```javascript
// In tests
console.log('Proof:', proofData);
console.log('Public signals:', proofData.publicSignals);
```

## Integration with Solana Program

The program expects proofs in the instruction data:

```rust
pub struct WithdrawProofData {
    pub proof_a: [u8; 64],
    pub proof_b: [u8; 128],
    pub proof_c: [u8; 64],
    pub public_signals: Vec<[u8; 32]>,
}
```

The verifying key must match the circuit's verification key:
- Generated using `parse_vk_to_rust.js`
- Stored in `src/crypto/verifying_key.rs`

## Future Improvements

1. **Optimize Proof Generation**: Use WASM multithreading
2. **Batch Verification**: Verify multiple proofs in one transaction
3. **Recursive Proofs**: Aggregate multiple operations
4. **Circuit Upgrades**: Support for larger merkle trees