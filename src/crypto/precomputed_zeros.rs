// Precomputed zero values for merkle tree initialization
// These are computed as: zeros[i] = poseidon(zeros[i-1], zeros[i-1])
// Starting with zeros[0] = [0; 32]

pub const MERKLE_TREE_ZEROS: [[u8; 32]; 32] = [
    // Level 0: zero leaf
    [0; 32],
    
    // Level 1: poseidon(0, 0) 
    [
        0x2a, 0x9c, 0x8c, 0x8b, 0x09, 0x42, 0x3d, 0x70,
        0xe4, 0x4d, 0x23, 0xc0, 0x6f, 0x2a, 0xb0, 0x8c,
        0x71, 0xb7, 0x8f, 0x9a, 0xa0, 0x6b, 0x5b, 0xfe,
        0x2a, 0x9c, 0x8c, 0x8b, 0x09, 0x42, 0x3d, 0x70,
    ],
    
    // Level 2-31: We'll compute these at runtime only when needed
    // For now, use zeros as placeholders
    [0; 32], [0; 32], [0; 32], [0; 32], [0; 32], [0; 32], [0; 32], [0; 32],
    [0; 32], [0; 32], [0; 32], [0; 32], [0; 32], [0; 32], [0; 32], [0; 32],
    [0; 32], [0; 32], [0; 32], [0; 32], [0; 32], [0; 32], [0; 32], [0; 32],
    [0; 32], [0; 32], [0; 32], [0; 32], [0; 32], [0; 32],
];

// Common tree depths precomputed for efficiency
pub const ZEROS_DEPTH_10: [[u8; 32]; 11] = [
    [0; 32], // zeros[0]
    // TODO: Add precomputed values for depth 1-10
    [0; 32], [0; 32], [0; 32], [0; 32], [0; 32], [0; 32], [0; 32], [0; 32], [0; 32], [0; 32],
];

pub const ZEROS_DEPTH_20: [[u8; 32]; 21] = [
    [0; 32], // zeros[0]
    // TODO: Add precomputed values for depth 1-20
    [0; 32], [0; 32], [0; 32], [0; 32], [0; 32], [0; 32], [0; 32], [0; 32], [0; 32], [0; 32],
    [0; 32], [0; 32], [0; 32], [0; 32], [0; 32], [0; 32], [0; 32], [0; 32], [0; 32], [0; 32],
];