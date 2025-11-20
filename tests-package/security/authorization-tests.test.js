/**
 * Authorization Tests
 *
 * Tests that validate authorization and access control:
 * 1. Only original depositor can ragequit their deposit
 */

const { expect } = require('chai');
const { LAMPORTS_PER_SOL, Keypair } = require('@solana/web3.js');
const { ragequit, windDownPool } = require('@solana-privacy-pools/client');
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

describe('Authorization Tests', function() {
    this.timeout(120000);

    let context, pool;
    const MEDIUM = BigInt(5 * LAMPORTS_PER_SOL);

    // Setup separate pool for this test (will be wound down)
    before(async function() {
        context = await setupTestContext();
        pool = await setupPool(context.connection, context.authority);
    });

    describe('Ragequit Authorization', function() {

        it('should reject ragequit from wrong depositor', async function() {
            console.log('\n  🔒 Test: Ragequit Authorization Check');

            // Create fresh users
            const alice = Keypair.generate();
            const bob = Keypair.generate();

            await context.connection.requestAirdrop(alice.publicKey, 100 * LAMPORTS_PER_SOL);
            await context.connection.requestAirdrop(bob.publicKey, 100 * LAMPORTS_PER_SOL);
            await new Promise(resolve => setTimeout(resolve, 1000));

            // 1. Alice creates deposit
            const deposits = await createDeposits(
                context.connection,
                pool.poolStateAccount,
                [{ user: alice, amount: MEDIUM }],
                pool.scope
            );

            console.log('  ✓ Alice created deposit');

            // Validate state before winding down
            const { stateTree, aspTree } = await buildMerkleTrees(deposits);
            await validateTreeRoots(context.connection, pool.poolStateAccount, stateTree, aspTree);

            // 2. Wind down pool (enables ragequit)
            await windDownPool(context.connection, pool.poolStateAccount, context.authority);
            console.log('  ✓ Pool wound down (ragequit enabled)');

            // 3. Bob attempts to ragequit Alice's deposit (should fail)
            console.log('  ⚔️  Bob attempting to ragequit Alice\'s deposit...');

            await expectTransactionFailure(
                async () => {
                    return await ragequit(
                        context.connection,
                        pool.poolStateAccount,
                        deposits[0].depositorState, // Alice's depositor state
                        bob, // Wrong user!
                        deposits[0].amount,
                        WSOL_MINT
                    );
                },
                'Not original depositor' // Authorization check in program
            );

            console.log('  ✅ Unauthorized ragequit correctly rejected');

            // 4. Alice ragequits her own deposit (should succeed)
            console.log('  ✓ Alice ragequitting her own deposit...');

            await expectTransactionSuccess(async () => {
                return await ragequit(
                    context.connection,
                    pool.poolStateAccount,
                    deposits[0].depositorState, // Alice's depositor state
                    alice, // Correct user
                    deposits[0].amount,
                    WSOL_MINT
                );
            });

            console.log('  ✅ Authorized ragequit succeeded');
        });

        it('should document ragequit vs ZK withdrawal trade-offs', async function() {
            console.log('\n  📚 Test: Ragequit Design Documentation');

            console.log('\n  Ragequit Design Principles:');
            console.log('  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

            console.log('\n  🔓 Ragequit (Transparent Emergency Exit):');
            console.log('     • No ZK proof required');
            console.log('     • Reveals identity (links to depositor state)');
            console.log('     • Only available after pool wind-down');
            console.log('     • Authorization: original depositor only');
            console.log('     • Use case: Emergency exit, pool shutdown');

            console.log('\n  🔒 ZK Withdrawal (Private Normal Operation):');
            console.log('     • Requires ZK proof');
            console.log('     • Privacy-preserving (no identity linkage)');
            console.log('     • Available during normal operation');
            console.log('     • Authorization: knowledge of secrets');
            console.log('     • Use case: Normal privacy-preserving withdrawals');

            console.log('\n  ⚖️  Trade-off:');
            console.log('     Ragequit sacrifices privacy for simplicity in emergencies');
            console.log('     This is intentional: users who need emergency exit');
            console.log('     accept identity revelation as the cost');

            console.log('\n  ✅ Both mechanisms serve different purposes');

            // This is a documentation test - always passes
            expect(true).to.be.true;
        });
    });
});
