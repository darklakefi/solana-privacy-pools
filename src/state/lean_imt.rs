use crate::crypto::poseidon;

// Use the vendored LeanIMT implementation
pub use lean_imt::solana_impl::{LeanIMT, IMTNode, MAX_TREE_DEPTH};

// Helper function for Poseidon hash
pub fn poseidon_hash(left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
    poseidon::hash_two(left, right)
}

// Create a new LeanIMT (always uses Poseidon hash)
pub fn new_poseidon_tree() -> LeanIMT {
    LeanIMT::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_lean_imt_insert() {
        let mut tree = new_poseidon_tree();
        let leaf = [1u8; 32];
        
        assert_eq!(tree.get_size(), 0);
        assert_eq!(tree.get_depth(), 0);
        
        let root = tree.insert(leaf).unwrap();
        assert_eq!(tree.get_size(), 1);
        assert_eq!(tree.root(), root);
    }

    #[test]
    fn test_lean_imt_multiple_inserts() {
        let mut tree = new_poseidon_tree();
        
        let leaf1 = [1u8; 32];
        let leaf2 = [2u8; 32];
        let leaf3 = [3u8; 32];
        
        tree.insert(leaf1).unwrap();
        assert_eq!(tree.get_size(), 1);
        assert_eq!(tree.get_depth(), 0);
        
        tree.insert(leaf2).unwrap();
        assert_eq!(tree.get_size(), 2);
        assert_eq!(tree.get_depth(), 1);
        
        tree.insert(leaf3).unwrap();
        assert_eq!(tree.get_size(), 3);
        assert_eq!(tree.get_depth(), 2);
    }
}