/**
 * Nullifier Security Tests
 *
 * Tests that validate nullifier handling:
 * 1. Prevents double-spend via nullifier reuse
 * 2. Rejects withdrawals with unknown merkle roots
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
    expectTransactionSuccess,
} = require('./helpers/error-assertions');

const {
    generateInvalidRoot,
} = require('./helpers/proof-generators');

describe('Nullifier Security Tests', function() {
    this.timeout(120000);

    let context, pool;
    const SMALL = BigInt(1 * LAMPORTS_PER_SOL);
    const MEDIUM = BigInt(5 * LAMPORTS_PER_SOL);

    // Setup shared pool
    before(async function() {
        context = await setupTestContext();
        pool = await setupPool(context.connection, context.authority);
    });

    describe('Double-Spend Prevention', function() {

        it('should reject withdrawal with nullifier reuse', async function() {
            console.log('\n  🔒 Test: Nullifier Reuse Prevention');

            // Create fresh users for this test
            const alice = Keypair.generate();
            await context.connection.requestAirdrop(alice.publicKey, 100 * LAMPORTS_PER_SOL);
            await new Promise(resolve => setTimeout(resolve, 1000));

            // 1. Create deposit
            const deposits = await createDeposits(
                context.connection,
                pool.poolStateAccount,
                [{ user: alice, amount: MEDIUM }],
                pool.scope
            );

            console.log('  ✓ Deposit created');

            // Validate roots before first withdrawal
            const { stateTree: tree1, aspTree: aspTree1 } = await buildMerkleTrees(deposits);
            await validateTreeRoots(context.connection, pool.poolStateAccount, tree1, aspTree1);

            // 2. First withdrawal (should succeed)
            const withdrawAmount = SMALL;
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

            console.log('  ✓ First withdrawal succeeded');

            // Track new commitment
            const updatedDeposits = [
                ...deposits,
                {
                    commitment: withdrawResult.newCommitment,
                    label: null,
                    value: null,
                }
            ];

            // Validate roots after withdrawal
            const { stateTree: tree2, aspTree: aspTree2 } = await buildMerkleTrees(updatedDeposits);
            await validateTreeRoots(context.connection, pool.poolStateAccount, tree2, aspTree2);

            // 3. Attempt second withdrawal with same nullifier (should fail)
            await expectTransactionFailure(async () => {
                return await withdrawSimple(
                    context.connection,
                    pool.poolStateAccount,
                    alice,
                    deposits[0], // Same deposit = same nullifier
                    updatedDeposits,
                    WSOL_MINT,
                    withdrawAmount
                );
            }, 'NullifierAlreadySpent');

            console.log('  ✓ Second withdrawal rejected (nullifier reuse detected)');

            // Validate roots unchanged after failed withdrawal
            const { stateTree: tree3, aspTree: aspTree3 } = await buildMerkleTrees(updatedDeposits);
            await validateTreeRoots(context.connection, pool.poolStateAccount, tree3, aspTree3);
        });

        it('should reject withdrawal with unknown merkle root', async function() {
            console.log('\n  🔒 Test: Unknown Root Rejection');

            // Create fresh users
            const bob = Keypair.generate();
            await context.connection.requestAirdrop(bob.publicKey, 100 * LAMPORTS_PER_SOL);
            await new Promise(resolve => setTimeout(resolve, 1000));

            // 1. Create deposit
            const deposits = await createDeposits(
                context.connection,
                pool.poolStateAccount,
                [{ user: bob, amount: MEDIUM }],
                pool.scope
            );

            console.log('  ✓ Deposit created');

            // Validate roots
            const { stateTree, aspTree } = await buildMerkleTrees(deposits);
            await validateTreeRoots(context.connection, pool.poolStateAccount, stateTree, aspTree);

            // 2. Create fake deposits array with invalid root
            const fakeDeposits = [
                {
                    ...deposits[0],
                    commitment: generateInvalidRoot(), // This will create wrong merkle root
                }
            ];

            console.log('  ✓ Generated fake deposit with invalid root');

            // 3. Attempt withdrawal with fake root (should fail)
            await expectTransactionFailure(async () => {
                return await withdrawSimple(
                    context.connection,
                    pool.poolStateAccount,
                    bob,
                    deposits[0], // Real deposit
                    fakeDeposits, // Fake deposits array → wrong root
                    WSOL_MINT,
                    SMALL
                );
            }, 'InvalidMerkleRoot');

            console.log('  ✓ Withdrawal with unknown root rejected');

            // Validate roots unchanged
            await validateTreeRoots(context.connection, pool.poolStateAccount, stateTree, aspTree);
        });
    });
});
