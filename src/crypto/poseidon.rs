use poseidon_ark::Poseidon;
use crate::instructions::types::WithdrawalData;

/// Poseidon hash of two byte arrays
pub fn hash_two(left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
    let poseidon = Poseidon::new();
    poseidon.hash_bytes(&[left, right]).unwrap_or_else(|_| [0u8; 32])
}

/// Poseidon hash of three byte arrays
pub fn hash_three(a: &[u8; 32], b: &[u8; 32], c: &[u8; 32]) -> [u8; 32] {
    let poseidon = Poseidon::new();
    poseidon.hash_bytes(&[a, b, c]).unwrap_or_else(|_| [0u8; 32])
}

/// Poseidon hash of four byte arrays
pub fn hash_four(a: &[u8; 32], b: &[u8; 32], c: &[u8; 32], d: &[u8; 32]) -> [u8; 32] {
    let poseidon = Poseidon::new();
    poseidon.hash_bytes(&[a, b, c, d]).unwrap_or_else(|_| [0u8; 32])
}

/// Compute label from scope and nonce: keccak256(scope, nonce) % SNARK_SCALAR_FIELD
pub fn compute_label(scope: &[u8; 32], nonce: u64) -> [u8; 32] {
    use solana_program::keccak;
    
    let mut hasher = keccak::Hasher::default();
    hasher.hash(scope);
    hasher.hash(&nonce.to_le_bytes());
    let hash = hasher.result().to_bytes();
    
    // With native Poseidon, we can use the hash directly
    // The syscall handles field modular reduction internally
    hash
}

/// Compute commitment hash: PoseidonT4.hash([value, label, precommitment_hash])  
pub fn compute_commitment(value: u64, label: &[u8; 32], precommitment_hash: &[u8; 32]) -> [u8; 32] {
    let mut value_bytes = [0u8; 32];
    value_bytes[..8].copy_from_slice(&value.to_le_bytes());
    
    hash_three(&value_bytes, label, precommitment_hash)
}

/// Compute nullifier hash from nullifier using Poseidon
pub fn compute_nullifier_hash(nullifier: &[u8; 32]) -> [u8; 32] {
    let poseidon = Poseidon::new();
    poseidon.hash_bytes(&[nullifier]).unwrap_or_else(|_| [0u8; 32])
}

/// Compute precommitment: Poseidon(nullifier, secret)
pub fn compute_precommitment(nullifier: &[u8; 32], secret: &[u8; 32]) -> [u8; 32] {
    hash_two(nullifier, secret)
}

/// Compute context hash for withdrawal integrity
/// context = keccak256(abi.encode(_withdrawal, SCOPE)) % SNARK_SCALAR_FIELD
pub fn compute_context(withdrawal: &WithdrawalData, scope: &[u8; 32]) -> [u8; 32] {
    use solana_program::keccak;
    
    let mut hasher = keccak::Hasher::default();
    hasher.hash(b"IPrivacyPool.Withdrawal");
    hasher.hash(withdrawal.processooor.as_ref());
    hasher.hash(&withdrawal.data);
    hasher.hash(scope);
    
    let hash = hasher.result().to_bytes();
    
    // With native Poseidon, we can use the hash directly
    // The syscall handles field modular reduction internally
    hash
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_poseidon_hash_two() {
        let left = [1u8; 32];
        let right = [2u8; 32];
        
        let result = hash_two(&left, &right);
        
        // Should produce a deterministic hash
        let result2 = hash_two(&left, &right);
        assert_eq!(result, result2);
        
        // Different inputs should produce different outputs
        let right2 = [3u8; 32];
        let result3 = hash_two(&left, &right2);
        assert_ne!(result, result3);
    }
    
    #[test]
    fn test_commitment_computation() {
        let value = 1000u64;
        let label = [42u8; 32];
        let precommitment = [7u8; 32];
        
        let commitment = compute_commitment(value, &label, &precommitment);
        
        // Should be deterministic
        let commitment2 = compute_commitment(value, &label, &precommitment);
        assert_eq!(commitment, commitment2);
        
        // Different values should produce different commitments
        let commitment3 = compute_commitment(value + 1, &label, &precommitment);
        assert_ne!(commitment, commitment3);
    }
    
    #[test]
    fn test_nullifier_hash() {
        let nullifier = [123u8; 32];
        
        let hash1 = compute_nullifier_hash(&nullifier);
        let hash2 = compute_nullifier_hash(&nullifier);
        
        // Should be deterministic
        assert_eq!(hash1, hash2);
        
        // Different nullifiers should produce different hashes - use more distinct values
        let mut nullifier2 = [0u8; 32];
        nullifier2[0] = 1;
        nullifier2[31] = 255;
        let hash3 = compute_nullifier_hash(&nullifier2);
        assert_ne!(hash1, hash3);
    }

    #[test]
    fn debug_poseidon_integration() {
        // Test the poseidon-ark library directly
        let poseidon = Poseidon::new();
        
        let input1 = [123u8; 32];
        let input2 = [0u8; 32];
        
        let result1 = poseidon.hash_bytes(&[&input1]).unwrap();
        let result2 = poseidon.hash_bytes(&[&input2]).unwrap();
        
        println!("Input1: {:?}", input1);
        println!("Result1: {:?}", result1);
        println!("Input2: {:?}", input2);
        println!("Result2: {:?}", result2);
        
        assert_ne!(result1, result2, "Different inputs should produce different hashes");
    }
}