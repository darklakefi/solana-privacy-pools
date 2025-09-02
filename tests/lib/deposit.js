const { 
    Keypair,
    SystemProgram,
    Transaction,
    TransactionInstruction,
    ComputeBudgetProgram,
    sendAndConfirmTransaction,
    LAMPORTS_PER_SOL
} = require('@solana/web3.js');
const {
    TOKEN_PROGRAM_ID,
    getAssociatedTokenAddress,
    createAssociatedTokenAccountInstruction,
    createSyncNativeInstruction,
} = require('@solana/spl-token');
const { generateCommitmentProof, computeLabel } = require('./proof');
const { getVaultPDA } = require('./pool');
const { 
    programKeypair, 
    DEPOSITOR_STATE_SIZE, 
    INSTRUCTIONS,
    WSOL_MINT 
} = require('./constants');

/**
 * Create WSOL account and wrap SOL
 */
async function createAndWrapWSol(connection, user, amount) {
    const userWsolAccount = await getAssociatedTokenAddress(WSOL_MINT, user.publicKey);
    
    const createUserWsolIx = createAssociatedTokenAccountInstruction(
        user.publicKey,
        userWsolAccount,
        user.publicKey,
        WSOL_MINT
    );
    
    const transferSolIx = SystemProgram.transfer({
        fromPubkey: user.publicKey,
        toPubkey: userWsolAccount,
        lamports: Number(amount),
    });
    
    const syncNativeIx = createSyncNativeInstruction(userWsolAccount);
    
    const wrapTx = new Transaction()
        .add(createUserWsolIx)
        .add(transferSolIx)
        .add(syncNativeIx);
    
    await sendAndConfirmTransaction(connection, wrapTx, [user]);
    
    return userWsolAccount;
}

/**
 * Make a deposit to the privacy pool
 */
async function deposit(
    connection,
    poolStateAccount,
    user,
    amount,
    nonce,
    scope,
    mint = WSOL_MINT,
    nullifier = null,
    secret = null
) {
    // Generate random values if not provided
    if (!nullifier) {
        nullifier = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));
    }
    if (!secret) {
        secret = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));
    }
    
    // Get vault PDA
    const { vaultPDA } = getVaultPDA(mint);
    
    // Get token accounts
    const userTokenAccount = await getAssociatedTokenAddress(mint, user.publicKey);
    const poolTokenAccount = await getAssociatedTokenAddress(mint, vaultPDA, true);
    
    // Compute label
    const label = computeLabel(scope, nonce);
    
    // Generate proof
    const { proof, publicSignals, rawPublicSignals } = await generateCommitmentProof(
        amount,
        label.bigint,
        nullifier,
        secret
    );
    
    // Create depositor state account
    const depositorState = Keypair.generate();
    const depositorStateRent = await connection.getMinimumBalanceForRentExemption(DEPOSITOR_STATE_SIZE);
    
    const createDepositorStateIx = SystemProgram.createAccount({
        fromPubkey: user.publicKey,
        newAccountPubkey: depositorState.publicKey,
        space: DEPOSITOR_STATE_SIZE,
        lamports: Number(depositorStateRent),
        programId: programKeypair.publicKey,
    });
    
    // Build deposit instruction data
    // 1 (instruction) + 32 (depositor) + 8 (value) + 64 (proof_a) + 128 (proof_b) + 64 (proof_c) + 128 (public signals)
    const depositData = Buffer.alloc(425);
    let offset = 0;
    
    depositData[offset++] = INSTRUCTIONS.DEPOSIT;
    user.publicKey.toBuffer().copy(depositData, offset);
    offset += 32;
    depositData.writeBigUInt64LE(amount, offset);
    offset += 8;
    
    // Add proof data
    depositData.set(proof.proofA, offset);
    offset += 64;
    depositData.set(proof.proofB, offset);
    offset += 128;
    depositData.set(proof.proofC, offset);
    offset += 64;
    
    // Add public signals in circuit output order
    depositData.set(publicSignals.commitment, offset);
    offset += 32;
    depositData.set(publicSignals.nullifierHash, offset);
    offset += 32;
    depositData.set(publicSignals.value, offset);
    offset += 32;
    depositData.set(publicSignals.label, offset);
    
    const depositIx = new TransactionInstruction({
        keys: [
            { pubkey: poolStateAccount, isSigner: false, isWritable: true },
            { pubkey: depositorState.publicKey, isSigner: false, isWritable: true },
            { pubkey: user.publicKey, isSigner: true, isWritable: false },
            { pubkey: userTokenAccount, isSigner: false, isWritable: true },
            { pubkey: poolTokenAccount, isSigner: false, isWritable: true },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        programId: programKeypair.publicKey,
        data: depositData,
    });
    
    const depositTx = new Transaction()
        .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }))
        .add(createDepositorStateIx)
        .add(depositIx);
    
    const txSig = await sendAndConfirmTransaction(
        connection, 
        depositTx, 
        [user, depositorState],
        { commitment: 'confirmed' }
    );
    
    // Get pool state to determine leaf index (current tree size)
    const poolAccountInfo = await connection.getAccountInfo(poolStateAccount);
    const { parsePoolState } = require('./pool-parser');
    const poolState = parsePoolState(poolAccountInfo.data);
    
    // The leaf index is the size of the tree before this deposit
    // Since we just added a commitment, we need to subtract 1
    const leafIndex = poolState.stateTree.size - 1;
    
    return {
        txSig,
        depositorState: depositorState.publicKey,
        commitment: publicSignals.commitment,
        nullifierHash: publicSignals.nullifierHash,
        label: label.bigint,
        value: amount, // Add explicit value field
        nullifier,
        secret,
        nonce,
        leafIndex // Position in the state tree
    };
}

module.exports = {
    createAndWrapWSol,
    deposit
};