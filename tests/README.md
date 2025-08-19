# Privacy Pool E2E Tests

End-to-end tests for the Solana Privacy Pool program using NodeLiteSVM.

## Setup

```bash
cd tests
npm install
```

## Running Tests

```bash
# Run all E2E tests
npm test

# Run tests in watch mode
npm run test:watch

# Run unit tests (Rust)
npm run test:unit

# Run all tests (unit + E2E)
npm run test:all
```

## Test Structure

### `e2e/privacy-pool.test.js`
Core functionality tests:
- Pool initialization
- Basic deposit flow
- Withdrawal flow
- Ragequit flow
- Wind down flow

### `e2e/integration.test.js`
Complex integration scenarios:
- Full and partial withdrawals
- Relayed withdrawals
- ASP removal handling
- Attack prevention
- Complex multi-user scenarios

### `utils/test-helpers.js`
Test utilities:
- Instruction builders
- Commitment/nullifier generation
- PDA derivation
- Circuit file loading
- Proof generation helpers

## Test Coverage

The tests cover the following scenarios from the Solidity implementation:

1. **Basic Operations**
   - Pool initialization with various parameters
   - Deposit with commitment generation
   - Withdrawal with ZK proof verification
   - Ragequit for emergency withdrawal
   - Pool wind down by authority

2. **Security Tests**
   - Double-spending prevention
   - Invalid proof rejection
   - Authority verification
   - Duplicate label prevention

3. **Complex Scenarios**
   - Multiple partial withdrawals
   - Relayed withdrawals through third party
   - Concurrent operations
   - Maximum tree depth handling

## Notes

- Tests use dummy proof data for demonstration purposes
- Production tests would require actual ZK proof generation using snarkjs
- LiteSVM provides a lightweight Solana runtime for testing
- Tests verify program behavior and state transitions

## Circuit Integration

To run tests with actual ZK proofs:

1. Build circuits: `npm run build:circuits`
2. Generate trusted setup files
3. Update test helpers to use real proof generation
4. Enable proof verification in tests

## Troubleshooting

If tests fail:
1. Ensure program is built: `cargo build-sbf --release`
2. Check circuits are built: `./build-circuits.sh`
3. Verify all dependencies are installed
4. Check test account funding is sufficient