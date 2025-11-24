# Project Notes for Claude

## Cargo Proxy Issue Fix
When running cargo commands and encountering proxy errors like:
```
error: unknown proxy name: 'cursor-...'
```

Use this workaround:
```bash
unset ARGV0 && cargo <command>
```

For example:
- `unset ARGV0 && cargo test`
- `unset ARGV0 && cargo build`
- `unset ARGV0 && cargo check`

This is necessary when working in environments with cursor proxy configurations.

## Testing Commands
- Build program: `unset ARGV0 && cargo build-sbf`
- Run integration tests with validator: `npm run test:validator`
  - This script automatically restarts the validator with a fresh ledger
  - Runs the full test suite with proper validator management
- Run specific test file: `TEST_FILE="tests-package/security/minimal-withdrawal.test.js" ./test-with-validator.sh`
- Manual test run (if validator already running): `npx mocha tests/privacy-pool.sts.test.js`

### Testing Architecture

**Problem**: Solana privacy pools require integration tests (not unit tests) because `sol_poseidon` syscall only works in Solana runtime. This differs from Ethereum where circuit tests can run standalone.

**Key Challenge**: Tests share a single pool across test runs, accumulating state. Manual commitment tracking (`allDeposits` array) easily diverges from actual on-chain state, causing cryptic circuit failures.

**Solution**: Root Validation Approach
1. **Track commitments locally** in each test
2. **Validate roots against on-chain state** before building merkle proofs:
   ```javascript
   const { stateTree, aspTree } = await buildMerkleTrees(deposits);
   await validateTreeRoots(connection, poolStateAccount, stateTree, aspTree);
   ```
3. **Fail fast** if local tracking diverges from blockchain
4. **Build proofs** only after validation passes

**Test Structure** (`tests-package/security/`):
```
security/
├── minimal-withdrawal.test.js     # Validates root validation approach
├── nullifier-tests.test.js        # Double-spend prevention, unknown roots
├── merkle-proof-tests.test.js     # Commitment membership, tree depth
├── amount-validation-tests.test.js # Over-withdrawal prevention
├── asp-membership-tests.test.js   # ASP enforcement (with caveats)
├── authorization-tests.test.js    # Ragequit authorization
├── state-integrity-tests.test.js  # State integrity after failures
└── helpers/
    ├── test-setup.js              # Shared pool, users, deposits
    ├── error-assertions.js        # expectTransactionSuccess/Failure
    ├── state-verification.js      # capturePoolSnapshot, verifyPoolUnchanged
    └── proof-generators.js        # generateFakeCommitment, etc.
```

**Atomic Test Principles**:
1. Each test file = one security property
2. Each test creates fresh users (Keypair.generate())
3. Tests share pool but query on-chain state for truth
4. Root validation ensures local state matches blockchain
5. No manual cross-test state accumulation

**Why This Works**:
- **Ethereum tests**: Circuit unit tests, isolated merkle trees per test
- **Solana tests**: Integration tests, shared pool, validate roots against chain
- **Root validation**: Bridges the gap, ensures local tracking accuracy

## Important Implementation Notes

### Unit Testing Limitations
- **Cannot run unit tests locally** for Solana programs that use runtime syscalls like `sol_poseidon`
- These syscalls are only available in the Solana runtime environment
- All testing must be done through integration tests using solana-test-validator or LiteSVM

### State Management Fixes Applied
1. **RefMut Guard Management**: Fixed state persistence by maintaining `RefMut` guard throughout operations
   - Pattern: Keep `pool_data` borrow alive while modifying state through raw pointer
   
2. **Zero Initialization**: Solana accounts are NOT zero-initialized by default
   - Must explicitly zero account data during initialization
   
3. **Poseidon Syscall**: Uses native `sol_poseidon` syscall through pinocchio
   - Requires inputs to be valid BN254 field elements
   - Keccak hash results must be reduced modulo the field (clear top 2 bits for safety)
   - Passes array of PoseidonInput structs (ptr, len pairs) to syscall
   - Uses little-endian format (endianness parameter = 1)

### Packed Struct Usage
- Using `#[repr(C, packed)]` for zero-copy structs ensures predictable memory layout
- Required for direct casting of account data to struct types
- In tests, must copy field values before assertions due to alignment requirements
- Direct buffer manipulation needed for nonce updates to ensure persistence

### Do not simplify without explicit instructions to do so
- Do not "simplify", mock or reduce functionality without express acknowledgement from the user.

## Verifying Key Generation
When updating ZK circuit verifying keys, use the script in groth16-solana:
```bash
cd vendor/groth16-solana
node parse_vk_to_rust.js /path/to/groth16_vkey.json /output/directory/
```
This generates a properly formatted `verifying_key.rs` file with the constants needed for Rust.

## Design Notes

### Fee Collection System

The protocol implements a fee collection mechanism matching Ethereum standards:

**Fee Structure:**
- **Withdrawal fees**: 0.3% (30 basis points) - matches Ethereum implementation
- **Deposit fees**: 0% (no deposit fees)
- **Minimum fee**: 0 lamports (no minimum)
- **Fee collector**: Defaults to pool authority, configurable during initialization

**Implementation Details:**
- Fees are deducted from withdrawal amounts (users receive net amount after fee)
- Fees accumulate in `pool_state.accumulated_fees` (u64 field)
- Fee collector can withdraw accumulated fees via `WithdrawFees` instruction
- Fee formula: `fee = max((amount * basis_points) / 10000, minimum_fee)`

**State Structure Changes:**
```rust
// Added to PoolStateLeanIMT (56 bytes total)
pub withdrawal_fee_basis_points: u16,  // 30 = 0.3%
pub deposit_fee_basis_points: u16,     // 0 = 0%
pub _fee_padding1: [u8; 4],
pub withdrawal_fee_min: u64,           // 0 (no minimum)
pub fee_collector: [u8; 32],           // Authority to collect fees
pub accumulated_fees: u64,             // Total fees accumulated
```

**Breaking Change:**
- Pool state size changed: 3616 → 3672 bytes
- Existing pools cannot be used with updated program
- Requires new pool deployment or data migration

**Security Considerations:**
- Only authorized fee collector can withdraw fees
- Fee calculation uses checked arithmetic to prevent overflow
- Accumulated fees tracked separately from pool liquidity
- Withdrawal logic deducts fee before transfer (prevents over-withdrawal)

**Testing:**
- Fee calculation tests: `tests-package/fees/fee-calculation-tests.test.js`
- Integration tests: `tests-package/fees/withdrawal-fee-deduction-tests.test.js`
- Withdrawal instruction tests: `tests-package/fees/fee-withdrawal-tests.test.js`
- Access control tests: `tests-package/fees/fee-access-control-tests.test.js`

**Client SDK:**
- `withdrawFees(connection, poolStateAccount, feeCollector, amount)` - Withdraw accumulated fees
- `getAccumulatedFees(connection, poolStateAccount)` - Query fee information
- `calculateWithdrawalFee(amount, basisPoints, minimumFee)` - Calculate expected fee

**Example Usage:**
```javascript
// User withdraws 1 SOL
const grossAmount = 1_000_000_000; // 1 SOL in lamports
const fee = calculateWithdrawalFee(grossAmount, 30, 0);
const netAmount = grossAmount - fee;

// User receives: 997,000,000 lamports (0.997 SOL)
// Pool retains: 3,000,000 lamports (0.003 SOL) as fees
```

### Ragequit Design

Ragequit is intentionally designed as a transparent emergency exit mechanism without ZK proofs. It allows users to withdraw funds by revealing their identity (linking to their depositor state), which is the intended trade-off for emergency situations.

## Issue Tracking

- Use Linear MCP to track issues for this project
- All issues should be tagged with the "privacy-pools" label
- Issues are tracked in the Darklake team workspace