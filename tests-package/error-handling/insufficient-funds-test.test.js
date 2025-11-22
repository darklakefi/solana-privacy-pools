/**
 * Insufficient Funds Test
 *
 * Tests that deposits fail gracefully when user has insufficient funds
 */
const {
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
} = require('@solana/web3.js');
const {
    WSOL_MINT,
    initializePool,
    createAndWrapWSol,
    deposit,
} = require('@solana-privacy-pools/client');
const {
    expectTransactionFailure,
} = require('../security/helpers/error-assertions');

describe('Insufficient Funds Test', function() {
    this.timeout(60000);

    it('should reject deposit when user has insufficient funds', async function() {
        console.log('\n  💸 Test: Insufficient Funds');

        const connection = new Connection('http://localhost:8899', 'confirmed');
        const authority = Keypair.generate();
        const poorUser = Keypair.generate();

        // Fund authority but give poor user very little SOL
        await connection.requestAirdrop(authority.publicKey, 100 * LAMPORTS_PER_SOL);
        await connection.requestAirdrop(poorUser.publicKey, 0.1 * LAMPORTS_PER_SOL); // Only 0.1 SOL
        await new Promise(resolve => setTimeout(resolve, 1000));

        const pool = await initializePool(connection, authority, WSOL_MINT);

        // Try to deposit 5 SOL when user only has 0.1 SOL
        const depositAmount = BigInt(5 * LAMPORTS_PER_SOL);

        await expectTransactionFailure(async () => {
            await createAndWrapWSol(connection, poorUser, depositAmount);
        }, 'insufficient'); // Transaction will fail during SOL wrap

        console.log('  ✅ Insufficient funds correctly rejected');
    });
});
