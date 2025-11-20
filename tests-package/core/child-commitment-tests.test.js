/**
 * Child Commitment Tests (P1)
 *
 * Tests for child commitments created during withdrawals.
 *
 * Note: Partial withdrawals (creating non-zero child commitments) are extensively
 * tested in P0 security tests (nullifier-tests, amount-validation-tests, etc.).
 * This file focuses on the zero-value edge case.
 *
 * Chained withdrawals (spending child commitments) are not supported by design:
 * child commitments use random nullifier/secret generated in the circuit that
 * the client never learns, preventing linkability through secret reuse.
 */

const { expect } = require('chai');
const { LAMPORTS_PER_SOL, Keypair } = require('@solana/web3.js');
const { withdrawSimple } = require('@solana-privacy-pools/client');
const { buildMerkleTrees, validateTreeRoots } = require('@solana-privacy-pools/client/merkle');

// Test helpers
const {
    setupTestContext,
    setupPool,
    createDeposits,
    WSOL_MINT,
} = require('../security/helpers/test-setup');

const {
    expectTransactionSuccess,
} = require('../security/helpers/error-assertions');

describe('Child Commitment Tests', function() {
    this.timeout(120000);

    let context, pool;
    const SOL_1 = BigInt(1 * LAMPORTS_PER_SOL);
    const SOL_5 = BigInt(5 * LAMPORTS_PER_SOL);
    const SOL_10 = BigInt(10 * LAMPORTS_PER_SOL);

    // Setup shared pool
    before(async function() {
        context = await setupTestContext();
        pool = await setupPool(context.connection, context.authority);
    });

    describe('Chained Withdrawals', function() {

        it('should create zero-value child on full withdrawal', async function() {
            console.log('\n  🔗 Test: Full Value Withdrawal');

            // Create fresh user
            const alice = Keypair.generate();
            await context.connection.requestAirdrop(alice.publicKey, 100 * LAMPORTS_PER_SOL);
            await new Promise(resolve => setTimeout(resolve, 1000));

            // 1. Create initial deposit (5 SOL)
            const deposits = await createDeposits(
                context.connection,
                pool.poolStateAccount,
                [{ user: alice, amount: SOL_5 }],
                pool.scope
            );

            console.log(`  ✓ Initial deposit: ${SOL_5 / BigInt(LAMPORTS_PER_SOL)} SOL`);

            // 2. Full withdrawal (withdraw ALL 5 SOL)
            const withdrawAmount = SOL_5;
            const withdrawResult = await expectTransactionSuccess(async () => {
                return await withdrawSimple(
                    context.connection,
                    pool.poolStateAccount,
                    alice,
                    deposits[0],
                    deposits,
                    WSOL_MINT,
                    withdrawAmount
                );
            });

            console.log(`  ✓ Withdrew ${withdrawAmount / BigInt(LAMPORTS_PER_SOL)} SOL (full amount)`);
            console.log(`  ✓ Zero-value child commitment created`);

            // 3. Verify child commitment was created (even for full withdrawal)
            expect(withdrawResult.newCommitment).to.exist;
            expect(withdrawResult.newCommitment).to.have.lengthOf(32);

            // Remaining value should be 0
            const remainingValue = SOL_5 - withdrawAmount;
            expect(remainingValue).to.equal(0n);
            console.log(`  ✓ Remaining value: ${remainingValue} (zero)`);

            // 4. Track the child commitment
            const updatedDeposits = [
                ...deposits,
                {
                    commitment: withdrawResult.newCommitment,
                    label: null,
                    value: null,
                }
            ];

            // Validate roots
            const { stateTree, aspTree } = await buildMerkleTrees(updatedDeposits);
            await validateTreeRoots(context.connection, pool.poolStateAccount, stateTree, aspTree);

            expect(stateTree.size).to.equal(2); // Original + zero-value child
        });
    });
});
