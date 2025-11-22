/**
 * Withdrawal instruction builder for testing
 *
 * Provides utilities to build withdrawal instructions with custom parameters
 */
const {
    Transaction,
    TransactionInstruction,
    SystemProgram,
    ComputeBudgetProgram,
} = require('@solana/web3.js');
const {
    getAssociatedTokenAddress,
    TOKEN_PROGRAM_ID,
} = require('@solana/spl-token');
const {
    programKeypair,
    getVaultPDA,
    getNullifierPDA,
    INSTRUCTIONS,
} = require('@solana-privacy-pools/client');
const {
    generateWithdrawProof,
    reduceHashToField,
} = require('@solana-privacy-pools/client/proof');
const { generateMerkleProofs } = require('@solana-privacy-pools/client/merkle');
const { keccak256 } = require('js-sha3');

/**
 * Helper: Convert Buffer to BigInt (big-endian)
 */
function bufferToBigInt(buffer) {
    let result = BigInt(0);
    for (let i = 0; i < buffer.length; i++) {
        result = (result << 8n) | BigInt(buffer[i]);
    }
    return result;
}

/**
 * Build a withdrawal instruction with custom parameters
 *
 * @param {Object} params - Parameters
 * @param {PublicKey} params.poolStateAccount - Pool state account
 * @param {PublicKey} params.user - User keypair (signer/processor)
 * @param {PublicKey} params.recipientTokenAccount - Recipient token account (defaults to user's)
 * @param {Buffer} params.scope - Pool scope
 * @param {PublicKey} params.mint - Token mint
 * @param {Object} params.depositInfo - Deposit information
 * @param {Array} params.allDeposits - All deposits for merkle tree
 * @param {bigint} params.withdrawAmount - Amount to withdraw
 * @param {Object} params.overrides - Optional overrides for testing
 * @param {bigint} params.overrides.withdrawAmountInData - Different amount in instruction data
 * @returns {Promise<TransactionInstruction>} - The withdrawal instruction
 */
async function buildWithdrawalInstruction({
    poolStateAccount,
    user,
    recipientTokenAccount,
    scope,
    mint,
    depositInfo,
    allDeposits,
    withdrawAmount,
    overrides = {}
}) {
    // Find deposit index
    const depositIndex = allDeposits.findIndex((d) => {
        const dCommit = Buffer.isBuffer(d.commitment)
            ? d.commitment
            : Buffer.from(d.commitment);
        const infoCommit = Buffer.isBuffer(depositInfo.commitment)
            ? depositInfo.commitment
            : Buffer.from(depositInfo.commitment);
        return dCommit.toString("hex") === infoCommit.toString("hex");
    });

    if (depositIndex === -1) {
        throw new Error("Deposit not found in deposits array");
    }

    // Generate merkle proofs
    const merkleProofs = await generateMerkleProofs(allDeposits, depositIndex);

    // Convert roots from whatever format to BigInt
    const stateRootBigInt = typeof merkleProofs.stateRoot === 'bigint'
        ? merkleProofs.stateRoot
        : Buffer.isBuffer(merkleProofs.stateRoot)
            ? bufferToBigInt(merkleProofs.stateRoot)
            : BigInt(merkleProofs.stateRoot);

    const aspRootBigInt = typeof merkleProofs.aspRoot === 'bigint'
        ? merkleProofs.aspRoot
        : Buffer.isBuffer(merkleProofs.aspRoot)
            ? bufferToBigInt(merkleProofs.aspRoot)
            : BigInt(merkleProofs.aspRoot);

    // Compute context
    const scopeBuffer = Buffer.isBuffer(scope) ? scope : Buffer.from(scope);
    const contextData = Buffer.concat([
        Buffer.from("IPrivacyPool.Withdrawal"),
        scopeBuffer
    ]);
    const contextHash = Buffer.from(keccak256.array(contextData));
    const contextResult = reduceHashToField(contextHash);
    const contextReduced = contextResult.bigint;  // Extract bigint from object

    // Generate new nullifier and secret for child commitment
    const newNullifier = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));
    const newSecret = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));

    // Generate withdrawal proof
    const { proof, publicSignals } = await generateWithdrawProof(
        withdrawAmount,
        stateRootBigInt,
        merkleProofs.stateTreeDepth,
        aspRootBigInt,
        merkleProofs.aspTreeDepth,
        contextReduced,
        depositInfo.label,
        depositInfo.value,
        depositInfo.nullifier,
        depositInfo.secret,
        newNullifier,
        newSecret,
        merkleProofs.stateProof,
        merkleProofs.stateIndex,
        merkleProofs.aspProof,
        merkleProofs.aspIndex
    );

    // Get accounts
    const { nullifierPDA } = getNullifierPDA(depositInfo.nullifierHash);
    const { vaultPDA } = getVaultPDA(mint);
    const poolTokenAccount = await getAssociatedTokenAddress(mint, vaultPDA, true);
    const userTokenAccount = recipientTokenAccount || await getAssociatedTokenAddress(mint, user.publicKey);

    // Build instruction data
    const actualWithdrawAmount = overrides.withdrawAmountInData !== undefined
        ? overrides.withdrawAmountInData
        : withdrawAmount;

    const withdrawalDataBytes = Buffer.alloc(8);
    withdrawalDataBytes.writeBigUInt64LE(actualWithdrawAmount, 0);

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

    // Withdrawal data (amount)
    withdrawData.set(withdrawalDataBytes, offset);
    offset += 8;

    // Proof A
    withdrawData.set(proof.proofA, offset);
    offset += 64;

    // Proof B
    withdrawData.set(proof.proofB, offset);
    offset += 128;

    // Proof C
    withdrawData.set(proof.proofC, offset);
    offset += 64;

    // Public signals count
    withdrawData.writeUInt32LE(8, offset);
    offset += 4;

    // Public signals (8 * 32 bytes)
    for (const signal of publicSignals) {
        withdrawData.set(signal, offset);
        offset += 32;
    }

    // Build instruction
    const withdrawIx = new TransactionInstruction({
        keys: [
            { pubkey: poolStateAccount, isSigner: false, isWritable: true },
            { pubkey: vaultPDA, isSigner: false, isWritable: false },
            { pubkey: nullifierPDA, isSigner: false, isWritable: true },
            { pubkey: user.publicKey, isSigner: true, isWritable: true },
            { pubkey: poolTokenAccount, isSigner: false, isWritable: true },
            { pubkey: userTokenAccount, isSigner: false, isWritable: true },
            { pubkey: mint, isSigner: false, isWritable: false },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId: programKeypair.publicKey,
        data: withdrawData,
    });

    return withdrawIx;
}

/**
 * Build and send a withdrawal transaction with custom parameters
 */
async function buildAndSendWithdrawal(connection, params) {
    const withdrawIx = await buildWithdrawalInstruction(params);

    const tx = new Transaction()
        .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }))
        .add(withdrawIx);

    const { sendAndConfirmTransaction } = require('@solana/web3.js');
    return await sendAndConfirmTransaction(connection, tx, [params.user]);
}

module.exports = {
    buildWithdrawalInstruction,
    buildAndSendWithdrawal,
};
