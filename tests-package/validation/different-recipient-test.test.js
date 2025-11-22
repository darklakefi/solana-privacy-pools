/**
 * Different Recipient Test
 *
 * Tests that withdrawals can be sent to different recipient addresses
 */
const { expect } = require('chai');
const {
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
    Transaction,
    ComputeBudgetProgram,
    sendAndConfirmTransaction,
} = require('@solana/web3.js');
const {
    getAssociatedTokenAddress,
    createAssociatedTokenAccountInstruction,
} = require('@solana/spl-token');
const {
    WSOL_MINT,
    initializePool,
    createAndWrapWSol,
    deposit,
    parsePoolState,
} = require('@solana-privacy-pools/client');
const { buildMerkleTrees, validateTreeRoots } = require('@solana-privacy-pools/client/merkle');
const {
    expectTransactionSuccess,
} = require('../security/helpers/error-assertions');
const { buildWithdrawalInstruction } = require('../security/helpers/withdrawal-builder');

describe('Different Recipient Test', function() {
    this.timeout(120000);

    let context;
    let pool;
    let alice;
    let bob;

    before(async function() {
        const connection = new Connection('http://localhost:8899', 'confirmed');
        const authority = Keypair.generate();
        alice = Keypair.generate();
        bob = Keypair.generate();

        // Fund accounts
        await connection.requestAirdrop(authority.publicKey, 100 * LAMPORTS_PER_SOL);
        await connection.requestAirdrop(alice.publicKey, 100 * LAMPORTS_PER_SOL);
        await connection.requestAirdrop(bob.publicKey, 100 * LAMPORTS_PER_SOL);
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Initialize pool
        pool = await initializePool(connection, authority, WSOL_MINT);

        context = { connection };
    });

    it('should allow withdrawal to different recipient address', async function() {
        console.log('\n  💸 Test: Withdrawal to Different Recipient');

        // Create deposit from Alice
        const depositAmount = BigInt(10 * LAMPORTS_PER_SOL);
        await createAndWrapWSol(context.connection, alice, depositAmount);

        const poolState = parsePoolState(
            (await context.connection.getAccountInfo(pool.poolStateAccount)).data
        );
        const currentNonce = poolState.nonce;

        const depositResult = await deposit(
            context.connection,
            pool.poolStateAccount,
            alice,
            depositAmount,
            currentNonce,
            pool.scope,
            WSOL_MINT
        );

        const depositInfo = {
            commitment: depositResult.commitment,
            value: depositResult.value,  // Use value from depositResult
            label: depositResult.label,
            nullifier: depositResult.nullifier,
            secret: depositResult.secret,
            nullifierHash: depositResult.nullifierHash,
            depositorState: depositResult.depositorState,
        };

        // Create Bob's token account if it doesn't exist
        const bobTokenAccount = await getAssociatedTokenAddress(WSOL_MINT, bob.publicKey);
        const bobAccountInfo = await context.connection.getAccountInfo(bobTokenAccount);

        if (!bobAccountInfo) {
            console.log('  Creating Bob\'s token account...');
            const createAtaIx = createAssociatedTokenAccountInstruction(
                alice.publicKey, // Payer
                bobTokenAccount,
                bob.publicKey, // Owner
                WSOL_MINT
            );
            const createTx = new Transaction().add(createAtaIx);
            await sendAndConfirmTransaction(context.connection, createTx, [alice]);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // Get Bob's initial balance
        let bobInitialBalance = 0n;
        const bobTokenInfo = await context.connection.getAccountInfo(bobTokenAccount);
        if (bobTokenInfo) {
            // Parse token account balance (amount is at offset 64, 8 bytes, little-endian)
            const balanceBytes = bobTokenInfo.data.slice(64, 72);
            bobInitialBalance = balanceBytes.readBigUInt64LE(0);
        }
        console.log(`  Initial Bob balance: ${bobInitialBalance} lamports`);

        // Build trees and generate proof for withdrawal TO BOB
        const deposits = [depositInfo];
        const { stateTree, aspTree } = await buildMerkleTrees(deposits);
        await validateTreeRoots(context.connection, pool.poolStateAccount, stateTree, aspTree);

        const withdrawAmount = BigInt(5 * LAMPORTS_PER_SOL);

        // Build withdrawal instruction with Bob as recipient (not Alice!)
        const withdrawIx = await buildWithdrawalInstruction({
            poolStateAccount: pool.poolStateAccount,
            user: alice, // Alice signs the transaction
            recipientTokenAccount: bobTokenAccount, // But Bob receives the funds
            scope: pool.scope,
            mint: WSOL_MINT,
            depositInfo,
            allDeposits: deposits,
            withdrawAmount,
        });

        // Execute withdrawal
        await expectTransactionSuccess(async () => {
            const tx = new Transaction()
                .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }))
                .add(withdrawIx);
            return await sendAndConfirmTransaction(context.connection, tx, [alice]);
        });

        // Verify Bob received the tokens
        await new Promise(resolve => setTimeout(resolve, 1000));
        const bobFinalTokenInfo = await context.connection.getAccountInfo(bobTokenAccount);
        expect(bobFinalTokenInfo).to.exist;

        const balanceBytes = bobFinalTokenInfo.data.slice(64, 72);
        const bobFinalBalance = balanceBytes.readBigUInt64LE(0);

        console.log(`  Final Bob balance: ${bobFinalBalance} lamports`);
        console.log(`  Expected increase: ${withdrawAmount} lamports`);

        expect(bobFinalBalance - bobInitialBalance).to.equal(withdrawAmount);
        console.log('  ✅ Withdrawal to different recipient successful');
    });
});
