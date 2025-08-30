# Technical Debt and Current Issues

This document tracks remaining technical debt and known issues in the current implementation.

## Current Problems

### 1. Groth16 Verifier Panic

**Location:** `src/crypto/verifying_key.rs`, `vendor/groth16-solana/src/groth16.rs`
**Issue:** Groth16 verifier panics during proof verification, even with correct proof format (big-endian with negated proof_a)
**Status:** Blocking deposit functionality
**TODO:** Debug the exact cause - possibly related to verifying key constants or proof point deserialization

## Token Account Validation

### 2. ATA Verification

**Location:** `src/instructions/initialize.rs`

```rust
// Note: ATA verification would be done client-side
// The pool_token_account should be the ATA of pool_account for asset_mint
```

**TODO:** Add on-chain ATA verification using proper derivation

### 3. Token Program Validation

**Location:** `src/instructions/initialize.rs`

```rust
// Note: We're using pinocchio-token, which handles token program verification internally
```

**TODO:** Consider explicit token program validation if needed

## Performance & Memory Issues

### 4. Stack Frame Overflow Warning

**Location:** Build output
**Issue:** `_ZN4core5slice4sort6stable14driftsort_main` function call overwrites values in frame
**Impact:** May cause undefined behavior during execution
**TODO:** Optimize stack usage or refactor sorting operations

### 5. Large State Size

**Location:** `src/state/lean_imt.rs`
**Issue:** Pool state is 69,936 bytes (near account size limits)
**TODO:** Consider state compression or off-chain storage for some data

## Error Handling

### 6. Unwrap Usage

**Location:** Various locations, especially in crypto modules
**Issue:** Multiple `unwrap()` calls that could panic
**TODO:** Replace with proper error handling and recovery

### 7. Missing Input Validation

**Location:** Various instructions
**Examples:**

- No validation that deposit amount matches proof value before expensive verification
- No checks for overflow in tree operations

**TODO:** Add comprehensive input validation before expensive operations

## Testing Infrastructure

### 8. Missing Unit Tests

**Location:** Throughout codebase
**Issue:** Cannot run unit tests locally for code using Solana syscalls
**TODO:** Add integration tests and consider mocking syscalls for unit tests

## Security Considerations

### 9. Nullifier Validation

**Location:** `src/instructions/withdraw.rs`
**Issue:** Nullifier checking not fully implemented
**TODO:** Implement proper nullifier validation to prevent double-spending

## Notes

### Ragequit Design

Ragequit is intentionally designed as a transparent emergency exit mechanism without ZK proofs. It allows users to withdraw funds by revealing their identity (linking to their depositor state), which is the intended trade-off for emergency situations.