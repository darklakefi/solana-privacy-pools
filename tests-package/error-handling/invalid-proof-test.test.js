/**
 * Invalid Proof Test
 *
 * Tests that withdrawals with malformed proof bytes are rejected
 */
const {
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
    Transaction,
    TransactionInstruction,
    SystemProgram,
    ComputeBudgetProgram,
    sendAndConfirmTransaction,
} = require('@solana/web3.js');
const {
    getAssociatedTokenAddress,
    TOKEN_PROGRAM_ID,
} = require('@solana/spl-token');
const {
    WSOL_MINT,
    programKeypair,
    initializePool,
    getVaultPDA,
    getNullifierPDA,
    INSTRUCTIONS,
} = require('@solana-privacy-pools/client');
const { createDeposits } = require('../security/helpers/test-setup');
const {
    expectTransactionFailure,
} = require('../security/helpers/error-assertions');

describe('Invalid Proof Test', function() {
    this.timeout(60000);

    it('should reject withdrawal with malformed proof bytes', async function() {
        console.log('\n  🔍 Test: Invalid Proof Bytes');

        const connection = new Connection('http://localhost:8899', 'confirmed');
        const authority = Keypair.generate();
        const user = Keypair.generate();

        await connection.requestAirdrop(authority.publicKey, 100 * LAMPORTS_PER_SOL);
        await connection.requestAirdrop(user.publicKey, 100 * LAMPORTS_PER_SOL);
        await new Promise(resolve => setTimeout(resolve, 1000));

        const pool = await initializePool(connection, authority, WSOL_MINT);

        // Create a valid deposit
        const depositAmount = BigInt(5 * LAMPORTS_PER_SOL);
        const deposits = await createDeposits(
            connection,
            pool.poolStateAccount,
            [{ user, amount: depositAmount }],
            pool.scope
        );

        const depositInfo = deposits[0];

        // Build withdrawal instruction with INVALID/MALFORMED proof
        const { nullifierPDA } = getNullifierPDA(depositInfo.nullifierHash);
        const { vaultPDA } = getVaultPDA(WSOL_MINT);
        const userTokenAccount = await getAssociatedTokenAddress(WSOL_MINT, user.publicKey);
        const poolTokenAccount = await getAssociatedTokenAddress(WSOL_MINT, vaultPDA, true);

        const withdrawAmount = BigInt(3 * LAMPORTS_PER_SOL);
        const withdrawalDataBytes = Buffer.alloc(8);
        withdrawalDataBytes.writeBigUInt64LE(withdrawAmount, 0);

        // Build instruction with GARBAGE proof data
        const totalSize = 1 + 32 + 4 + 8 + 64 + 128 + 64 + 4 + (8 * 32);
        const withdrawData = Buffer.alloc(totalSize);
        let offset = 0;

        // Instruction type
        withdrawData[offset++] = INSTRUCTIONS.WITHDRAW;

        // Processor pubkey
        withdrawData.set(user.publicKey.toBuffer(), offset);
        offset += 32;

        // Withdrawal data length
        withdrawData.writeUInt32LE(8, offset);
        offset += 4;

        // Withdrawal data
        withdrawData.set(withdrawalDataBytes, offset);
        offset += 8;

        // INVALID PROOF DATA - just fill with random bytes or zeros
        // Proof A (64 bytes) - GARBAGE
        withdrawData.fill(0xFF, offset, offset + 64);
        offset += 64;

        // Proof B (128 bytes) - GARBAGE
        withdrawData.fill(0xAA, offset, offset + 128);
        offset += 128;

        // Proof C (64 bytes) - GARBAGE
        withdrawData.fill(0x55, offset, offset + 64);
        offset += 64;

        // Public signals count
        withdrawData.writeUInt32LE(8, offset);
        offset += 4;

        // Public signals (8 * 32 bytes) - GARBAGE
        for (let i = 0; i < 8; i++) {
            withdrawData.fill(i, offset, offset + 32);
            offset += 32;
        }

        const withdrawIx = new TransactionInstruction({
            keys: [
                { pubkey: pool.poolStateAccount, isSigner: false, isWritable: true },
                { pubkey: vaultPDA, isSigner: false, isWritable: false },
                { pubkey: nullifierPDA, isSigner: false, isWritable: true },
                { pubkey: user.publicKey, isSigner: true, isWritable: true },
                { pubkey: poolTokenAccount, isSigner: false, isWritable: true },
                { pubkey: userTokenAccount, isSigner: false, isWritable: true },
                { pubkey: WSOL_MINT, isSigner: false, isWritable: false },
                { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            programId: programKeypair.publicKey,
            data: withdrawData,
        });

        // Attempt withdrawal with invalid proof
        await expectTransactionFailure(async () => {
            const tx = new Transaction()
                .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }))
                .add(withdrawIx);
            return await sendAndConfirmTransaction(connection, tx, [user]);
        }, 'Invalid'); // Proof verification will fail

        console.log('  ✅ Invalid proof bytes correctly rejected');
    });
});
