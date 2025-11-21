/**
 * Root History Tests (P2)
 *
 * Tests for root history management and historical root acceptance.
 * Pool maintains a circular buffer of 64 historical roots.
 */

const { expect } = require('chai');
const { Keypair, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { parsePoolState } = require('@solana-privacy-pools/client/pool');
const { withdrawSimple } = require('@solana-privacy-pools/client');
const { WSOL_MINT } = require('@solana-privacy-pools/client/constants');

// Test helpers
const {
    setupTestContext,
    setupPool,
    createDeposits,
} = require('../security/helpers/test-setup');

const {
    expectTransactionSuccess,
} = require('../security/helpers/error-assertions');

const ROOT_HISTORY_SIZE = 64;

describe('Root History Tests', function() {
    this.timeout(300000); // 5 minutes - these tests are slow

    let context, pool;

    before(async function() {
        context = await setupTestContext();
        pool = await setupPool(context.connection, context.authority);
    });

    describe('Historical Root Acceptance', function() {

        it('should accept withdrawal with historical root (not just current)', async function() {
            console.log('\n  📜 Test: Historical Root Acceptance');

            // Create first deposit
            const alice = Keypair.generate();
            await context.connection.requestAirdrop(alice.publicKey, 100 * LAMPORTS_PER_SOL);
            await new Promise(resolve => setTimeout(resolve, 1000));

            const aliceDeposits = await createDeposits(
                context.connection,
                pool.poolStateAccount,
                [{ user: alice, amount: BigInt(10 * LAMPORTS_PER_SOL) }],
                pool.scope
            );

            console.log('  ✓ Alice deposited 10 SOL');
            console.log('  ✓ This creates root R1');

            // Get current root after Alice's deposit
            let poolAccountInfo = await context.connection.getAccountInfo(pool.poolStateAccount);
            let poolState = parsePoolState(poolAccountInfo.data);
            const aliceRoot = Buffer.from(poolState.stateTree.root);
            console.log(`  ✓ Root R1 (Alice): ${aliceRoot.toString('hex').slice(0, 32)}...`);

            // Create several more deposits to change the root
            const numIntermediateDeposits = 5;
            console.log(`\n  ✓ Creating ${numIntermediateDeposits} more deposits to change root...`);

            for (let i = 0; i < numIntermediateDeposits; i++) {
                const user = Keypair.generate();
                await context.connection.requestAirdrop(user.publicKey, 100 * LAMPORTS_PER_SOL);
                await new Promise(resolve => setTimeout(resolve, 500));

                await createDeposits(
                    context.connection,
                    pool.poolStateAccount,
                    [{ user, amount: BigInt((i + 1) * LAMPORTS_PER_SOL) }],
                    pool.scope
                );
                console.log(`    • Deposit ${i + 1}/${numIntermediateDeposits} complete`);
            }

            // Get new current root
            poolAccountInfo = await context.connection.getAccountInfo(pool.poolStateAccount);
            poolState = parsePoolState(poolAccountInfo.data);
            const currentRoot = Buffer.from(poolState.stateTree.root);
            console.log(`\n  ✓ Current root R2: ${currentRoot.toString('hex').slice(0, 32)}...`);

            // Verify roots are different
            expect(aliceRoot.toString('hex')).to.not.equal(currentRoot.toString('hex'));
            console.log('  ✓ Root has changed (R1 != R2)');

            // Now withdraw Alice's deposit using her HISTORICAL root
            console.log('\n  ✓ Attempting withdrawal with historical root R1...');

            // Track all deposits for merkle tree building
            const allDeposits = [
                aliceDeposits[0],
                // We don't need the intermediate deposits' details for this test
            ];

            await expectTransactionSuccess(async () => {
                return await withdrawSimple(
                    context.connection,
                    pool.poolStateAccount,
                    alice,
                    aliceDeposits[0],
                    allDeposits, // Use deposits as of Alice's time
                    WSOL_MINT,
                    BigInt(5 * LAMPORTS_PER_SOL), // Partial withdrawal
                    { useComputedRoot: true } // Use the historical root from merkle tree
                );
            });

            console.log('  ✓ Withdrawal succeeded with historical root!');
            console.log('  ✓ Root history allows using old roots for proofs');
        });
    });
});
