/**
 * Ragequit Active Pool Test
 *
 * Tests that ragequit fails on active (non-wound-down) pools
 */
const {
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
} = require('@solana/web3.js');
const {
    WSOL_MINT,
    initializePool,
    ragequit,
} = require('@solana-privacy-pools/client');
const { createDeposits } = require('../security/helpers/test-setup');
const {
    expectTransactionFailure,
} = require('../security/helpers/error-assertions');

describe('Ragequit Active Pool Test', function() {
    this.timeout(120000);

    it('should reject ragequit on active (non-wound-down) pool', async function() {
        console.log('\n  ⚠️  Test: Ragequit on Active Pool');

        const connection = new Connection('http://localhost:8899', 'confirmed');
        const authority = Keypair.generate();
        const user = Keypair.generate();
        await connection.requestAirdrop(authority.publicKey, 100 * LAMPORTS_PER_SOL);
        await connection.requestAirdrop(user.publicKey, 100 * LAMPORTS_PER_SOL);
        await new Promise(resolve => setTimeout(resolve, 1000));

        const pool = await initializePool(connection, authority, WSOL_MINT);

        // Create deposit
        const depositAmount = BigInt(5 * LAMPORTS_PER_SOL);
        const deposits = await createDeposits(
            connection,
            pool.poolStateAccount,
            [{ user, amount: depositAmount }],
            pool.scope
        );

        // DO NOT wind down pool - it's still active

        // Attempt ragequit on active pool
        const depositInfo = deposits[0];

        await expectTransactionFailure(async () => {
            await ragequit(
                connection,
                pool.poolStateAccount,
                depositInfo.depositorState,
                user,
                depositAmount,
                WSOL_MINT
            );
        }, 'Pool is not dead');

        console.log('  ✅ Ragequit on active pool correctly rejected');
    });
});
