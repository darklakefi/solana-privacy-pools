// Solana-specific implementation of LeanIMT using [u8; 32] instead of String

use pinocchio::syscalls::sol_poseidon;

#[cfg(not(feature = "std"))]
extern crate alloc;

#[cfg(not(feature = "std"))]
use alloc::vec::Vec;

#[cfg(feature = "std")]
use std::vec::Vec;

pub type IMTNode = [u8; 32];

// Maximum depth for the tree
pub const MAX_TREE_DEPTH: usize = 20;

// Helper function to hash two nodes using Poseidon
fn hash_two(left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
    poseidon_ark_vendored::poseidon_hash_two(left, right)
}

#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct LeanIMT {
    pub size: u64,
    pub depth: u32,
    pub _padding: u32, // Explicit padding for alignment
    pub side_nodes: [[u8; 32]; MAX_TREE_DEPTH + 1], // Store side nodes in fixed array
}

impl LeanIMT {
    pub fn new() -> Self {
        LeanIMT {
            size: 0,
            depth: 0,
            _padding: 0,
            side_nodes: [[0u8; 32]; MAX_TREE_DEPTH + 1],
        }
    }

    /// Inserts a new leaf into the tree.
    pub fn insert(&mut self, leaf: IMTNode) -> Result<IMTNode, ()> {
        use pinocchio_log::log;

        // Check if leaf is zero (not allowed)
        if leaf == [0u8; 32] {
            return Err(());
        }

        log!("LeanIMT insert: leaf first byte = {}", leaf[0]);

        let index = self.size;
        let mut tree_depth = self.depth as usize;

        // Increase tree depth if necessary
        if (1u64 << tree_depth) < index + 1 {
            tree_depth += 1;
            if tree_depth > MAX_TREE_DEPTH {
                return Err(());
            }
            self.depth = tree_depth as u32;
        }

        let mut node = leaf;

        for level in 0..tree_depth {
            if ((index >> level) & 1) == 1 {
                // If the bit at position `level` is 1, hash with the side node
                let side_node = self.side_nodes[level];
                // Use Poseidon hash
                node = hash_two(&side_node, &node);
            } else {
                // Else, store the node as side node
                self.side_nodes[level] = node;
            }
        }

        // Increment size
        self.size = index + 1;

        // Update the root node
        self.side_nodes[tree_depth] = node;

        log!(
            "LeanIMT insert complete: size={}, depth={}, root[0]={}",
            self.size,
            self.depth,
            node[0]
        );

        Ok(node)
    }

    /// Updates an existing leaf in the tree.
    pub fn update(
        &mut self,
        index: usize,
        new_leaf: IMTNode,
        sibling_nodes: &[IMTNode],
    ) -> Result<IMTNode, ()> {
        let mut node = new_leaf;
        let last_index = self.size - 1;
        let mut sibling_idx = 0;
        let tree_depth = self.depth as usize;

        for level in 0..tree_depth {
            if ((index >> level) & 1) == 1 {
                if sibling_idx >= sibling_nodes.len() {
                    return Err(());
                }
                let sibling_node = sibling_nodes[sibling_idx];
                node = hash_two(&sibling_node, &node);
                sibling_idx += 1;
            } else {
                if (index >> level) != ((last_index as usize) >> level) {
                    if sibling_idx >= sibling_nodes.len() {
                        return Err(());
                    }
                    let sibling_node = sibling_nodes[sibling_idx];
                    node = hash_two(&node, &sibling_node);
                    sibling_idx += 1;
                } else {
                    self.side_nodes[level] = node;
                }
            }
        }

        self.side_nodes[tree_depth] = node;
        Ok(node)
    }

    /// Returns the root of the tree.
    pub fn root(&self) -> [u8; 32] {
        let depth = self.depth as usize;
        if depth > MAX_TREE_DEPTH {
            return [0u8; 32];
        }
        self.side_nodes[depth]
    }

    /// Generate merkle proof for a leaf at given index
    pub fn generate_proof(&self, index: usize) -> Result<Vec<[u8; 32]>, ()> {
        if index >= self.size as usize {
            return Err(());
        }

        let mut siblings = Vec::new();
        let tree_depth = self.depth as usize;

        for level in 0..tree_depth {
            if ((index >> level) & 1) == 1 {
                // We're a right child, sibling is on the left
                siblings.push(self.side_nodes[level]);
            } else {
                // We're a left child
                // If we're not the last element at this level, sibling is on the right
                if (index >> level) != (((self.size - 1) as usize) >> level) {
                    // Sibling would need to be calculated or stored separately
                    // For now, we'll need to maintain this separately
                    siblings.push([0u8; 32]); // Placeholder
                }
            }
        }

        Ok(siblings)
    }

    pub fn get_size(&self) -> u64 {
        self.size
    }

    pub fn get_depth(&self) -> u32 {
        self.depth
    }
}
