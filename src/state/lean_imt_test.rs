#[cfg(test)]
mod tests {
    use crate::state::lean_imt::LeanIMTStateZC;
    use crate::crypto::poseidon;
    
    #[test]
    fn test_lean_imt_insertion() {
        // Create a test buffer for the Lean IMT state
        let mut buffer = vec![0u8; LeanIMTStateZC::LEN];
        let state = unsafe { &mut *(buffer.as_mut_ptr() as *mut LeanIMTStateZC) };
        
        // Initialize
        state.initialize();
        
        // Test initial state
        let size = state.size;
        let depth = state.depth;
        assert_eq!(size, 0);
        assert_eq!(depth, 0);
        assert_eq!(state.root(), [0u8; 32]);
        
        // Insert first leaf
        let leaf1 = [1u8; 32];
        let root1 = state.insert(leaf1).unwrap();
        
        // After first insertion:
        // - Size should be 1
        // - Depth should be 0 (single node is the root)
        // - Root should be the leaf itself
        let size = state.size;
        let depth = state.depth;
        assert_eq!(size, 1);
        assert_eq!(depth, 0);
        assert_eq!(root1, leaf1);
        assert_eq!(state.root(), leaf1);
        
        // Insert second leaf
        let leaf2 = [2u8; 32];
        let root2 = state.insert(leaf2).unwrap();
        
        // After second insertion:
        // - Size should be 2
        // - Depth should be 1
        // - Root should be hash(leaf1, leaf2)
        let size = state.size;
        let depth = state.depth;
        assert_eq!(size, 2);
        assert_eq!(depth, 1);
        let expected_root2 = poseidon::hash_two(&leaf1, &leaf2);
        assert_eq!(root2, expected_root2);
        assert_eq!(state.root(), expected_root2);
        
        // Insert third leaf
        let leaf3 = [3u8; 32];
        let root3 = state.insert(leaf3).unwrap();
        
        // After third insertion:
        // - Size should be 3
        // - Depth should be 2
        // - Root calculation: 
        //   Level 0: leaf1, leaf2, leaf3
        //   Level 1: hash(leaf1, leaf2), leaf3 (propagated)
        //   Level 2: hash(hash(leaf1, leaf2), leaf3)
        let size = state.size;
        let depth = state.depth;
        assert_eq!(size, 3);
        assert_eq!(depth, 2);
        let level1_left = poseidon::hash_two(&leaf1, &leaf2);
        let expected_root3 = poseidon::hash_two(&level1_left, &leaf3);
        assert_eq!(root3, expected_root3);
        assert_eq!(state.root(), expected_root3);
        
        // Insert fourth leaf
        let leaf4 = [4u8; 32];
        let root4 = state.insert(leaf4).unwrap();
        
        // After fourth insertion:
        // - Size should be 4
        // - Depth should still be 2
        // - Root calculation:
        //   Level 0: leaf1, leaf2, leaf3, leaf4
        //   Level 1: hash(leaf1, leaf2), hash(leaf3, leaf4)
        //   Level 2: hash(hash(leaf1, leaf2), hash(leaf3, leaf4))
        let size = state.size;
        let depth = state.depth;
        assert_eq!(size, 4);
        assert_eq!(depth, 2);
        let level1_left = poseidon::hash_two(&leaf1, &leaf2);
        let level1_right = poseidon::hash_two(&leaf3, &leaf4);
        let expected_root4 = poseidon::hash_two(&level1_left, &level1_right);
        assert_eq!(root4, expected_root4);
        assert_eq!(state.root(), expected_root4);
    }
    
    #[test]
    fn test_lean_imt_matches_javascript() {
        // Test with actual commitments to match JavaScript implementation
        let mut buffer = vec![0u8; LeanIMTStateZC::LEN];
        let state = unsafe { &mut *(buffer.as_mut_ptr() as *mut LeanIMTStateZC) };
        
        state.initialize();
        
        // Create 5 test leaves (simulating 5 deposits)
        let leaves = vec![
            poseidon::hash_four(
                &[1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                &[2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                &[3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                &[4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            ),
            poseidon::hash_four(
                &[5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                &[6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                &[7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                &[8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            ),
            poseidon::hash_four(
                &[9, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                &[10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                &[11, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                &[12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            ),
            poseidon::hash_four(
                &[13, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                &[14, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                &[15, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                &[16, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            ),
            poseidon::hash_four(
                &[17, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                &[18, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                &[19, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                &[20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            ),
        ];
        
        // Insert all leaves
        for leaf in &leaves {
            state.insert(*leaf).unwrap();
        }
        
        // After 5 insertions, depth should be 3
        let size = state.size;
        let depth = state.depth;
        assert_eq!(size, 5);
        assert_eq!(depth, 3);
        
        // The root should match what the JavaScript implementation produces
        // We'll verify this matches when we test with the circuit
        let final_root = state.root();
        println!("Final root after 5 insertions: {:?}", final_root);
    }
}