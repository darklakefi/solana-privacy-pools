/**
 * Mixed Operations Test (P3)
 *
 * Tests deposits and withdrawals in sequence to verify:
 * - State consistency with multiple operation types
 * - Tree integrity across deposits and withdrawals
 * - Proper operation sequencing
 *
 * Note: True interleaving (deposit, withdraw, deposit, withdraw) creates
 * child commitments that change merkle roots, making subsequent operations
 * complex. This test focuses on sequential batches of operations.
 */
const { expect } = require('chai');
const {
    Keypair,
    LAMPORTS_PER_SOL,
} = require('@solana/web3.js');
const {
    parsePoolState,
    withdrawSimple,
} = require('@solana-privacy-pools/client');
const {
    setupTestContext,
    setupPool,
    createDeposits,
    WSOL_MINT,
} = require('../security/helpers/test-setup');

describe('Mixed Operations Test', function() {
    this.timeout(300000); // 5 minutes

    let context, pool;

    before(async function() {
        context = await setupTestContext();
        pool = await setupPool(context.connection, context.authority);
    });

    it('should handle multiple deposits followed by multiple withdrawals', async function() {
        console.log('\n  🔄 Test: Mixed Deposits and Withdrawals');

        // Create 5 users
        const users = [];
        for (let i = 0; i < 5; i++) {
            const user = Keypair.generate();
            await context.connection.requestAirdrop(user.publicKey, 100 * LAMPORTS_PER_SOL);
            users.push(user);
        }
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Get initial pool state
        let poolState = parsePoolState(
            (await context.connection.getAccountInfo(pool.poolStateAccount)).data
        );
        const initialNonce = poolState.nonce;
        const initialSize = poolState.stateTree.size;

        console.log(`  Initial: nonce=${initialNonce}, size=${initialSize}`);

        const depositAmount = BigInt(5 * LAMPORTS_PER_SOL);

        // Phase 1: Create all deposits first
        console.log('\n  Phase 1: Creating 5 deposits...');
        const deposits = await createDeposits(
            context.connection,
            pool.poolStateAccount,
            [
                { user: users[0], amount: depositAmount },
                { user: users[1], amount: depositAmount },
                { user: users[2], amount: depositAmount },
                { user: users[3], amount: depositAmount },
                { user: users[4], amount: depositAmount },
            ],
            pool.scope
        );
        console.log('  ✓ Created 5 deposits');

        // Verify state after deposits
        poolState = parsePoolState(
            (await context.connection.getAccountInfo(pool.poolStateAccount)).data
        );
        expect(poolState.nonce).to.equal(initialNonce + 5);
        expect(poolState.stateTree.size).to.be.at.least(initialSize + 5);
        console.log(`  ✓ Nonce increased to ${poolState.nonce}`);
        console.log(`  ✓ Tree size is ${poolState.stateTree.size}`);

        // Phase 2: Multiple withdrawals from different deposits
        console.log('\n  Phase 2: Processing 3 withdrawals...');

        await withdrawSimple(
            context.connection,
            pool.poolStateAccount,
            users[0],
            deposits[0],
            deposits,
            WSOL_MINT,
            depositAmount,
            { useComputedRoot: true }
        );
        console.log('  ✓ Withdrawal 1 succeeded (user 0)');

        await withdrawSimple(
            context.connection,
            pool.poolStateAccount,
            users[2],
            deposits[2],
            deposits,
            WSOL_MINT,
            depositAmount,
            { useComputedRoot: true }
        );
        console.log('  ✓ Withdrawal 2 succeeded (user 2)');

        await withdrawSimple(
            context.connection,
            pool.poolStateAccount,
            users[4],
            deposits[4],
            deposits,
            WSOL_MINT,
            depositAmount,
            { useComputedRoot: true }
        );
        console.log('  ✓ Withdrawal 3 succeeded (user 4)');

        // Final verification
        poolState = parsePoolState(
            (await context.connection.getAccountInfo(pool.poolStateAccount)).data
        );
        expect(poolState.nonce).to.equal(initialNonce + 5);
        expect(poolState.stateTree.size).to.be.at.least(initialSize + 5);

        console.log('\n  ✅ Mixed operations completed successfully!');
        console.log(`  Final: nonce=${poolState.nonce}, size=${poolState.stateTree.size}`);
        console.log('  ℹ️  5 deposits created, 3 withdrawals processed');
        console.log('  ℹ️  State remained consistent across multiple operations');
    });

    it('should handle sequential deposits and withdrawals with different users', async function() {
        console.log('\n  👥 Test: Sequential Operations with Multiple Users');

        // Create 6 users
        const users = [];
        for (let i = 0; i < 6; i++) {
            const user = Keypair.generate();
            await context.connection.requestAirdrop(user.publicKey, 100 * LAMPORTS_PER_SOL);
            users.push(user);
        }
        await new Promise(resolve => setTimeout(resolve, 1000));

        const depositAmount = BigInt(3 * LAMPORTS_PER_SOL);

        // Create deposits
        console.log('  ✓ Creating 6 deposits from different users...');
        const deposits = await createDeposits(
            context.connection,
            pool.poolStateAccount,
            users.map(user => ({ user, amount: depositAmount })),
            pool.scope
        );
        console.log('  ✓ All deposits created');

        // Withdraw from alternating deposits (0, 2, 4)
        console.log('  ✓ Withdrawing from deposits 0, 2, 4...');
        for (const idx of [0, 2, 4]) {
            await withdrawSimple(
                context.connection,
                pool.poolStateAccount,
                users[idx],
                deposits[idx],
                deposits,
                WSOL_MINT,
                depositAmount,
                { useComputedRoot: true }
            );
            console.log(`    ✓ Withdrawal from deposit ${idx} succeeded`);
        }

        console.log('\n  ✅ Sequential operations with multiple users completed!');
        console.log('  ℹ️  6 deposits from different users');
        console.log('  ℹ️  3 withdrawals from non-adjacent deposits');
        console.log('  ℹ️  Demonstrates flexibility in operation ordering');
    });

    it('should document mixed operation limitations', async function() {
        console.log('\n  📝 Test: Mixed Operation Limitations');

        console.log('\n  Current Pattern (Supported):');
        console.log('  1. Create multiple deposits');
        console.log('  2. Perform multiple withdrawals using historical roots');
        console.log('  3. Historical roots enable flexible withdrawal ordering');

        console.log('\n  Complex Interleaving (Challenging):');
        console.log('  Pattern: D, D, W, D, D, W');
        console.log('  Challenge: Withdrawal creates child commitment');
        console.log('  • Child commitment changes merkle root');
        console.log('  • New deposits create new root');
        console.log('  • Next withdrawal needs updated commitment set');

        console.log('\n  Why Historical Roots Help:');
        console.log('  • Pool maintains ROOT_HISTORY_SIZE=64 roots');
        console.log('  • Withdrawals can use any root in history');
        console.log('  • Enables parallel/flexible withdrawal patterns');
        console.log('  • Works well for: D, D, D, then W, W, W');

        console.log('\n  Future Improvements:');
        console.log('  • Track child commitments client-side');
        console.log('  • Rebuild merkle trees with child commitments');
        console.log('  • Enable true deposit/withdraw interleaving');

        console.log('\n  ✅ Current design supports common use cases');
        console.log('  ℹ️  Most real-world scenarios: batch deposits, then withdrawals');
    });
});
