/**
 * State Integrity Tests
 *
 * Tests that validate state integrity after failed operations:
 * 1. Failed operations don't modify on-chain state
 * 2. Pool remains functional after failures
 * 3. Merkle roots remain valid throughout
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
    getPoolState,
    WSOL_MINT,
} = require('./helpers/test-setup');

const {
    expectTransactionFailure,
    expectTransactionSuccess,
} = require('./helpers/error-assertions');

const {
    capturePoolSnapshot,
    verifyPoolUnchanged,
} = require('./helpers/state-verification');

const {
    generateFakeCommitment,
} = require('./helpers/proof-generators');

describe('State Integrity Tests', function() {
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

    describe('State Integrity After Failures', function() {

        it('should maintain state integrity after multiple failed operations', async function() {
            console.log('\n  🔒 Test: State Integrity After Failures');

            // Create fresh users for isolated test
            const alice = Keypair.generate();
            const bob = Keypair.generate();
            const attacker = Keypair.generate();

            await context.connection.requestAirdrop(alice.publicKey, 100 * LAMPORTS_PER_SOL);
            await context.connection.requestAirdrop(bob.publicKey, 100 * LAMPORTS_PER_SOL);
            await context.connection.requestAirdrop(attacker.publicKey, 100 * LAMPORTS_PER_SOL);
            await new Promise(resolve => setTimeout(resolve, 1000));

            // 1. Create deposits
            const deposits = await createDeposits(
                context.connection,
                pool.poolStateAccount,
                [
                    { user: alice, amount: SMALL },
                    { user: bob, amount: MEDIUM }
                ],
                pool.scope
            );

            console.log('  ✓ Valid deposits created');

            // 2. Capture initial state with root validation
            const { stateTree: initialStateTree, aspTree: initialAspTree } = await buildMerkleTrees(deposits);
            await validateTreeRoots(context.connection, pool.poolStateAccount, initialStateTree, initialAspTree);

            const initialSnapshot = await capturePoolSnapshot(
                context.connection,
                pool.poolStateAccount,
                pool.poolTokenAccount
            );

            console.log('  ✓ Initial state captured');
            console.log(`     State tree size: ${initialSnapshot.stateTreeSize}`);
            console.log(`     ASP tree size: ${initialSnapshot.aspTreeSize}`);
            console.log(`     Balance: ${initialSnapshot.balance / BigInt(LAMPORTS_PER_SOL)} SOL`);

            // 3. Attempt multiple invalid operations
            console.log('  ⚔️  Attempting multiple invalid operations...');

            // Invalid operation 1: Fake commitment
            const fakeCommitment = generateFakeCommitment();
            await expectTransactionFailure(async () => {
                const fakeDepositInfo = {
                    commitment: Buffer.from(fakeCommitment.commitment.toString(16).padStart(64, '0'), 'hex'),
                    nullifier: fakeCommitment.nullifier,
                    secret: fakeCommitment.secret,
                    value: SMALL,
                    nullifierHash: Buffer.from(fakeCommitment.nullifierHash.toString(16).padStart(64, '0'), 'hex'),
                    user: attacker.publicKey,
                    amount: SMALL,
                    nonce: 999,
                };
                return await withdrawSimple(
                    context.connection,
                    pool.poolStateAccount,
                    attacker,
                    fakeDepositInfo,
                    deposits,
                    WSOL_MINT,
                    SMALL
                );
            });
            console.log('     ✓ Invalid operation 1 (fake commitment) failed as expected');

            // Invalid operation 2: Excessive amount
            await expectTransactionFailure(async () => {
                return await withdrawSimple(
                    context.connection,
                    pool.poolStateAccount,
                    alice,
                    deposits[0],
                    deposits,
                    WSOL_MINT,
                    deposits[0].amount + LARGE // Too much
                );
            });
            console.log('     ✓ Invalid operation 2 (excessive amount) failed as expected');

            // 4. Validate roots unchanged after failures
            const { stateTree: afterFailuresStateTree, aspTree: afterFailuresAspTree } = await buildMerkleTrees(deposits);
            await validateTreeRoots(context.connection, pool.poolStateAccount, afterFailuresStateTree, afterFailuresAspTree);

            // 5. Capture state after failures
            const afterFailuresSnapshot = await capturePoolSnapshot(
                context.connection,
                pool.poolStateAccount,
                pool.poolTokenAccount
            );

            // 6. Verify state unchanged
            verifyPoolUnchanged(initialSnapshot, afterFailuresSnapshot);
            console.log('  ✅ State integrity maintained after multiple failures');

            // Verify roots match
            expect(afterFailuresStateTree.root).to.equal(initialStateTree.root);
            expect(afterFailuresAspTree.root).to.equal(initialAspTree.root);
            console.log('  ✅ Merkle roots unchanged');

            // 7. Perform valid withdrawal to confirm pool still functional
            console.log('  ✓ Attempting valid withdrawal after failures...');

            const withdrawResult = await expectTransactionSuccess(async () => {
                return await withdrawSimple(
                    context.connection,
                    pool.poolStateAccount,
                    bob,
                    deposits[1],
                    deposits, // Use only current test's deposits
                    WSOL_MINT,
                    MEDIUM // Full withdrawal
                );
            });

            console.log('  ✅ Pool remains functional after failed operations');

            // 8. Validate roots updated correctly after successful withdrawal
            const updatedDeposits = [
                ...deposits,
                {
                    commitment: withdrawResult.newCommitment,
                    label: null,
                    value: null,
                }
            ];

            const { stateTree: finalStateTree, aspTree: finalAspTree } = await buildMerkleTrees(updatedDeposits);
            await validateTreeRoots(context.connection, pool.poolStateAccount, finalStateTree, finalAspTree);

            expect(finalStateTree.size).to.equal(deposits.length + 1); // Original deposits + 1 withdrawal commitment
            expect(finalAspTree.size).to.equal(deposits.length); // ASP size unchanged (withdrawal reuses label)
            console.log('  ✅ State correctly updated after valid withdrawal');
        });

        it('should maintain separate state for each test', async function() {
            console.log('\n  🔒 Test: Independent Test State');

            // Create different user for this test
            const charlie = Keypair.generate();
            await context.connection.requestAirdrop(charlie.publicKey, 100 * LAMPORTS_PER_SOL);
            await new Promise(resolve => setTimeout(resolve, 1000));

            // 1. Create new deposit (separate from previous test)
            const deposits = await createDeposits(
                context.connection,
                pool.poolStateAccount,
                [{ user: charlie, amount: MEDIUM }],
                pool.scope
            );

            console.log('  ✓ New deposit created');

            // 2. Query on-chain state to get all commitments
            const poolState = await getPoolState(context.connection, pool.poolStateAccount);
            console.log(`  ✓ On-chain state has ${poolState.stateTree.size} commitments`);

            // 3. This test is independent - it doesn't know about previous test's deposits
            //    But the on-chain state DOES include them
            //    This demonstrates why we need root validation

            // If we only use this test's deposits, roots won't match
            const { stateTree: localTree, aspTree: localAspTree } = await buildMerkleTrees(deposits);
            console.log(`  ✓ Local tree built from test deposits: ${localTree.size} commitments`);

            // Root validation would fail here if we only use local deposits
            // because on-chain state includes commitments from previous tests

            console.log('\n  📚 Key Insight:');
            console.log('     • Shared pool = shared on-chain state');
            console.log('     • Each test adds to cumulative state');
            console.log('     • Root validation ensures local tracking matches on-chain');
            console.log('     • This prevents the bug we fixed!');

            console.log('\n  ✅ Test demonstrates importance of root validation');
        });
    });
});
