/**
 * Pool Wind Down Transition Test (P2)
 *
 * Tests pool wind down state transition.
 * Runs in separate file to get fresh validator/ledger.
 */

const { expect } = require('chai');
const { Keypair, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { initializePool, windDownPool, parsePoolState } = require('@solana-privacy-pools/client/pool');
const { WSOL_MINT } = require('@solana-privacy-pools/client/constants');

// Test helpers
const {
    setupTestContext,
} = require('../security/helpers/test-setup');

describe('Pool Wind Down Transition', function() {
    this.timeout(120000);

    let context;

    before(async function() {
        context = await setupTestContext();
    });

    it('should transition pool to wound down state', async function() {
        console.log('\n  🏊 Test: Wind Down Pool');

        const authority = Keypair.generate();
        await context.connection.requestAirdrop(authority.publicKey, 10 * LAMPORTS_PER_SOL);
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Initialize pool
        const pool = await initializePool(context.connection, authority, WSOL_MINT);
        console.log('  ✓ Pool initialized');

        // Verify pool is active
        let poolAccountInfo = await context.connection.getAccountInfo(pool.poolStateAccount);
        let poolState = parsePoolState(poolAccountInfo.data);
        expect(poolState.is_dead).to.equal(0);

        // Wind down the pool
        await windDownPool(context.connection, pool.poolStateAccount, authority);
        console.log('  ✓ Wind down transaction succeeded');

        // Verify pool is wound down
        poolAccountInfo = await context.connection.getAccountInfo(pool.poolStateAccount);
        poolState = parsePoolState(poolAccountInfo.data);
        expect(poolState.is_dead).to.equal(1);

        console.log('  ✓ Pool successfully transitioned to wound down state');
    });
});
