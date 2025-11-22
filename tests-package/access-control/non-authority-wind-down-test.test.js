/**
 * Non-Authority Wind Down Test
 *
 * Tests that only the pool authority can wind down the pool
 */
const {
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
} = require('@solana/web3.js');
const {
    WSOL_MINT,
    initializePool,
    windDownPool,
} = require('@solana-privacy-pools/client');
const {
    expectTransactionFailure,
} = require('../security/helpers/error-assertions');

describe('Non-Authority Wind Down Test', function() {
    this.timeout(60000);

    it('should reject wind down attempt from non-authority', async function() {
        console.log('\n  🔒 Test: Non-Authority Wind Down');

        const connection = new Connection('http://localhost:8899', 'confirmed');

        // Create authority and attacker
        const authority = Keypair.generate();
        const attacker = Keypair.generate();

        await connection.requestAirdrop(authority.publicKey, 100 * LAMPORTS_PER_SOL);
        await connection.requestAirdrop(attacker.publicKey, 100 * LAMPORTS_PER_SOL);
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Initialize pool with authority
        const pool = await initializePool(connection, authority, WSOL_MINT);

        // Attempt to wind down with non-authority (attacker)
        await expectTransactionFailure(async () => {
            await windDownPool(connection, pool.poolStateAccount, attacker);
        }, 'Only entrypoint can wind down pool');

        console.log('  ✅ Non-authority wind down correctly rejected');
    });
});
