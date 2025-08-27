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
- Run integration tests with solana-test-validator: 
  ```bash
  solana-test-validator --reset --bpf-program 6RAVudLeS2oCBcKXTUwWdjEfJL5wPpRMmagUzpXtJ4WL target/deploy/solana_privacy_pools.so
  npx mocha tests/privacy-pool.sts.test.js
  ```

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
   - Passes slice metadata (ptr + len pairs) to syscall

### Packed Struct Usage
- Using `#[repr(C, packed)]` for zero-copy structs ensures predictable memory layout
- Required for direct casting of account data to struct types
- In tests, must copy field values before assertions due to alignment requirements