# Critical Security Tests for Solana Privacy Pools

## Overview

This directory contains critical security tests that validate failure modes and security properties of the Solana Privacy Pool implementation.

## Test Infrastructure

### Files

- **critical-security-tests.test.js** - Main test suite with 9 critical security tests
- **helpers/test-setup.js** - Test context, pool initialization, and deposit creation
- **helpers/error-assertions.js** - Transaction failure assertion utilities
- **helpers/state-verification.js** - State integrity verification functions
- **helpers/proof-generators.js** - ZK proof generation and fake data helpers
- **fixtures/test-data.js** - Test constants and expected error messages

### Running Tests

```bash
# Run all security tests with solana-test-validator
export TEST_FILE=tests-package/security/critical-security-tests.test.js && ./test-with-validator.sh

# Or from tests-package directory
cd tests-package
npm run test:security  # (Note: requires Surfpool or custom validator setup)
```

## Test Status

### ✅ Passing Tests (1/9)

1. **Nullifier Reuse (Double-Spend Prevention)** - PASSING
   - Creates deposit
   - Performs partial withdrawal
   - Attempts second withdrawal with same nullifier
   - **Result**: Circuit correctly rejects with "Assert Failed" error
   - **Security Property**: Double-spend prevention works!

### ⏳ Tests Needing Completion (8/9)

2. **Unknown Root Rejection**
   - Status: Scaffold implemented, needs debugging
   - Goal: Reject withdrawals with roots not in pool's root history
   - Current issue: Needs proper fake commitment generation

3. **Commitment Not In State Tree**
   - Status: Similar to test #2, needs debugging
   - Goal: Reject withdrawals for commitments not in merkle tree
   - Current issue: Fake commitment proof generation

4. **Invalid Tree Depth**
   - Status: Documentation only
   - Goal: Validate circuit enforces correct tree depth
   - Implementation: Needs circuit-level validation or special test case

5. **Amount Exceeds Available**
   - Status: Has implementation, needs debugging
   - Goal: Reject withdrawals exceeding commitment value
   - Current issue: Need to verify circuit arithmetic constraints

6. **Label Not In ASP Tree**
   - Status: Documentation only
   - Goal: Enforce ASP membership for withdrawals
   - Implementation: Complex - requires ASP tree manipulation

7. **Label Removed From ASP**
   - Status: Documentation only
   - Goal: Temporal ASP membership enforcement
   - Implementation: Requires ASP tree removal functionality

8. **Ragequit Wrong Depositor**
   - Status: Has implementation, needs debugging
   - Goal: Only original depositor can ragequit their deposit
   - Current issue: Needs proper authorization check test

9. **State Integrity After Failures**
   - Status: Has implementation, needs debugging
   - Goal: Verify state unchanged after failed operations
   - Current issue: Multiple failure scenarios need proper assertions

## Implementation Notes

### Test Isolation

- Tests share a single pool (created in `before` hook)
- Fresh users are created for each test (in `beforeEach` hook)
- This avoids AToken "Provided owner is not allowed" errors from reusing token accounts

### Error Expectations

The circuit catches various failures with different error messages:

- **Nullifier reuse**: "Assert Failed" (caught at circuit level)
- **Invalid proofs**: "Groth16VerificationFailed"
- **Invalid roots**: "InvalidRoot"
- **Authorization**: "Unauthorized" or "WrongDepositor"

### Known Issues

1. **AToken Errors**: Creating multiple pools rapidly causes "Provided owner is not allowed" errors
   - **Solution**: Share one pool across tests, create fresh users per test

2. **Fake Commitment Generation**: Need proper way to generate commitments that won't be in tree
   - **Solution**: Use `generateFakeCommitment()` helper but ensure proper formatting

3. **Circuit-Level Tests**: Some tests require manipulating circuit inputs directly
   - **Solution**: May need lower-level `withdraw()` function instead of `withdrawSimple()`

## Completing the Remaining Tests

### Priority 1: Tests with Implementations (2-3, 5, 8, 9)

These tests have code but need debugging. Steps:

1. Run individual test with `.only` modifier
2. Add more console.log() to see where it fails
3. Check if error is in proof generation or transaction submission
4. Adjust expected error messages based on actual errors

Example:
```javascript
it.only('should reject withdrawal when amount exceeds available', async function() {
    // ... test code ...
});
```

### Priority 2: Documentation-Only Tests (4, 6, 7)

These need full implementation:

**Test 4 - Invalid Tree Depth**:
- Research if circuit validates depth parameter
- May need to generate proof with wrong depth
- Might require lower-level circuit access

**Test 6 - Label Not In ASP**:
- Need to create deposit WITHOUT adding label to ASP
- May require separate deposit/ASP operations
- Consider using lower-level instructions

**Test 7 - Label Removed From ASP**:
- Need ASP tree removal functionality
- Perform partial withdrawal first (establishes membership)
- Remove label from ASP
- Attempt second withdrawal (should fail)

## Security Properties Validated

1. ✅ **Double-Spend Prevention**: Nullifiers can only be used once
2. ⏳ **Root History Validation**: Only known roots accepted
3. ⏳ **Merkle Proof Verification**: Invalid proofs rejected
4. ⏳ **Tree Depth Validation**: Circuit enforces correct depth
5. ⏳ **Value Constraints**: Cannot withdraw more than committed
6. ⏳ **ASP Membership**: Only approved labels can withdraw
7. ⏳ **Temporal ASP Control**: Labels can be revoked
8. ⏳ **Authorization**: Only rightful owners can ragequit
9. ⏳ **State Integrity**: Failures don't corrupt state

## Next Steps

1. **Debug Existing Tests**: Focus on tests 2, 3, 5, 8, 9 which have implementations
2. **Implement Missing Tests**: Complete tests 4, 6, 7 with full logic
3. **Add More Tests**: Consider additional edge cases and attack vectors
4. **Integration**: Run full suite regularly to catch regressions

## References

- Ethereum test comparison: See root `TESTING_STRATEGY.md` (if exists)
- Client library: `@solana-privacy-pools/client`
- Test runner: Modified `test-with-validator.sh` supports Mocha tests
