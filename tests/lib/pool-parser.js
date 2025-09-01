const { PublicKey } = require('@solana/web3.js');

/**
 * Parse PoolStateLeanIMT from account data
 * Based on the Rust struct in src/state/lean_imt.rs
 */
function parsePoolState(accountData) {
    const ROOT_HISTORY_SIZE = 64;
    const MAX_TREE_DEPTH = 32;
    let offset = 0;
    
    // Pool configuration
    const isInitialized = accountData[offset];
    offset += 1;
    offset += 7; // _padding1
    
    const authority = new PublicKey(accountData.slice(offset, offset + 32));
    offset += 32;
    
    const assetMint = new PublicKey(accountData.slice(offset, offset + 32));
    offset += 32;
    
    const entrypoint = new PublicKey(accountData.slice(offset, offset + 32));
    offset += 32;
    
    const withdrawalVerifier = new PublicKey(accountData.slice(offset, offset + 32));
    offset += 32;
    
    const scope = accountData.slice(offset, offset + 32);
    offset += 32;
    
    const nonce = accountData.readBigUInt64LE(offset);
    offset += 8;
    
    const isDead = accountData[offset];
    offset += 1;
    offset += 7; // _padding2
    
    // Root history (circular buffer)
    const roots = [];
    for (let i = 0; i < ROOT_HISTORY_SIZE; i++) {
        roots.push(accountData.slice(offset, offset + 32));
        offset += 32;
    }
    const currentRootIndex = accountData.readBigUInt64LE(offset);
    offset += 8;
    
    // State tree - LeanIMTStateZC structure
    const stateTree = parseLeanIMT(accountData, offset);
    offset += getLeanIMTSize();
    
    // ASP tree - LeanIMTStateZC structure
    const aspTree = parseLeanIMT(accountData, offset);
    
    // Calculate total deposits based on nonce
    const totalDeposits = Number(nonce);
    
    return {
        isInitialized: isInitialized === 1,
        authority,
        assetMint,
        entrypoint,
        withdrawalVerifier,
        scope,
        nonce,
        isDead: isDead === 1,
        roots,
        currentRootIndex,
        stateTree,
        aspTree,
        totalDeposits,
        mint: assetMint, // Alias for compatibility
    };
}

/**
 * Parse LeanIMTStateZC structure
 */
function parseLeanIMT(accountData, startOffset) {
    const MAX_TREE_DEPTH = 32;
    let offset = startOffset;
    
    const size = accountData.readBigUInt64LE(offset);
    offset += 8;
    
    const depth = accountData.readUInt32LE(offset);
    offset += 4;
    
    offset += 4; // _padding
    
    // Side nodes array (33 * 32 bytes)
    const sideNodes = [];
    for (let i = 0; i <= MAX_TREE_DEPTH; i++) {
        sideNodes.push(accountData.slice(offset, offset + 32));
        offset += 32;
    }
    
    // Leaf indices array (1024 * 32 bytes)
    const leafIndices = [];
    let nonZeroLeaves = [];
    for (let i = 0; i < 1024; i++) {
        const leaf = accountData.slice(offset, offset + 32);
        leafIndices.push(leaf);
        // Check if leaf is non-zero (has actual data)
        if (!leaf.every(byte => byte === 0)) {
            nonZeroLeaves.push(leaf);
        }
        offset += 32;
    }
    
    const leafCount = accountData.readBigUInt64LE(offset);
    offset += 8;
    
    return {
        size: Number(size),
        depth,
        sideNodes,
        leafIndices,
        leafCount: Number(leafCount),
        leaves: nonZeroLeaves.slice(0, Number(leafCount))
    };
}

/**
 * Get the size of LeanIMTStateZC in bytes
 */
function getLeanIMTSize() {
    const MAX_TREE_DEPTH = 32;
    return 8 + // size
           4 + // depth
           4 + // padding
           ((MAX_TREE_DEPTH + 1) * 32) + // side_nodes
           (1024 * 32) + // leaf_indices
           8; // leaf_count
}

module.exports = {
    parsePoolState
};