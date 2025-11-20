/**
 * Amount Validation Tests
 *
 * Tests that validate withdrawal amount constraints:
 * 1. Prevents over-withdrawal (withdrawing more than available)
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
} = require('./helpers/test-setup');

const {
    expectTransactionFailure,
} = require('./helpers/error-assertions');

describe('Amount Validation Tests', function() {
    this.timeout(120000);

    let context, pool;
    const SMALL = BigInt(1 * LAMPORTS_PER_SOL);
    const MEDIUM = BigInt(5 * LAMPORTS_PER_SOL);
    const LARGE = BigInt(10 * LAMPORTS_PER_SOL);

    // Setup shared pool
    before(async function() {
        context = await setupTestContext();
        pool = await setupPool(context.connection, context.authority);
    });

    describe('Withdrawal Amount Constraints', function() {

        it('should reject withdrawal when amount exceeds available balance', async function() {
            console.log('\n  🔒 Test: Over-Withdrawal Prevention');

            // Create fresh user
            const alice = Keypair.generate();
            await context.connection.requestAirdrop(alice.publicKey, 100 * LAMPORTS_PER_SOL);
            await new Promise(resolve => setTimeout(resolve, 1000));

            // 1. Create deposit with MEDIUM amount
            const deposits = await createDeposits(
                context.connection,
                pool.poolStateAccount,
                [{ user: alice, amount: MEDIUM }],
                pool.scope
            );

            console.log(`  ✓ Deposit created: ${MEDIUM / BigInt(LAMPORTS_PER_SOL)} SOL`);

            // Validate roots
            const { stateTree, aspTree } = await buildMerkleTrees(deposits);
            await validateTreeRoots(context.connection, pool.poolStateAccount, stateTree, aspTree);

            // 2. Attempt to withdraw MORE than deposited (should fail)
            const excessiveAmount = LARGE; // Trying to withdraw 10 SOL from 5 SOL deposit

            console.log(`  ✗ Attempting to withdraw ${excessiveAmount / BigInt(LAMPORTS_PER_SOL)} SOL (more than available)`);

            await expectTransactionFailure(async () => {
                return await withdrawSimple(
                    context.connection,
                    pool.poolStateAccount,
                    alice,
                    deposits[0],
                    deposits,
                    WSOL_MINT,
                    excessiveAmount // More than deposit amount
                );
            }, 'Error in template'); // Circuit constraint failure for withdrawn_value > existing_value

            console.log('  ✓ Over-withdrawal correctly rejected');

            // Validate roots unchanged
            await validateTreeRoots(context.connection, pool.poolStateAccount, stateTree, aspTree);

            // 3. Verify valid withdrawal still works
            const validAmount = SMALL; // 1 SOL < 5 SOL deposit

            console.log(`  ✓ Attempting valid withdrawal of ${validAmount / BigInt(LAMPORTS_PER_SOL)} SOL`);

            const withdrawResult = await withdrawSimple(
                context.connection,
                pool.poolStateAccount,
                alice,
                deposits[0],
                deposits,
                WSOL_MINT,
                validAmount
            );

            console.log('  ✓ Valid withdrawal succeeded');

            // Track new commitment
            const updatedDeposits = [
                ...deposits,
                {
                    commitment: withdrawResult.newCommitment,
                    label: null,
                    value: null,
                }
            ];

            // Validate roots after valid withdrawal
            const { stateTree: newStateTree, aspTree: newAspTree } = await buildMerkleTrees(updatedDeposits);
            await validateTreeRoots(context.connection, pool.poolStateAccount, newStateTree, newAspTree);

            expect(newStateTree.size).to.equal(2); // Original + withdrawal commitment
        });
    });
});
