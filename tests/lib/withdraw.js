const { 
    Keypair,
    SystemProgram,
    Transaction,
    TransactionInstruction,
    ComputeBudgetProgram,
    sendAndConfirmTransaction
} = require('@solana/web3.js');
const {
    TOKEN_PROGRAM_ID,
    getAssociatedTokenAddress,
} = require('@solana/spl-token');
const { generateWithdrawProof } = require('./proof');
const { getVaultPDA } = require('./pool');
const { 
    programKeypair, 
    NULLIFIER_STATE_SIZE,
    INSTRUCTIONS,
    WSOL_MINT 
} = require('./constants');

/**
 * Withdraw from the pool with ZK proof
 * Note: This requires merkle tree proofs which need to be computed from pool state
 * 
 * @param {Connection} connection - Solana connection
 * @param {PublicKey} poolStateAccount - Pool state account
 * @param {Keypair} user - User performing withdrawal
 * @param {BigInt} withdrawnValue - Amount to withdraw
 * @param {Buffer} stateRoot - Current state tree root
 * @param {number} stateTreeDepth - State tree depth
 * @param {Buffer} aspRoot - Current ASP tree root
 * @param {number} aspTreeDepth - ASP tree depth
 * @param {Buffer} context - Pool context/scope
 * @param {Object} depositInfo - Original deposit information
 * @param {Object} merkleProofs - Merkle proofs for state and ASP trees
 * @param {PublicKey} mint - Token mint (defaults to WSOL)
 */
async function withdraw(
    connection,
    poolStateAccount,
    user,
    withdrawnValue,
    stateRoot,
    stateTreeDepth,
    aspRoot,
    aspTreeDepth,
    context,
    depositInfo,
    merkleProofs,
    mint = WSOL_MINT
) {
    // Get vault PDA
    const { vaultPDA } = getVaultPDA(mint);
    
    // Get token accounts
    const userTokenAccount = await getAssociatedTokenAddress(mint, user.publicKey);
    const poolTokenAccount = await getAssociatedTokenAddress(mint, vaultPDA, true);
    
    // Generate new nullifier and secret for the change commitment
    const newNullifier = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));
    const newSecret = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));
    
    // Generate withdraw proof
    const { proof, publicSignals } = await generateWithdrawProof(
        withdrawnValue,
        stateRoot,
        stateTreeDepth,
        aspRoot,
        aspTreeDepth,
        context,
        depositInfo.label,
        depositInfo.value,
        depositInfo.nullifier,
        depositInfo.secret,
        newNullifier,
        newSecret,
        merkleProofs.stateProof,
        merkleProofs.aspProof
    );
    
    // Create nullifier state account
    const nullifierState = Keypair.generate();
    const nullifierRent = await connection.getMinimumBalanceForRentExemption(NULLIFIER_STATE_SIZE);
    
    const createNullifierAccountIx = SystemProgram.createAccount({
        fromPubkey: user.publicKey,
        newAccountPubkey: nullifierState.publicKey,
        space: NULLIFIER_STATE_SIZE,
        lamports: Number(nullifierRent),
        programId: programKeypair.publicKey,
    });
    
    // Build withdraw instruction data
    // Format: instruction_type (1) + withdrawnValue (8) + proof data (256) + public signals (256)
    const withdrawData = Buffer.alloc(521);
    let offset = 0;
    
    withdrawData[offset++] = INSTRUCTIONS.WITHDRAW;
    withdrawData.writeBigUInt64LE(withdrawnValue, offset);
    offset += 8;
    
    // Add proof data
    withdrawData.set(proof.proofA, offset);
    offset += 64;
    withdrawData.set(proof.proofB, offset);
    offset += 128;
    withdrawData.set(proof.proofC, offset);
    offset += 64;
    
    // Add public signals (8 * 32 bytes)
    for (const signal of publicSignals) {
        withdrawData.set(signal, offset);
        offset += 32;
    }
    
    const withdrawIx = new TransactionInstruction({
        keys: [
            { pubkey: poolStateAccount, isSigner: false, isWritable: true },
            { pubkey: vaultPDA, isSigner: false, isWritable: false },
            { pubkey: nullifierState.publicKey, isSigner: false, isWritable: true },
            { pubkey: user.publicKey, isSigner: true, isWritable: false },
            { pubkey: poolTokenAccount, isSigner: false, isWritable: true },
            { pubkey: userTokenAccount, isSigner: false, isWritable: true },
            { pubkey: mint, isSigner: false, isWritable: false },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        programId: programKeypair.publicKey,
        data: withdrawData,
    });
    
    const withdrawTx = new Transaction()
        .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }))
        .add(createNullifierAccountIx)
        .add(withdrawIx);
    
    const txSig = await sendAndConfirmTransaction(
        connection, 
        withdrawTx, 
        [user, nullifierState],
        { commitment: 'confirmed' }
    );
    
    return {
        txSig,
        nullifierState: nullifierState.publicKey,
        nullifierHash: publicSignals[1], // Nullifier hash from proof
        newCommitment: publicSignals[0], // New commitment for change
    };
}

module.exports = {
    withdraw
};