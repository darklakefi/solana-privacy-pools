/// Lean Incremental Merkle Tree implementation for Solana
/// Based on the LeanIMT design from the Solidity contract

use crate::poseidon;

pub struct LeanIMT {
    pub depth: u8,
    pub size: u64,
    pub filled_subtrees: Vec<[u8; 32]>,
    pub zeros: Vec<[u8; 32]>,
    pub root: [u8; 32],
}

impl LeanIMT {
    pub fn new(depth: u8) -> Self {
        let zeros = Self::compute_zeros(depth);
        let root = zeros[depth as usize];
        
        Self {
            depth,
            size: 0,
            filled_subtrees: vec![[0u8; 32]; depth as usize],
            zeros,
            root,
        }
    }
    
    fn compute_zeros(depth: u8) -> Vec<[u8; 32]> {
        let mut zeros = vec![[0u8; 32]; (depth + 1) as usize];
        
        // Initialize with a deterministic zero value
        zeros[0] = [0u8; 32];
        
        // Compute zero hashes for each level
        for i in 1..=depth as usize {
            zeros[i] = poseidon::hash_two(&zeros[i-1], &zeros[i-1]);
        }
        
        zeros
    }
    
    pub fn insert(&mut self, leaf: [u8; 32]) -> Result<u64, &'static str> {
        if self.size >= (1u64 << self.depth) {
            return Err("Tree is full");
        }
        
        let index = self.size;
        self.size += 1;
        
        let mut current_index = index;
        let mut current_hash = leaf;
        
        for level in 0..self.depth {
            if current_index % 2 == 0 {
                // Left node - store for future pairing
                self.filled_subtrees[level as usize] = current_hash;
                // Pair with zero on the right
                current_hash = poseidon::hash_two(&current_hash, &self.zeros[level as usize]);
            } else {
                // Right node - pair with stored left
                current_hash = poseidon::hash_two(&self.filled_subtrees[level as usize], &current_hash);
            }
            
            current_index /= 2;
        }
        
        self.root = current_hash;
        Ok(index)
    }
    
    pub fn verify_inclusion(
        &self,
        leaf: [u8; 32],
        index: u64,
        siblings: &[[u8; 32]],
        depth: u8,
    ) -> bool {
        if depth > self.depth {
            return false;
        }
        
        let mut current_hash = leaf;
        let mut current_index = index;
        
        for i in 0..depth {
            let sibling = siblings[i as usize];
            
            if current_index % 2 == 0 {
                // Current is left child
                current_hash = poseidon::hash_two(&current_hash, &sibling);
            } else {
                // Current is right child  
                current_hash = poseidon::hash_two(&sibling, &current_hash);
            }
            
            current_index /= 2;
        }
        
        current_hash == self.root
    }
    
    pub fn get_sibling_path(&self, index: u64) -> Vec<[u8; 32]> {
        let mut siblings = Vec::new();
        let mut current_index = index;
        
        for level in 0..self.depth {
            if current_index % 2 == 0 {
                // Left node - sibling is on the right
                if current_index + 1 < (self.size >> level) {
                    // Sibling exists in tree
                    siblings.push(self.get_node_at_level(level, current_index + 1));
                } else {
                    // Sibling is zero
                    siblings.push(self.zeros[level as usize]);
                }
            } else {
                // Right node - sibling is on the left
                siblings.push(self.get_node_at_level(level, current_index - 1));
            }
            
            current_index /= 2;
        }
        
        siblings
    }
    
    fn get_node_at_level(&self, level: u8, index: u64) -> [u8; 32] {
        if level == 0 {
            [0u8; 32]
        } else if index % 2 == 1 {
            self.filled_subtrees[level as usize]
        } else {
            self.zeros[level as usize]
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_lean_imt_creation() {
        let tree = LeanIMT::new(4);
        assert_eq!(tree.depth, 4);
        assert_eq!(tree.size, 0);
        assert_eq!(tree.filled_subtrees.len(), 4);
        assert_eq!(tree.zeros.len(), 5);
    }
    
    #[test]
    fn test_leaf_insertion() {
        let mut tree = LeanIMT::new(4);
        let leaf1 = [1u8; 32];
        let leaf2 = [2u8; 32];
        
        let index1 = tree.insert(leaf1).unwrap();
        assert_eq!(index1, 0);
        assert_eq!(tree.size, 1);
        
        let index2 = tree.insert(leaf2).unwrap();
        assert_eq!(index2, 1);
        assert_eq!(tree.size, 2);
    }
    
    #[test]
    fn test_inclusion_proof() {
        let mut tree = LeanIMT::new(4);
        let leaf = [42u8; 32];
        
        let index = tree.insert(leaf).unwrap();
        let siblings = tree.get_sibling_path(index);
        
        assert!(tree.verify_inclusion(leaf, index, &siblings, tree.depth));
    }
}