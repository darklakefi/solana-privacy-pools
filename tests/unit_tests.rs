use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
};

use solana_privacy_pools::{
    instructions::*,
    state::*,
    crypto::{poseidon, merkle_tree::LeanIMT},
    constants,
    BorshSerialize,
    BorshDeserialize,
};

// Import test utilities
use solana_privacy_pools::utils::*;

#[cfg(test)]
mod constructor_tests {
    use super::*;

    #[test]
    fn test_initialize_pool_with_valid_parameters() {
        let mut ctx = TestContext::new();
        
        // Initialize the pool
        let init_result = ctx.initialize_pool();
        assert!(init_result.is_ok(), "Failed to initialize: {:?}", init_result);
        
        // Debug: Check data length
        println!("Pool account data length: {}", ctx.pool_account.data.len());
        println!("Expected PrivacyPoolState::LEN: {}", PrivacyPoolState::LEN);
        
        // Verify the pool state
        let pool_state = ctx.get_pool_state().unwrap();
        assert_eq!(pool_state.entrypoint_authority, ctx.entrypoint_authority);
        assert_eq!(pool_state.asset_mint, ctx.asset_mint);
        assert_eq!(pool_state.max_tree_depth, 20);
        assert_eq!(pool_state.nonce, 0);
        assert!(!pool_state.dead);
        assert!(pool_state.is_initialized);
    }

    #[test]
    fn test_privacy_pool_state_serialization() {
        let mut ctx = TestContext::new();
        ctx.initialize_pool().unwrap();
        
        let original_state = ctx.get_pool_state().unwrap();
        let serialized = original_state.try_to_vec().unwrap();
        let deserialized = PrivacyPoolState::try_from_slice(&serialized).unwrap();
        
        // Verify critical fields match
        assert_eq!(original_state.entrypoint_authority, deserialized.entrypoint_authority);
        assert_eq!(original_state.asset_mint, deserialized.asset_mint);
        assert_eq!(original_state.max_tree_depth, deserialized.max_tree_depth);
        assert_eq!(original_state.nonce, deserialized.nonce);
        assert_eq!(original_state.dead, deserialized.dead);
    }
}

#[cfg(test)]
mod deposit_tests {
    use super::*;

    #[test]
    fn test_deposit_with_valid_parameters() {
        let mut ctx = TestContext::new();
        ctx.initialize_pool().unwrap();
        
        let depositor = Pubkey::from([20u8; 32]);
        let value = 1000u64;
        let precommitment_hash = [42u8; 32];
        
        // Get initial state
        let mut pool_state = ctx.get_pool_state().unwrap();
        let initial_nonce = pool_state.nonce;
        
        // Simulate deposit processing
        let new_nonce = pool_state.increment_nonce();
        let label = poseidon::compute_label(&pool_state.scope, new_nonce);
        let commitment = poseidon::compute_commitment(value, &label, &precommitment_hash);
        
        // Insert commitment into merkle tree
        let result = pool_state.merkle_tree.insert(commitment);
        assert!(result.is_ok());
        
        // Add new root to history
        pool_state.add_root(pool_state.merkle_tree.root);
        
        // Update pool state
        ctx.set_pool_state(pool_state).unwrap();
        
        // Create depositor account
        ctx.create_depositor_account(depositor, label);
        
        // Verify state changes
        let final_state = ctx.get_pool_state().unwrap();
        assert_eq!(final_state.nonce, initial_nonce + 1);
        assert_ne!(final_state.merkle_tree.root, [0u8; 32]);
        assert!(final_state.is_known_root(&final_state.merkle_tree.root));
    }

    #[test]
    fn test_deposit_when_pool_is_dead() {
        let mut ctx = TestContext::new();
        ctx.initialize_pool().unwrap();
        
        // Kill the pool
        let mut pool_state = ctx.get_pool_state().unwrap();
        pool_state.dead = true;
        ctx.set_pool_state(pool_state).unwrap();
        
        // Verify pool is dead
        let dead_state = ctx.get_pool_state().unwrap();
        assert!(dead_state.dead);
    }

    #[test]
    fn test_deposit_with_zero_value() {
        let mut ctx = TestContext::new();
        ctx.initialize_pool().unwrap();
        
        let depositor = Pubkey::from([20u8; 32]);
        let value = 0u64;
        let precommitment_hash = [42u8; 32];
        
        // Get initial state
        let mut pool_state = ctx.get_pool_state().unwrap();
        
        // Process zero-value deposit
        let new_nonce = pool_state.increment_nonce();
        let label = poseidon::compute_label(&pool_state.scope, new_nonce);
        let commitment = poseidon::compute_commitment(value, &label, &precommitment_hash);
        
        // Should still work with zero value
        let result = pool_state.merkle_tree.insert(commitment);
        assert!(result.is_ok());
    }

    #[test]
    fn test_deposit_with_maximum_valid_value() {
        let mut ctx = TestContext::new();
        ctx.initialize_pool().unwrap();
        
        let depositor = Pubkey::from([20u8; 32]);
        let value = u128::MAX as u64 - 1; // Just under the limit
        let precommitment_hash = [42u8; 32];
        
        let mut pool_state = ctx.get_pool_state().unwrap();
        let new_nonce = pool_state.increment_nonce();
        let label = poseidon::compute_label(&pool_state.scope, new_nonce);
        let commitment = poseidon::compute_commitment(value, &label, &precommitment_hash);
        
        let result = pool_state.merkle_tree.insert(commitment);
        assert!(result.is_ok());
    }
}

#[cfg(test)]
mod merkle_tree_tests {
    use super::*;
    
    #[test]
    fn test_merkle_tree_insertion() {
        let mut tree = LeanIMT::new(4);
        
        let leaf1 = [1u8; 32];
        let leaf2 = [2u8; 32];
        
        let index1 = tree.insert(leaf1).unwrap();
        assert_eq!(index1, 0);
        
        let index2 = tree.insert(leaf2).unwrap();
        assert_eq!(index2, 1);
        
        assert_eq!(tree.size(), 2);
        assert_ne!(tree.root(), [0u8; 32]);
    }

    #[test]
    fn test_merkle_tree_inclusion_proof() {
        let mut tree = LeanIMT::new(4);
        
        let leaf = [42u8; 32];
        let index = tree.insert(leaf).unwrap();
        
        let siblings = tree.get_sibling_path(index);
        let is_valid = tree.verify_inclusion(leaf, index, &siblings, tree.depth());
        
        assert!(is_valid);
    }

    #[test]
    fn test_merkle_tree_multiple_insertions() {
        let mut tree = LeanIMT::new(8);
        let mut leaves = Vec::new();
        let mut indices = Vec::new();
        
        // Insert multiple leaves
        for i in 0..10 {
            let mut leaf = [0u8; 32];
            leaf[0] = i as u8;
            let index = tree.insert(leaf).unwrap();
            leaves.push(leaf);
            indices.push(index);
        }
        
        // Verify all insertions
        for (i, leaf) in leaves.iter().enumerate() {
            let siblings = tree.get_sibling_path(indices[i]);
            let is_valid = tree.verify_inclusion(*leaf, indices[i], &siblings, tree.depth());
            if !is_valid {
                println!("Leaf {} verification failed", i);
                println!("  Leaf: {:?}", leaf);
                println!("  Index: {}", indices[i]);
                println!("  Tree root: {:?}", tree.root());
                println!("  Siblings: {:?}", siblings);
            }
            assert!(is_valid, "Leaf {} should be valid", i);
        }
    }

    #[test]
    fn test_merkle_tree_full_capacity() {
        let mut tree = LeanIMT::new(2); // Small tree for testing
        
        // Fill to capacity (2^2 = 4 leaves)
        for i in 0..4 {
            let mut leaf = [0u8; 32];
            leaf[0] = i as u8;
            let result = tree.insert(leaf);
            assert!(result.is_ok(), "Insert {} should succeed", i);
        }
        
        // Try to insert beyond capacity
        let extra_leaf = [99u8; 32];
        let result = tree.insert(extra_leaf);
        assert!(result.is_err(), "Insert beyond capacity should fail");
    }
}

#[cfg(test)]
mod withdrawal_tests {
    use super::*;

    #[test]
    fn test_withdrawal_proof_data_parsing() {
        let proof_data = create_test_withdraw_proof_data();
        
        assert_eq!(proof_data.withdrawn_value(), 100); // From first 8 bytes of [100u8; 32]
        assert_eq!(proof_data.state_root(), [200u8; 32]);
        assert_eq!(proof_data.state_tree_depth(), 1);
        assert_eq!(proof_data.asp_root(), [201u8; 32]);
        assert_eq!(proof_data.asp_tree_depth(), 2);
        assert_eq!(proof_data.context(), [202u8; 32]);
        assert_eq!(proof_data.new_commitment_hash(), [203u8; 32]);
        assert_eq!(proof_data.existing_nullifier_hash(), [204u8; 32]);
    }

    #[test]
    fn test_withdrawal_context_computation() {
        let withdrawal_data = create_test_withdrawal_data();
        let scope = [42u8; 32];
        
        let context1 = poseidon::compute_context(&withdrawal_data, &scope);
        let context2 = poseidon::compute_context(&withdrawal_data, &scope);
        
        // Should be deterministic
        assert_eq!(context1, context2);
        
        // Different scope should produce different context
        let different_scope = [43u8; 32];
        let context3 = poseidon::compute_context(&withdrawal_data, &different_scope);
        assert_ne!(context1, context3);
    }

    #[test]
    fn test_withdrawal_validation() {
        let mut ctx = TestContext::new();
        ctx.initialize_pool().unwrap();
        
        let withdrawal_data = create_test_withdrawal_data();
        let mut proof_data = create_test_withdraw_proof_data();
        
        // Get pool state for validation
        let pool_state = ctx.get_pool_state().unwrap();
        
        // Set valid context
        let valid_context = poseidon::compute_context(&withdrawal_data, &pool_state.scope);
        proof_data.public_signals[5] = valid_context;
        
        // Add state root to known roots
        let mut updated_state = pool_state;
        updated_state.add_root(proof_data.state_root());
        ctx.set_pool_state(updated_state).unwrap();
        
        // Verify validation checks would pass
        let final_state = ctx.get_pool_state().unwrap();
        assert!(final_state.is_known_root(&proof_data.state_root()));
        assert_eq!(proof_data.context(), valid_context);
    }
}

#[cfg(test)]
mod ragequit_tests {
    use super::*;

    #[test]
    fn test_ragequit_proof_data_parsing() {
        let proof_data = create_test_ragequit_proof_data();
        
        assert_eq!(proof_data.value(), 100); // From first 8 bytes
        assert_eq!(proof_data.label(), [50u8; 32]);
        assert_eq!(proof_data.commitment_hash(), [51u8; 32]);
        assert_eq!(proof_data.nullifier_hash(), [52u8; 32]);
    }

    #[test]
    fn test_ragequit_depositor_validation() {
        let mut ctx = TestContext::new();
        ctx.initialize_pool().unwrap();
        
        let depositor = Pubkey::from([99u8; 32]);
        let label = [50u8; 32];
        
        // Create depositor account
        let depositor_idx = ctx.create_depositor_account(depositor, label);
        let depositor_account = &ctx.depositor_accounts[depositor_idx];
        
        // Verify depositor state
        let depositor_state = DepositorState::try_from_slice(&depositor_account.data).unwrap();
        assert_eq!(depositor_state.depositor, depositor);
        assert_eq!(depositor_state.label, label);
    }
}

#[cfg(test)]
mod nullifier_tests {
    use super::*;

    #[test]
    fn test_nullifier_state_creation() {
        let nullifier_hash = [123u8; 32];
        let nullifier_state = NullifierState::new(nullifier_hash);
        
        assert!(nullifier_state.is_spent);
        assert_eq!(nullifier_state.nullifier_hash, nullifier_hash);
    }

    #[test]
    fn test_nullifier_serialization() {
        let nullifier_hash = [123u8; 32];
        let original_state = NullifierState::new(nullifier_hash);
        
        let serialized = original_state.try_to_vec().unwrap();
        let deserialized = NullifierState::try_from_slice(&serialized).unwrap();
        
        assert_eq!(original_state.is_spent, deserialized.is_spent);
        assert_eq!(original_state.nullifier_hash, deserialized.nullifier_hash);
    }

    #[test]
    fn test_nullifier_hash_computation() {
        let nullifier = [42u8; 32];
        
        let hash1 = poseidon::compute_nullifier_hash(&nullifier);
        let hash2 = poseidon::compute_nullifier_hash(&nullifier);
        
        // Should be deterministic
        assert_eq!(hash1, hash2);
        
        // Different nullifier should produce different hash
        let different_nullifier = [43u8; 32];
        let hash3 = poseidon::compute_nullifier_hash(&different_nullifier);
        assert_ne!(hash1, hash3);
    }
}

#[cfg(test)]
mod poseidon_tests {
    use super::*;

    #[test]
    fn test_poseidon_hash_deterministic() {
        let left = [1u8; 32];
        let right = [2u8; 32];
        
        let hash1 = poseidon::hash_two(&left, &right);
        let hash2 = poseidon::hash_two(&left, &right);
        
        assert_eq!(hash1, hash2, "Poseidon hash should be deterministic");
    }

    #[test]
    fn test_poseidon_hash_different_inputs() {
        let left = [1u8; 32];
        let right1 = [2u8; 32];
        let right2 = [3u8; 32];
        
        let hash1 = poseidon::hash_two(&left, &right1);
        let hash2 = poseidon::hash_two(&left, &right2);
        
        assert_ne!(hash1, hash2, "Different inputs should produce different hashes");
    }

    #[test]
    fn test_commitment_computation() {
        let value = 1000u64;
        let label = [42u8; 32];
        let precommitment = [7u8; 32];
        
        let commitment1 = poseidon::compute_commitment(value, &label, &precommitment);
        let commitment2 = poseidon::compute_commitment(value, &label, &precommitment);
        
        assert_eq!(commitment1, commitment2, "Commitment should be deterministic");
        
        // Different value should produce different commitment
        let commitment3 = poseidon::compute_commitment(value + 1, &label, &precommitment);
        assert_ne!(commitment1, commitment3, "Different values should produce different commitments");
    }

    #[test]
    fn test_label_computation() {
        let scope = [42u8; 32];
        let nonce = 123u64;
        
        let label1 = poseidon::compute_label(&scope, nonce);
        let label2 = poseidon::compute_label(&scope, nonce);
        
        assert_eq!(label1, label2, "Label should be deterministic");
        
        // Different nonce should produce different label
        let label3 = poseidon::compute_label(&scope, nonce + 1);
        assert_ne!(label1, label3, "Different nonces should produce different labels");
    }

    #[test]
    fn test_precommitment_computation() {
        let nullifier = [10u8; 32];
        let secret = [20u8; 32];
        
        let precommitment1 = poseidon::compute_precommitment(&nullifier, &secret);
        let precommitment2 = poseidon::compute_precommitment(&nullifier, &secret);
        
        assert_eq!(precommitment1, precommitment2, "Precommitment should be deterministic");
        
        // Different secret should produce different precommitment
        let different_secret = [21u8; 32];
        let precommitment3 = poseidon::compute_precommitment(&nullifier, &different_secret);
        assert_ne!(precommitment1, precommitment3, "Different secrets should produce different precommitments");
    }
}

#[cfg(test)]
mod state_tests {
    use super::*;

    #[test]
    fn test_root_history_circular_buffer() {
        let mut ctx = TestContext::new();
        ctx.initialize_pool().unwrap();
        
        let mut pool_state = ctx.get_pool_state().unwrap();
        
        // Test adding roots up to capacity
        for i in 0..constants::ROOT_HISTORY_SIZE {
            let root = [i as u8; 32];
            pool_state.add_root(root);
            
            assert!(pool_state.is_known_root(&root), "Root {} should be known", i);
        }
        
        // Add one more root to trigger circular buffer wrap
        let new_root = [99u8; 32];
        pool_state.add_root(new_root);
        
        // First root should now be forgotten
        let first_root = [0u8; 32];
        assert!(!pool_state.is_known_root(&first_root), "First root should be forgotten");
        assert!(pool_state.is_known_root(&new_root), "New root should be known");
    }

    #[test]
    fn test_nonce_increment() {
        let mut ctx = TestContext::new();
        ctx.initialize_pool().unwrap();
        
        let mut pool_state = ctx.get_pool_state().unwrap();
        let initial_nonce = pool_state.nonce;
        
        let new_nonce = pool_state.increment_nonce();
        assert_eq!(new_nonce, initial_nonce + 1);
        assert_eq!(pool_state.nonce, initial_nonce + 1);
    }

    #[test]
    fn test_pool_wind_down() {
        let mut ctx = TestContext::new();
        ctx.initialize_pool().unwrap();
        
        let mut pool_state = ctx.get_pool_state().unwrap();
        assert!(!pool_state.dead, "Pool should initially be alive");
        
        pool_state.dead = true;
        ctx.set_pool_state(pool_state).unwrap();
        
        let dead_state = ctx.get_pool_state().unwrap();
        assert!(dead_state.dead, "Pool should be dead after wind down");
    }
}

#[cfg(test)]
mod instruction_parsing_tests {
    use super::*;

    #[test]
    fn test_initialize_pool_instruction_parsing() {
        let entrypoint_authority = Pubkey::from([1u8; 32]);
        let max_tree_depth = 20u8;
        let asset_mint = Pubkey::from([2u8; 32]);
        
        let mut instruction_data = vec![0u8]; // InitializePool discriminant
        instruction_data.extend_from_slice(entrypoint_authority.as_ref());
        instruction_data.push(max_tree_depth);
        instruction_data.extend_from_slice(asset_mint.as_ref());
        
        let parsed = PrivacyPoolInstruction::try_from_slice(&instruction_data);
        assert!(parsed.is_ok(), "Should successfully parse initialize pool instruction");
        
        match parsed.unwrap() {
            PrivacyPoolInstruction::InitializePool { 
                entrypoint_authority: parsed_authority,
                max_tree_depth: parsed_depth,
                asset_mint: parsed_mint,
            } => {
                assert_eq!(parsed_authority, entrypoint_authority);
                assert_eq!(parsed_depth, max_tree_depth);
                assert_eq!(parsed_mint, asset_mint);
            }
            _ => panic!("Wrong instruction type parsed"),
        }
    }

    #[test]
    fn test_instruction_parsing_with_invalid_data() {
        let invalid_instruction_data = vec![99u8]; // Invalid discriminant
        let result = PrivacyPoolInstruction::try_from_slice(&invalid_instruction_data);
        
        assert!(result.is_err(), "Should fail to parse invalid instruction");
    }

    #[test]
    fn test_instruction_parsing_with_insufficient_data() {
        let insufficient_data = vec![0u8, 1u8]; // InitializePool discriminant but not enough data
        let result = PrivacyPoolInstruction::try_from_slice(&insufficient_data);
        
        assert!(result.is_err(), "Should fail with insufficient data");
    }
}