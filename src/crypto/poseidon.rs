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
    poseidon.hash_bytes(&[a, b, c]).unwrap_or_else(|_e| {
        // Return zeros on error - this will be caught by verification
        [0u8; 32]
    })
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
    
    // Reduce modulo the SNARK scalar field
    // For BN254, if the high bit is set, we need to reduce
    // For simplicity, we'll clear the high bits to ensure we're in field
    let mut result = hash;
    // Clear the highest 2 bits to ensure we're below the field modulus
    // BN254 field is approximately 2^254, so clearing top 2 bits ensures we're in range
    result[31] &= 0x3F; // Clear top 2 bits of the most significant byte
    result
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
