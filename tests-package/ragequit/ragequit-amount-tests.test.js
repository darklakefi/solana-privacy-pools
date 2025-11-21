/**
 * Ragequit Amount Validation Tests (P2)
 *
 * Tests that ragequit correctly validates withdrawal amounts.
 * Runs in separate file to get fresh validator/ledger (wound down pool needed).
 */

const { expect } = require('chai');
const { Keypair, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { initializePool, windDownPool } = require('@solana-privacy-pools/client/pool');
const { ragequit } = require('@solana-privacy-pools/client/ragequit');
const { WSOL_MINT } = require('@solana-privacy-pools/client/constants');

// Test helpers
const {
    setupTestContext,
    createDeposits,
} = require('../security/helpers/test-setup');

describe('Ragequit Amount Validation', function() {
    this.timeout(120000);

    let context;

    before(async function() {
        context = await setupTestContext();
    });

    it('should allow ragequit with correct amount', async function() {
        console.log('\n  🚪 Test: Ragequit with Correct Amount');

        const authority = Keypair.generate();
        await context.connection.requestAirdrop(authority.publicKey, 10 * LAMPORTS_PER_SOL);
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Initialize pool
        const pool = await initializePool(context.connection, authority, WSOL_MINT);
        console.log('  ✓ Pool initialized');

        // Create deposit
        const user = Keypair.generate();
        await context.connection.requestAirdrop(user.publicKey, 100 * LAMPORTS_PER_SOL);
        await new Promise(resolve => setTimeout(resolve, 1000));

        const depositAmount = BigInt(5 * LAMPORTS_PER_SOL);
        const deposits = await createDeposits(
            context.connection,
            pool.poolStateAccount,
            [{ user, amount: depositAmount }],
            pool.scope
        );

        console.log(`  ✓ Deposited ${depositAmount / BigInt(LAMPORTS_PER_SOL)} SOL`);

        // Wind down pool to allow ragequit
        await windDownPool(context.connection, pool.poolStateAccount, authority);
        console.log('  ✓ Pool wound down');

        // Ragequit with CORRECT amount
        const depositInfo = deposits[0];
        await ragequit(
            context.connection,
            pool.poolStateAccount,
            depositInfo.depositorState,
            user,
            depositAmount, // Correct amount
            WSOL_MINT
        );

        console.log('  ✓ Ragequit succeeded with correct amount');
    });
});
