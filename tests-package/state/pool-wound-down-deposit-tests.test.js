/**
 * Wound Down Pool Deposit Test (P2)
 *
 * Tests that deposits are rejected on wound down pools.
 * Runs in separate file to get fresh validator/ledger.
 */

const { expect } = require('chai');
const { Keypair, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { initializePool, windDownPool } = require('@solana-privacy-pools/client/pool');
const { WSOL_MINT } = require('@solana-privacy-pools/client/constants');

// Test helpers
const {
    setupTestContext,
    createDeposits,
} = require('../security/helpers/test-setup');

const {
    expectTransactionFailure,
} = require('../security/helpers/error-assertions');

describe('Wound Down Pool Deposits', function() {
    this.timeout(120000);

    let context;

    before(async function() {
        context = await setupTestContext();
    });

    it('should reject deposits on wound down pool', async function() {
        console.log('\n  🏊 Test: Deposits Fail on Wound Down Pool');

        const authority = Keypair.generate();
        await context.connection.requestAirdrop(authority.publicKey, 10 * LAMPORTS_PER_SOL);
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Initialize and wind down pool
        const pool = await initializePool(context.connection, authority, WSOL_MINT);
        await windDownPool(context.connection, pool.poolStateAccount, authority);
        console.log('  ✓ Pool wound down');

        // Try to deposit (should fail)
        const user = Keypair.generate();
        await context.connection.requestAirdrop(user.publicKey, 100 * LAMPORTS_PER_SOL);
        await new Promise(resolve => setTimeout(resolve, 1000));

        await expectTransactionFailure(async () => {
            await createDeposits(
                context.connection,
                pool.poolStateAccount,
                [{ user, amount: BigInt(1 * LAMPORTS_PER_SOL) }],
                pool.scope
            );
        }, 'Pool is dead'); // Program logs "Pool is dead" when deposit is attempted

        console.log('  ✓ Deposit correctly rejected on wound down pool');
    });
});
