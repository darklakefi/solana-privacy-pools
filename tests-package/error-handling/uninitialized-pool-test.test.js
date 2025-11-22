/**
 * Uninitialized Pool Test
 *
 * Tests that operations fail on uninitialized pool accounts
 */
const {
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
    SystemProgram,
    Transaction,
} = require('@solana/web3.js');
const {
    WSOL_MINT,
    programKeypair,
    createAndWrapWSol,
    deposit,
    POOL_STATE_SIZE,
} = require('@solana-privacy-pools/client');
const {
    expectTransactionFailure,
} = require('../security/helpers/error-assertions');

describe('Uninitialized Pool Test', function() {
    this.timeout(60000);

    it('should reject deposit on uninitialized pool account', async function() {
        console.log('\n  ⚠️  Test: Uninitialized Pool');

        const connection = new Connection('http://localhost:8899', 'confirmed');
        const user = Keypair.generate();
        await connection.requestAirdrop(user.publicKey, 100 * LAMPORTS_PER_SOL);
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Create an account but DON'T initialize it as a pool
        const uninitializedPool = Keypair.generate();
        const rentExemptBalance = await connection.getMinimumBalanceForRentExemption(POOL_STATE_SIZE);

        const createAccountIx = SystemProgram.createAccount({
            fromPubkey: user.publicKey,
            newAccountPubkey: uninitializedPool.publicKey,
            lamports: rentExemptBalance,
            space: POOL_STATE_SIZE,
            programId: programKeypair.publicKey,
        });

        const tx = new Transaction().add(createAccountIx);
        await connection.sendTransaction(tx, [user, uninitializedPool]);
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Prepare for deposit
        const depositAmount = BigInt(5 * LAMPORTS_PER_SOL);
        await createAndWrapWSol(connection, user, depositAmount);

        // Generate fake scope (pool was never initialized so we don't have real scope)
        const fakeScope = Buffer.from('fake-scope-for-testing-uninitialized-pool');

        // Try to deposit on uninitialized pool
        await expectTransactionFailure(async () => {
            await deposit(
                connection,
                uninitializedPool.publicKey,
                user,
                depositAmount,
                0, // nonce
                fakeScope,
                WSOL_MINT
            );
        }, 'Label mismatch'); // Zero-initialized account has wrong scope, causing label mismatch

        console.log('  ✅ Deposit on uninitialized pool correctly rejected');
    });
});
