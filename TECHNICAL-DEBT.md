# Technical Debt and Simplifications

This document tracks all simplifications and technical debt in the current implementation that should be addressed in production.

## Token Operations

### ~~1. Hardcoded Decimals~~ [FIXED]
**Location:** `src/instructions/withdraw.rs`, `src/instructions/ragequit.rs`
**Resolution:** Now reading decimals directly from mint account using `Mint::from_account_info_unchecked()`

### ~~2. Empty PDA Seeds~~ [FIXED]
**Location:** `src/instructions/withdraw.rs`, `src/instructions/ragequit.rs`
**Resolution:** Implemented proper PDA seeds using `get_pool_signer_seeds()` from constants module

## Cryptographic Operations

### ~~3. Simple Hash for Scope Generation~~ [FIXED]
**Location:** `src/instructions/initialize.rs`
**Resolution:** Now using proper keccak256 hashing via `sol_keccak256` syscall

### 4. Dummy Withdrawal Verifier
**Location:** `src/instructions/initialize.rs:89`
```rust
let withdrawal_verifier = Pubkey::from([0u8; 32]);
```
**TODO:** Use actual verifier key from circuit in production

## Token Account Validation

### 5. ATA Verification
**Location:** `src/instructions/initialize.rs`
```rust
// Note: ATA verification would be done client-side
// The pool_token_account should be the ATA of pool_account for asset_mint
```
**TODO:** Add on-chain ATA verification using proper derivation

### 6. Token Program Validation
**Location:** `src/instructions/initialize.rs`
```rust
// Note: We're using pinocchio-token, which handles token program verification internally
```
**TODO:** Consider explicit token program validation if needed

## State Management

### 7. Pool Authority Signing
**Location:** Multiple withdraw/ragequit operations
**Issue:** Pool account needs to sign as authority for token transfers but current implementation doesn't properly handle PDA signing
**TODO:** Implement proper PDA derivation and signing with seeds

## Testing Simplifications

### 8. Precomputed Test Hashes
**Location:** `src/crypto/poseidon.rs`, `src/crypto/verifying_key.rs`
**Feature Flag:** `test-precomputed-hashes`
**Issue:** Uses hardcoded hashes for testing instead of actual cryptographic operations
**TODO:** Integrate real Poseidon hash and Groth16 verification in production

### ~~8a. Temporary Keccak256 for Poseidon~~ [FIXED]
**Location:** `src/crypto/poseidon.rs` - `hash_two`, `hash_three`
**Issue:** poseidon-ark library was using solana_program instead of pinocchio
**Resolution:** Updated poseidon-ark to use pinocchio's sol_poseidon syscall directly

## Missing Features

### 9. Circuit Integration
**Status:** Using mock verification
**TODO:** Integrate actual ZK circuits for deposit and withdrawal proofs

### 10. Proper Error Handling
**Location:** Various `unwrap()` calls throughout the codebase
**TODO:** Replace with proper error handling and recovery

## Security Considerations

### 11. Input Validation
**Location:** Various instructions
**TODO:** Add comprehensive input validation and bounds checking

### 12. Reentrancy Protection
**Status:** Not implemented
**TODO:** Add reentrancy guards where necessary

## Performance Optimizations

### 13. Zero-Copy Optimizations
**Status:** Partially implemented
**TODO:** Complete zero-copy implementation for all state operations

### 14. Batch Operations
**Status:** Not implemented
**TODO:** Consider batch deposits/withdrawals for gas efficiency