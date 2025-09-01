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
const { getVaultPDA } = require('./pool');
const { 
    programKeypair, 
    NULLIFIER_STATE_SIZE,
    INSTRUCTIONS,
    WSOL_MINT 
} = require('./constants');

/**
 * Perform a ragequit (emergency exit) from the pool
 * This is a non-private exit that doesn't require ZK proofs
 * Can only be done after the pool has been wound down
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

module.exports = {
    ragequit
};