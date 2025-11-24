const {
    Transaction,
    TransactionInstruction,
    ComputeBudgetProgram,
    sendAndConfirmTransaction
} = require('@solana/web3.js');
const {
    TOKEN_PROGRAM_ID,
    getAssociatedTokenAddress,
    createAssociatedTokenAccountIdempotentInstruction,
} = require('@solana/spl-token');
const { getVaultPDA } = require('./pool');
const { programKeypair, INSTRUCTIONS } = require('./constants');
const { parsePoolState } = require('./pool-parser');

/**
 * Calculate withdrawal fee for a given amount
 * Formula: fee = max(amount * basis_points / 10000, minimum_fee)
 */
function calculateWithdrawalFee(amount, basisPoints, minimumFee) {
    const basisFee = Math.floor((amount * basisPoints) / 10000);
    return Math.max(basisFee, minimumFee);
}

/**
 * Withdraw accumulated protocol fees from the pool
 * Only callable by the fee collector address
 *
 * @param {Connection} connection - Solana connection
 * @param {PublicKey} poolStateAccount - Pool state account
 * @param {Keypair} feeCollector - Fee collector signer
 * @param {bigint} amount - Amount of fees to withdraw
 * @returns Transaction signature
 */
async function withdrawFees(connection, poolStateAccount, feeCollector, amount) {
    // Get pool state to find mint and verify fee collector
    const poolStateData = await connection.getAccountInfo(poolStateAccount);
    if (!poolStateData) {
        throw new Error('Pool state account not found');
    }

    const poolState = parsePoolState(poolStateData.data);

    // Verify the signer is the authorized fee collector
    if (poolState.fee_collector.toBase58() !== feeCollector.publicKey.toBase58()) {
        throw new Error(
            `Unauthorized: ${feeCollector.publicKey.toBase58()} is not the fee collector. ` +
            `Expected: ${poolState.fee_collector.toBase58()}`
        );
    }

    // Verify sufficient accumulated fees
    if (amount > poolState.accumulated_fees) {
        throw new Error(
            `Insufficient accumulated fees. Requested: ${amount}, Available: ${poolState.accumulated_fees}`
        );
    }

    const mint = poolState.asset_mint;
    const { vaultPDA } = getVaultPDA(mint);

    // Get pool's token account (owned by vault PDA)
    const poolTokenAccount = await getAssociatedTokenAddress(mint, vaultPDA, true);

    // Get fee collector's token account
    const collectorTokenAccount = await getAssociatedTokenAddress(
        mint,
        feeCollector.publicKey
    );

    // Build instruction data: [instruction_type, amount]
    const instructionData = Buffer.alloc(1 + 8);
    instructionData[0] = INSTRUCTIONS.WITHDRAW_FEES;
    instructionData.writeBigUInt64LE(BigInt(amount), 1);

    const withdrawFeesIx = new TransactionInstruction({
        keys: [
            { pubkey: poolStateAccount, isSigner: false, isWritable: true },
            { pubkey: vaultPDA, isSigner: false, isWritable: false },
            { pubkey: feeCollector.publicKey, isSigner: true, isWritable: false },
            { pubkey: poolTokenAccount, isSigner: false, isWritable: true },
            { pubkey: collectorTokenAccount, isSigner: false, isWritable: true },
            { pubkey: mint, isSigner: false, isWritable: false },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        programId: programKeypair.publicKey,
        data: instructionData,
    });

    // Create ATA if it doesn't exist (idempotent)
    const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
        feeCollector.publicKey,
        collectorTokenAccount,
        feeCollector.publicKey,
        mint
    );

    const tx = new Transaction()
        .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }))
        .add(createAtaIx)
        .add(withdrawFeesIx);

    return await sendAndConfirmTransaction(
        connection,
        tx,
        [feeCollector],
        { commitment: 'confirmed' }
    );
}

/**
 * Get accumulated fees for a pool
 */
async function getAccumulatedFees(connection, poolStateAccount) {
    const poolStateData = await connection.getAccountInfo(poolStateAccount);
    if (!poolStateData) {
        throw new Error('Pool state account not found');
    }

    const poolState = parsePoolState(poolStateData.data);
    return {
        accumulated_fees: poolState.accumulated_fees,
        withdrawal_fee_basis_points: poolState.withdrawal_fee_basis_points,
        deposit_fee_basis_points: poolState.deposit_fee_basis_points,
        withdrawal_fee_min: poolState.withdrawal_fee_min,
        fee_collector: poolState.fee_collector,
    };
}

module.exports = {
    calculateWithdrawalFee,
    withdrawFees,
    getAccumulatedFees,
};
