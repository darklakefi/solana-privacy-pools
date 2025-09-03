use crate::instructions::types::WithdrawalData;
use ark_bn254::Fr;
use ark_ff::{BigInteger, PrimeField};
use poseidon_ark::Poseidon;

/// Poseidon hash of two byte arrays
pub fn hash_two(left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
    let poseidon = Poseidon::new();
    poseidon
        .hash_bytes(&[left, right])
        .unwrap_or_else(|_| [0u8; 32])
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
    poseidon
        .hash_bytes(&[a, b, c, d])
        .unwrap_or_else(|_| [0u8; 32])
}

/// Compute label from scope and nonce: keccak256(scope, nonce) % SNARK_SCALAR_FIELD
pub fn compute_label(scope: &[u8; 32], nonce: u64) -> [u8; 32] {
    use pinocchio::syscalls::sol_keccak256;

    // Concatenate scope and nonce
    let mut data = Vec::with_capacity(40);
    data.extend_from_slice(scope);
    data.extend_from_slice(&nonce.to_le_bytes());

    // Compute keccak256 hash
    // sol_keccak256 expects array of slices
    let slices: [&[u8]; 1] = [data.as_slice()];

    let mut hash = [0u8; 32];
    unsafe {
        sol_keccak256(
            slices.as_ptr() as *const u8,
            slices.len() as u64,
            hash.as_mut_ptr(),
        );
    }

    // Proper modulo reduction using arkworks
    // Convert hash to field element (this automatically reduces modulo the field)
    let mut hash_copy = hash;
    hash_copy.reverse(); // Convert to little-endian for Fr::from_le_bytes_mod_order
    let field_element = Fr::from_le_bytes_mod_order(&hash_copy);

    // Convert back to big-endian bytes
    let mut result_vec = field_element.into_bigint().to_bytes_le();
    result_vec.reverse(); // Convert back to big-endian

    // Convert Vec<u8> to [u8; 32]
    let mut result = [0u8; 32];
    result.copy_from_slice(&result_vec);
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
    poseidon
        .hash_bytes(&[nullifier])
        .unwrap_or_else(|_| [0u8; 32])
}

/// Compute precommitment: Poseidon(nullifier, secret)
pub fn compute_precommitment(nullifier: &[u8; 32], secret: &[u8; 32]) -> [u8; 32] {
    hash_two(nullifier, secret)
}

/// Compute context hash for withdrawal integrity
/// context = keccak256(abi.encode(_withdrawal, SCOPE)) % SNARK_SCALAR_FIELD
pub fn compute_context(withdrawal: &WithdrawalData, scope: &[u8; 32]) -> [u8; 32] {
    use pinocchio::syscalls::sol_keccak256;

    // Concatenate all data for hashing
    let mut data = Vec::new();
    data.extend_from_slice(b"IPrivacyPool.Withdrawal");
    data.extend_from_slice(withdrawal.processooor.as_ref());
    data.extend_from_slice(&withdrawal.data);
    data.extend_from_slice(scope);

    // Compute keccak256 hash
    // sol_keccak256 expects array of slices
    let slices: [&[u8]; 1] = [data.as_slice()];

    let mut hash = [0u8; 32];
    unsafe {
        sol_keccak256(
            slices.as_ptr() as *const u8,
            slices.len() as u64,
            hash.as_mut_ptr(),
        );
    }

    // Proper modulo reduction using arkworks
    // Convert hash to field element (this automatically reduces modulo the field)
    let mut hash_copy = hash;
    hash_copy.reverse(); // Convert to little-endian for Fr::from_le_bytes_mod_order
    let field_element = Fr::from_le_bytes_mod_order(&hash_copy);

    // Convert back to big-endian bytes
    let mut result_vec = field_element.into_bigint().to_bytes_le();
    result_vec.reverse(); // Convert back to big-endian

    // Convert Vec<u8> to [u8; 32]
    let mut result = [0u8; 32];
    result.copy_from_slice(&result_vec);
    result
}
