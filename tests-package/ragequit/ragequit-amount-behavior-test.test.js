/**
 * Ragequit Amount Behavior Test
 *
 * Tests that ragequit allows any amount (by design - transparent emergency exit)
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
    windDownPool,
} = require('@solana-privacy-pools/client');
const { createDeposits } = require('../security/helpers/test-setup');

describe('Ragequit Amount Behavior Test', function() {
    this.timeout(120000);

    it('should allow ragequit with any amount (by design - transparent exit)', async function() {
        console.log('\n  💥 Test: Ragequit Any Amount');

        const connection = new Connection('http://localhost:8899', 'confirmed');
        const authority = Keypair.generate();
        const user = Keypair.generate();
        await connection.requestAirdrop(authority.publicKey, 100 * LAMPORTS_PER_SOL);
        await connection.requestAirdrop(user.publicKey, 100 * LAMPORTS_PER_SOL);
        await new Promise(resolve => setTimeout(resolve, 1000));

        const pool = await initializePool(connection, authority, WSOL_MINT);

        // Create deposit of 5 SOL
        const depositAmount = BigInt(5 * LAMPORTS_PER_SOL);
        const deposits = await createDeposits(
            connection,
            pool.poolStateAccount,
            [{ user, amount: depositAmount }],
            pool.scope
        );

        // Wind down pool
        await windDownPool(connection, pool.poolStateAccount, authority);

        // Ragequit with DIFFERENT amount (3 SOL instead of 5 SOL)
        // This is allowed by design - ragequit is a transparent emergency exit
        const differentAmount = BigInt(3 * LAMPORTS_PER_SOL);
        const depositInfo = deposits[0];

        // Should succeed - ragequit doesn't validate amounts
        await ragequit(
            connection,
            pool.poolStateAccount,
            depositInfo.depositorState,
            user,
            differentAmount,
            WSOL_MINT
        );

        console.log('  ✅ Ragequit with different amount succeeded (expected - no validation)');
        console.log('  📝 Note: Ragequit is intentionally transparent, no ZK proof required');
    });
});
