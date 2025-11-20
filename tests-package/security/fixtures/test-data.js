/**
 * Test fixtures and constants
 */
const { LAMPORTS_PER_SOL } = require('@solana/web3.js');

/**
 * Standard test deposit amounts
 */
const TEST_AMOUNTS = {
    SMALL: BigInt(1 * LAMPORTS_PER_SOL),
    MEDIUM: BigInt(2 * LAMPORTS_PER_SOL),
    LARGE: BigInt(5 * LAMPORTS_PER_SOL),
    HUGE: BigInt(10 * LAMPORTS_PER_SOL),
};

/**
 * Test tree depths
 */
const TEST_TREE_DEPTHS = {
    SMALL: 3,  // Max 8 elements
    MEDIUM: 10, // Max 1024 elements
    LARGE: 20,  // Max 1M elements
};

/**
 * Test nonces for deposits
 */
const TEST_NONCES = {
    ALICE: 0,
    BOB: 1,
    CHARLIE: 2,
    ATTACKER: 99,
};

/**
 * Test contexts for withdrawals
 */
const TEST_CONTEXTS = {
    DEFAULT: 0n,
    CUSTOM: 123456789n,
};

/**
 * Expected error patterns from the program
 * These match the error strings in src/lib.rs
 */
const EXPECTED_ERRORS = {
    NULLIFIER_SPENT: 'NullifierAlreadySpent',
    INVALID_PROOF: 'Groth16VerificationFailed',
    INVALID_ROOT: 'InvalidRoot',
    UNAUTHORIZED: 'Unauthorized',
    POOL_NOT_WOUND_DOWN: 'PoolNotWoundDown',
    WRONG_DEPOSITOR: 'WrongDepositor',
    INSUFFICIENT_FUNDS: 'InsufficientFunds',
};

module.exports = {
    TEST_AMOUNTS,
    TEST_TREE_DEPTHS,
    TEST_NONCES,
    TEST_CONTEXTS,
    EXPECTED_ERRORS,
};
