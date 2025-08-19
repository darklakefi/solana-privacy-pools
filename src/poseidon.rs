use poseidon_ark::Poseidon;
use ark_bn254::Fr;
use crate::instructions::WithdrawalData;

/// Convert bytes to field element
fn bytes_to_fr(bytes: &[u8; 32]) -> Fr {
    Fr::from_le_bytes_mod_order(bytes)
}

/// Convert u64 to field element  
fn u64_to_fr(value: u64) -> Fr {
    Fr::from(value)
}

/// Convert field element back to bytes
fn fr_to_bytes(fr: &Fr) -> [u8; 32] {
    let mut bytes = [0u8; 32];
    let repr = fr.into_repr();
    bytes.copy_from_slice(&repr.to_bytes_le()[..32]);
    bytes
}

/// Poseidon hash of two field elements
pub fn hash_two(left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
    let left_fr = bytes_to_fr(left);
    let right_fr = bytes_to_fr(right);
    
    let poseidon = Poseidon::new();
    let result = poseidon.hash(&[left_fr, right_fr]).unwrap();
    
    fr_to_bytes(&result)
}

/// Poseidon hash of three field elements
pub fn hash_three(a: &[u8; 32], b: &[u8; 32], c: &[u8; 32]) -> [u8; 32] {
    let a_fr = bytes_to_fr(a);
    let b_fr = bytes_to_fr(b);
    let c_fr = bytes_to_fr(c);
    
    let poseidon = Poseidon::new();
    let result = poseidon.hash(&[a_fr, b_fr, c_fr]).unwrap();
    
    fr_to_bytes(&result)
}

/// Poseidon hash of four field elements
pub fn hash_four(a: &[u8; 32], b: &[u8; 32], c: &[u8; 32], d: &[u8; 32]) -> [u8; 32] {
    let a_fr = bytes_to_fr(a);
    let b_fr = bytes_to_fr(b);
    let c_fr = bytes_to_fr(c);
    let d_fr = bytes_to_fr(d);
    
    let poseidon = Poseidon::new();
    let result = poseidon.hash(&[a_fr, b_fr, c_fr, d_fr]).unwrap();
    
    fr_to_bytes(&result)
}

/// Compute label from scope and nonce: keccak256(scope, nonce) % SNARK_SCALAR_FIELD
pub fn compute_label(scope: &[u8; 32], nonce: u64) -> [u8; 32] {
    use pinocchio::keccak;
    
    let mut hasher = keccak::Hasher::default();
    hasher.hash(scope);
    hasher.hash(&nonce.to_le_bytes());
    let hash = hasher.result().to_bytes();
    
    // Reduce modulo SNARK_SCALAR_FIELD
    let hash_fr = bytes_to_fr(&hash);
    fr_to_bytes(&hash_fr)
}

/// Compute commitment hash: PoseidonT4.hash([value, label, precommitment_hash])  
pub fn compute_commitment(value: u64, label: &[u8; 32], precommitment_hash: &[u8; 32]) -> [u8; 32] {
    let mut value_bytes = [0u8; 32];
    value_bytes[..8].copy_from_slice(&value.to_le_bytes());
    
    hash_three(&value_bytes, label, precommitment_hash)
}

/// Compute nullifier hash from nullifier using Poseidon
pub fn compute_nullifier_hash(nullifier: &[u8; 32]) -> [u8; 32] {
    let nullifier_fr = bytes_to_fr(nullifier);
    
    let poseidon = Poseidon::new();
    let result = poseidon.hash(&[nullifier_fr]).unwrap();
    
    fr_to_bytes(&result)
}

/// Compute precommitment: Poseidon(nullifier, secret)
pub fn compute_precommitment(nullifier: &[u8; 32], secret: &[u8; 32]) -> [u8; 32] {
    hash_two(nullifier, secret)
}

/// Compute context hash for withdrawal integrity
/// context = keccak256(abi.encode(_withdrawal, SCOPE)) % SNARK_SCALAR_FIELD
pub fn compute_context(withdrawal: &WithdrawalData, scope: &[u8; 32]) -> [u8; 32] {
    use pinocchio::keccak;
    
    let mut hasher = keccak::Hasher::default();
    hasher.hash(b"IPrivacyPool.Withdrawal");
    hasher.hash(withdrawal.processooor.as_ref());
    hasher.hash(&withdrawal.data);
    hasher.hash(scope);
    
    let hash = hasher.result().to_bytes();
    
    // Reduce modulo SNARK_SCALAR_FIELD  
    let hash_fr = bytes_to_fr(&hash);
    fr_to_bytes(&hash_fr)
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
        
        // Different nullifiers should produce different hashes
        let nullifier2 = [124u8; 32];
        let hash3 = compute_nullifier_hash(&nullifier2);
        assert_ne!(hash1, hash3);
    }
}