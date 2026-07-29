const { 
    PublicKey, 
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
    createAssociatedTokenAccountInstruction,
} = require('@solana/spl-token');
const { computeScope } = require('./proof');
const { parsePoolState } = require('./pool-parser');
const { 
    programKeypair, 
    POOL_STATE_SIZE, 
    INSTRUCTIONS,
    WSOL_MINT 
} = require('./constants');

/**
 * Get the vault PDA for a given token mint
 */
function getVaultPDA(mint) {
    const [vaultPDA, vaultBump] = PublicKey.findProgramAddressSync(
        [
            Buffer.from('vault'),
            mint.toBuffer()
        ],
        programKeypair.publicKey
    );
    return { vaultPDA, vaultBump };
}

/**
 * Get the canonical spent-nullifier marker PDA for a pool and nullifier hash.
 */
function getNullifierPDA(poolStateAccount, nullifierHash) {
    const hashBuffer = Buffer.from(nullifierHash);
    if (hashBuffer.length !== 32) {
        throw new TypeError('nullifierHash must be exactly 32 bytes');
    }

    const [nullifierPDA, nullifierBump] = PublicKey.findProgramAddressSync(
        [
            Buffer.from('nullifier'),
            poolStateAccount.toBuffer(),
            hashBuffer,
        ],
        programKeypair.publicKey
    );

    return { nullifierPDA, nullifierBump };
}

/**
 * Get the pool state account seed
 */
function getPoolStateSeed(mint) {
    return `ps-${mint.toBase58().slice(0, 29)}`;
}

/**
 * Initialize a privacy pool
 */
async function initializePool(connection, authority, mint = WSOL_MINT) {
    // Get vault PDA
    const { vaultPDA, vaultBump } = getVaultPDA(mint);
    
    // Create pool state account with deterministic seed
    const poolStateSeed = getPoolStateSeed(mint);
    console.log('  Pool state seed:', poolStateSeed);
    const poolStateAccount = await PublicKey.createWithSeed(
        authority.publicKey,
        poolStateSeed,
        programKeypair.publicKey
    );
    console.log('  Pool state account:', poolStateAccount.toBase58());
    console.log('  Authority:', authority.publicKey.toBase58());
    console.log('  Program ID:', programKeypair.publicKey.toBase58());
    
    const poolStateRent = await connection.getMinimumBalanceForRentExemption(POOL_STATE_SIZE);
    
    // Create pool state account using createAccountWithSeed
    const createPoolAccountIx = SystemProgram.createAccountWithSeed({
        fromPubkey: authority.publicKey,
        basePubkey: authority.publicKey,
        seed: poolStateSeed,
        newAccountPubkey: poolStateAccount,
        lamports: poolStateRent,
        space: POOL_STATE_SIZE,
        programId: programKeypair.publicKey,
    });
    
    // Build initialize instruction data matching Rust expectations:
    // [instruction_type, entrypoint_authority, max_tree_depth, asset_mint]
    const initData = Buffer.alloc(66);
    initData[0] = INSTRUCTIONS.INITIALIZE;
    authority.publicKey.toBuffer().copy(initData, 1);  // entrypoint_authority
    initData[33] = 32;  // max_tree_depth
    mint.toBuffer().copy(initData, 34);  // asset_mint
    
    // Compute scope for return value
    const scope = computeScope(mint.toBuffer());
    
    // Create pool token account owned by vault PDA
    const poolTokenAccount = await getAssociatedTokenAddress(mint, vaultPDA, true);
    const createPoolTokenAccountIx = createAssociatedTokenAccountInstruction(
        authority.publicKey,
        poolTokenAccount,
        vaultPDA,
        mint
    );
    
    const initIx = new TransactionInstruction({
        keys: [
            { pubkey: poolStateAccount, isSigner: false, isWritable: true },
            { pubkey: authority.publicKey, isSigner: true, isWritable: true },
            { pubkey: poolTokenAccount, isSigner: false, isWritable: true },
            { pubkey: mint, isSigner: false, isWritable: false },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId: programKeypair.publicKey,
        data: initData,
    });
    
    const initTx = new Transaction()
        .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }))
        .add(createPoolAccountIx)
        .add(createPoolTokenAccountIx)
        .add(initIx);
    
    const txSig = await sendAndConfirmTransaction(
        connection, 
        initTx, 
        [authority],  // Only authority signs now
        { commitment: 'confirmed' }
    );
    
    return {
        poolStateAccount,  // Now just a PublicKey, not a Keypair
        vaultPDA,
        vaultBump,
        poolTokenAccount,
        scope: scope.buffer,
        txSig
    };
}


/**
 * Wind down a pool (authority only)
 */
async function windDownPool(connection, poolStateAccount, authority) {
    const windDownData = Buffer.alloc(1);
    windDownData[0] = INSTRUCTIONS.WIND_DOWN;
    
    const windDownIx = new TransactionInstruction({
        keys: [
            { pubkey: poolStateAccount, isSigner: false, isWritable: true },
            { pubkey: authority.publicKey, isSigner: true, isWritable: false },
        ],
        programId: programKeypair.publicKey,
        data: windDownData,
    });
    
    const windDownTx = new Transaction()
        .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 }))
        .add(windDownIx);
    
    return await sendAndConfirmTransaction(
        connection, 
        windDownTx, 
        [authority],
        { commitment: 'confirmed' }
    );
}

module.exports = {
    getVaultPDA,
    getNullifierPDA,
    getPoolStateSeed,
    initializePool,
    parsePoolState,
    windDownPool
};
