/**
 * Pool State Management Tests (P2)
 *
 * Tests for pool initialization, state transitions, and root history management.
 */

const { expect } = require('chai');
const { Keypair, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { parsePoolState } = require('@solana-privacy-pools/client/pool');

// Test helpers
const {
    setupTestContext,
    setupPool,
    createDeposits,
} = require('../security/helpers/test-setup');

describe('Pool State Management Tests', function() {
    this.timeout(180000);

    let context, pool;

    before(async function() {
        context = await setupTestContext();
        pool = await setupPool(context.connection, context.authority);
    });

    describe('Pool Initialization', function() {

        it('should verify pool is initialized with correct state', async function() {
            console.log('\n  🏊 Test: Pool Initialization State');

            // Verify pool state
            const poolAccountInfo = await context.connection.getAccountInfo(pool.poolStateAccount);
            expect(poolAccountInfo).to.not.be.null;

            const poolState = parsePoolState(poolAccountInfo.data);
            expect(poolState.is_initialized).to.equal(1);
            expect(poolState.is_dead).to.equal(0);

            console.log(`  ✓ Pool initialized: ${pool.poolStateAccount.toBase58()}`);
            console.log(`  ✓ Vault PDA: ${pool.vaultPDA.toBase58()}`);
            console.log(`  ✓ Initial state tree size: ${poolState.stateTree.size}`);
            console.log(`  ✓ Initial ASP tree size: ${poolState.aspTree.size}`);
            console.log('  ✓ Pool state verified');
        });
    });

    describe('Multiple Sequential Deposits', function() {

        it('should handle 10+ sequential deposits from different users', async function() {
            console.log('\n  🏊 Test: Multiple Sequential Deposits');

            // Create 12 users
            const numUsers = 12;
            const users = [];
            for (let i = 0; i < numUsers; i++) {
                const user = Keypair.generate();
                await context.connection.requestAirdrop(user.publicKey, 100 * LAMPORTS_PER_SOL);
                users.push(user);
            }
            await new Promise(resolve => setTimeout(resolve, 2000));
            console.log(`  ✓ Created ${numUsers} users`);

            // Get initial pool state
            let poolAccountInfo = await context.connection.getAccountInfo(pool.poolStateAccount);
            let poolState = parsePoolState(poolAccountInfo.data);
            const initialSize = poolState.stateTree.size;

            // Create deposits sequentially (in batches to avoid rate limits)
            const batchSize = 3;
            let totalDeposits = 0;

            for (let i = 0; i < numUsers; i += batchSize) {
                const batch = users.slice(i, Math.min(i + batchSize, numUsers));
                const deposits = await createDeposits(
                    context.connection,
                    pool.poolStateAccount,
                    batch.map((user, idx) => ({ user, amount: BigInt((i + idx + 1) * LAMPORTS_PER_SOL) })),
                    pool.scope
                );
                totalDeposits += deposits.length;
                console.log(`  ✓ Batch ${Math.floor(i / batchSize) + 1}: ${deposits.length} deposits created (total: ${totalDeposits})`);

                // Small delay between batches
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            // Verify final pool state
            poolAccountInfo = await context.connection.getAccountInfo(pool.poolStateAccount);
            poolState = parsePoolState(poolAccountInfo.data);

            expect(poolState.stateTree.size).to.equal(initialSize + numUsers);
            expect(poolState.aspTree.size).to.equal(poolState.stateTree.size); // ASP size should match

            console.log(`  ✓ All ${numUsers} deposits succeeded`);
            console.log(`  ✓ State tree size increased from ${initialSize} to ${poolState.stateTree.size}`);
        });
    });

    describe('Nonce Management', function() {

        it('should increment nonce correctly per deposit', async function() {
            console.log('\n  🏊 Test: Nonce Increments');

            // Check initial nonce
            let poolAccountInfo = await context.connection.getAccountInfo(pool.poolStateAccount);
            let poolState = parsePoolState(poolAccountInfo.data);
            const initialNonce = poolState.nonce;

            console.log(`  ✓ Initial nonce: ${initialNonce}`);

            // Create 3 deposits
            const numDeposits = 3;
            const users = [];
            for (let i = 0; i < numDeposits; i++) {
                const user = Keypair.generate();
                await context.connection.requestAirdrop(user.publicKey, 100 * LAMPORTS_PER_SOL);
                users.push(user);
            }
            await new Promise(resolve => setTimeout(resolve, 1000));

            await createDeposits(
                context.connection,
                pool.poolStateAccount,
                users.map(user => ({ user, amount: BigInt(1 * LAMPORTS_PER_SOL) })),
                pool.scope
            );

            // Check final nonce
            poolAccountInfo = await context.connection.getAccountInfo(pool.poolStateAccount);
            poolState = parsePoolState(poolAccountInfo.data);
            const finalNonce = poolState.nonce;

            console.log(`  ✓ Final nonce: ${finalNonce}`);
            console.log(`  ✓ Nonce increment: ${finalNonce - initialNonce}`);

            // Nonce should have incremented by number of deposits
            expect(finalNonce).to.equal(initialNonce + numDeposits);

            console.log('  ✓ Nonce increments correctly');
        });
    });
});
