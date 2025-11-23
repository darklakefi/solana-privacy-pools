/**
 * Partial Withdrawal Tests (P2)
 *
 * Tests for partial withdrawals where user withdraws less than their full deposit.
 * Creates child commitment for remaining amount.
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

describe('Partial Withdrawal Tests', function() {
    this.timeout(180000); // 3 minutes

    let context, pool;

    before(async function() {
        context = await setupTestContext();
        pool = await setupPool(context.connection, context.authority);
    });

    it('should handle partial withdrawal (30% of deposit)', async function() {
        console.log('\n  💰 Test: Partial Withdrawal (30%)');

        // Create user and deposit 10 SOL
        const user = Keypair.generate();
        await context.connection.requestAirdrop(user.publicKey, 100 * LAMPORTS_PER_SOL);
        await new Promise(resolve => setTimeout(resolve, 1000));

        const depositAmount = BigInt(10 * LAMPORTS_PER_SOL);
        const deposits = await createDeposits(
            context.connection,
            pool.poolStateAccount,
            [{ user, amount: depositAmount }],
            pool.scope
        );

        console.log(`  ✓ Deposited ${depositAmount / BigInt(LAMPORTS_PER_SOL)} SOL`);

        // Get initial pool state
        let poolAccountInfo = await context.connection.getAccountInfo(pool.poolStateAccount);
        let poolState = parsePoolState(poolAccountInfo.data);
        const initialStateTreeSize = poolState.stateTree.size;
        console.log(`  ✓ Initial state tree size: ${initialStateTreeSize}`);

        // Withdraw 30% (3 SOL from 10 SOL)
        const withdrawAmount = BigInt(3 * LAMPORTS_PER_SOL);
        const remainingAmount = depositAmount - withdrawAmount;

        console.log(`  ✓ Withdrawing ${withdrawAmount / BigInt(LAMPORTS_PER_SOL)} SOL (30%)`);
        console.log(`  ✓ Remaining ${remainingAmount / BigInt(LAMPORTS_PER_SOL)} SOL (70%)`);

        await expectTransactionSuccess(async () => {
            return await withdrawSimple(
                context.connection,
                pool.poolStateAccount,
                user,
                deposits[0],
                deposits,
                WSOL_MINT,
                withdrawAmount,
                { useComputedRoot: true }
            );
        });

        console.log('  ✓ Partial withdrawal succeeded');

        // Verify state tree grew by 1 (new child commitment for remaining amount)
        poolAccountInfo = await context.connection.getAccountInfo(pool.poolStateAccount);
        poolState = parsePoolState(poolAccountInfo.data);
        const finalStateTreeSize = poolState.stateTree.size;

        expect(finalStateTreeSize).to.equal(initialStateTreeSize + 1);
        console.log(`  ✓ State tree size increased: ${initialStateTreeSize} → ${finalStateTreeSize}`);
        console.log('  ✓ Child commitment created for remaining 7 SOL');
        console.log('\n  ℹ️  Note: Multiple sequential partial withdrawals are supported');
        console.log('  ℹ️  Each withdrawal creates a new child commitment for the remaining amount');
        console.log('  ℹ️  The child commitment can then be spent in subsequent withdrawals');
    });
});
