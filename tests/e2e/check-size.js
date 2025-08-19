// Check the actual size of PrivacyPoolStateZC

// Constants from Rust
const MAX_TREE_DEPTH = 32;
const ROOT_HISTORY_SIZE = 64;

// Calculate size based on the zero-copy struct layout:
// #[repr(C, packed)]
// pub struct PrivacyPoolStateZC {
//     pub is_initialized: u8,                     // 1
//     pub entrypoint_authority: [u8; 32],         // 32
//     pub asset_mint: [u8; 32],                   // 32
//     pub scope: [u8; 32],                        // 32
//     pub nonce: u64,                              // 8
//     pub dead: u8,                                // 1
//     pub max_tree_depth: u8,                     // 1
//     pub _padding1: [u8; 6],                     // 6
//     pub current_root_index: u64,                // 8
//     pub roots: [[u8; 32]; ROOT_HISTORY_SIZE],   // 32 * 64 = 2048
//     pub merkle_tree: MerkleTreeStateZC,         // ?
// }

// MerkleTreeStateZC:
// pub struct MerkleTreeStateZC {
//     pub depth: u8,                              // 1
//     pub _padding: [u8; 7],                      // 7
//     pub next_index: u64,                        // 8
//     pub root: [u8; 32],                         // 32
//     pub nodes: [[u8; 32]; MAX_TREE_DEPTH * 2],  // 32 * 32 * 2 = 2048
// }

const base_size = 
    1 +         // is_initialized
    32 +        // entrypoint_authority
    32 +        // asset_mint
    32 +        // scope
    8 +         // nonce
    1 +         // dead
    1 +         // max_tree_depth
    6 +         // _padding1
    8 +         // current_root_index
    (32 * ROOT_HISTORY_SIZE); // roots

const merkle_tree_size = 
    1 +         // depth
    7 +         // _padding
    8 +         // next_index
    32 +        // root
    (32 * MAX_TREE_DEPTH * 2); // nodes

const total = base_size + merkle_tree_size;

console.log('Base state size:', base_size);
console.log('Merkle tree size:', merkle_tree_size);
console.log('Total PrivacyPoolStateZC size:', total);

// The size we used in the test
const test_size = 8 + 32 + 32 + 32 + 8 + 1 + 1 + 6 + 8 + (32 * 64) + (32 * 2 * 32);
console.log('Size used in test:', test_size);

// Check if they match
if (total === test_size) {
    console.log('✓ Sizes match!');
} else {
    console.log('✗ Size mismatch!');
    console.log('Difference:', total - test_size);
}

// Also export as constants
module.exports = {
    PRIVACY_POOL_STATE_ZC_SIZE: total,
    DEPOSITOR_STATE_SIZE: 1 + 32 + 32, // 65
    NULLIFIER_STATE_SIZE: 1 + 32, // 33
};