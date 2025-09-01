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
 * Perform a ragequit (emergency exit) from the pool
 */
async function ragequit(
    connection,
    poolStateAccount,
    depositorState,
    user,
    amount,
    mint = WSOL_MINT
) {
    // Get vault PDA
    const { vaultPDA } = getVaultPDA(mint);
    
    // Get token accounts
    const userTokenAccount = await getAssociatedTokenAddress(mint, user.publicKey);
    const poolTokenAccount = await getAssociatedTokenAddress(mint, vaultPDA, true);
    
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
    
    // Build ragequit instruction data
    const ragequitData = Buffer.alloc(9);
    ragequitData[0] = INSTRUCTIONS.RAGEQUIT;
    ragequitData.writeBigUInt64LE(amount, 1);
    
    const ragequitIx = new TransactionInstruction({
        keys: [
            { pubkey: poolStateAccount, isSigner: false, isWritable: true },
            { pubkey: vaultPDA, isSigner: false, isWritable: false },
            { pubkey: depositorState, isSigner: false, isWritable: true },
            { pubkey: user.publicKey, isSigner: true, isWritable: false },
            { pubkey: poolTokenAccount, isSigner: false, isWritable: true },
            { pubkey: userTokenAccount, isSigner: false, isWritable: true },
            { pubkey: mint, isSigner: false, isWritable: false },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        programId: programKeypair.publicKey,
        data: ragequitData,
    });
    
    const ragequitTx = new Transaction()
        .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }))
        .add(createNullifierAccountIx)
        .add(ragequitIx);
    
    const txSig = await sendAndConfirmTransaction(
        connection, 
        ragequitTx, 
        [user, nullifierState],
        { commitment: 'confirmed' }
    );
    
    return {
        txSig,
        nullifierState: nullifierState.publicKey
    };
}

/**
 * Withdraw from the pool with ZK proof
 * Note: This requires merkle tree proofs which need to be computed from pool state
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
        merkleProofs.stateSiblings,
        merkleProofs.stateIndex,
        merkleProofs.aspSiblings,
        merkleProofs.aspIndex
    );
    
    // TODO: Build withdraw instruction data and transaction
    // This is complex and requires proper merkle tree implementation
    
    return {
        proof,
        publicSignals,
        newNullifier,
        newSecret
    };
}

module.exports = {
    ragequit,
    withdraw
};