const { PublicKey } = require('@solana/web3.js');

/**
 * Parse PoolStateLeanIMT from account data
 *
 * Memory layout:
 * - is_initialized: u8 (1 byte)
 * - _padding1: 7 bytes
 * - authority: Pubkey (32 bytes)
 * - asset_mint: Pubkey (32 bytes)
 * - entrypoint: Pubkey (32 bytes)
 * - withdrawal_verifier: Pubkey (32 bytes)
 * - scope: [u8; 32] (32 bytes)
 * - nonce: u64 (8 bytes)
 * - is_dead: u8 (1 byte)
 * - _padding2: 7 bytes
 * - withdrawal_fee_basis_points: u16 (2 bytes)
 * - deposit_fee_basis_points: u16 (2 bytes)
 * - _fee_padding1: 4 bytes
 * - withdrawal_fee_min: u64 (8 bytes)
 * - fee_collector: Pubkey (32 bytes)
 * - accumulated_fees: u64 (8 bytes)
 * - roots: [[u8; 32]; 64] (2048 bytes)
 * - current_root_index: u64 (8 bytes)
 * - state_tree: LeanIMT (variable size)
 * - asp_tree: LeanIMT (variable size)
 */
function parsePoolState(accountData) {
    let offset = 0;

    const is_initialized = accountData.readUInt8(offset);
    offset += 1 + 7; // Skip padding

    const authority = new PublicKey(accountData.slice(offset, offset + 32));
    offset += 32;

    const asset_mint = new PublicKey(accountData.slice(offset, offset + 32));
    offset += 32;

    const entrypoint = new PublicKey(accountData.slice(offset, offset + 32));
    offset += 32;

    const withdrawal_verifier = new PublicKey(accountData.slice(offset, offset + 32));
    offset += 32;

    const scope = accountData.slice(offset, offset + 32);
    offset += 32;

    const nonce = accountData.readBigUInt64LE(offset);
    offset += 8;

    const is_dead = accountData.readUInt8(offset);
    offset += 1 + 7; // Skip padding

    // Fee configuration
    const withdrawal_fee_basis_points = accountData.readUInt16LE(offset);
    offset += 2;

    const deposit_fee_basis_points = accountData.readUInt16LE(offset);
    offset += 2;

    offset += 4; // Skip fee padding

    const withdrawal_fee_min = accountData.readBigUInt64LE(offset);
    offset += 8;

    const fee_collector = new PublicKey(accountData.slice(offset, offset + 32));
    offset += 32;

    const accumulated_fees = accountData.readBigUInt64LE(offset);
    offset += 8;
    
    // Root history
    const roots = [];
    for (let i = 0; i < 64; i++) {
        roots.push(accountData.slice(offset, offset + 32));
        offset += 32;
    }
    
    const currentRootIndex = accountData.readBigUInt64LE(offset);
    offset += 8;
    
    // Parse state tree
    const stateTree = parseLeanIMT(accountData, offset);
    offset += getLeanIMTSize();
    
    // Parse ASP tree
    const aspTree = parseLeanIMT(accountData, offset);
    
    return {
        is_initialized,
        authority,
        asset_mint,
        entrypoint,
        withdrawal_verifier,
        scope,
        nonce: Number(nonce),
        is_dead,
        withdrawal_fee_basis_points,
        deposit_fee_basis_points,
        withdrawal_fee_min: Number(withdrawal_fee_min),
        fee_collector,
        accumulated_fees: Number(accumulated_fees),
        roots,
        currentRootIndex: Number(currentRootIndex),
        stateTree,
        aspTree
    };
}

/**
 * Parse vendored LeanIMT structure
 * New structure:
 * - size: u64 (8 bytes)
 * - depth: u32 (4 bytes)
 * - padding: 4 bytes (alignment)
 * - side_nodes: [[u8; 32]; 21] (672 bytes) // MAX_TREE_DEPTH=20 + 1
 */
function parseLeanIMT(accountData, startOffset) {
    const MAX_TREE_DEPTH = 20; // Updated to match vendored implementation
    let offset = startOffset;
    
    const size = accountData.readBigUInt64LE(offset);
    offset += 8;
    
    const depth = accountData.readUInt32LE(offset);
    offset += 4;
    
    // Skip 4 bytes of alignment padding
    offset += 4;
    
    // Side nodes array (21 * 32 bytes) - MAX_TREE_DEPTH + 1
    const sideNodes = [];
    for (let i = 0; i <= MAX_TREE_DEPTH; i++) {
        sideNodes.push(accountData.slice(offset, offset + 32));
        offset += 32;
    }
    
    // No function pointer anymore
    
    // The current root is at sideNodes[depth]
    const currentRoot = depth <= MAX_TREE_DEPTH ? sideNodes[depth] : Buffer.alloc(32);
    
    return {
        size: Number(size),
        depth,
        sideNodes,
        root: currentRoot, // Add convenient access to current root
    };
}

/**
 * Get the size of vendored LeanIMT in bytes
 */
function getLeanIMTSize() {
    const MAX_TREE_DEPTH = 20; // Updated to match vendored implementation
    return 8 + // size
           4 + // depth
           4 + // alignment padding
           ((MAX_TREE_DEPTH + 1) * 32); // side_nodes
}

module.exports = {
    parsePoolState,
    parseLeanIMT,
    getLeanIMTSize
};