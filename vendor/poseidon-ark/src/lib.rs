use pinocchio::syscalls::sol_poseidon;

// Matches the PoseidonInput struct from agave
#[repr(C)]
struct PoseidonInput {
    ptr: *const u8,
    len: usize,
}

pub struct Poseidon;

impl Poseidon {
    pub fn new() -> Poseidon {
        Poseidon
    }
}

/// Convenience function for hashing two 32-byte arrays
pub fn poseidon_hash_two(left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
    let poseidon = Poseidon::new();
    poseidon.hash_bytes(&[left, right]).unwrap_or([0u8; 32])
}

impl Poseidon {
    /// Hash function that uses Solana's native Poseidon syscall
    pub fn hash_bytes(&self, inputs: &[&[u8; 32]]) -> Result<[u8; 32], String> {
        if inputs.is_empty() {
            return Err("Empty input".to_string());
        }

        if inputs.len() > 12 {
            return Err("Too many inputs (max 12)".to_string());
        }

        let mut result = [0u8; 32];

        // Create an array of PoseidonInput structs, matching agave's approach
        let mut poseidon_inputs = Vec::with_capacity(inputs.len());
        for input in inputs {
            poseidon_inputs.push(PoseidonInput {
                ptr: input.as_ptr(),
                len: input.len(),
            });
        }

        // Call the syscall
        unsafe {
            let ret = sol_poseidon(
                0, // POSEIDON_PARAMETERS_BN254_X5
                0, // POSEIDON_ENDIANNESS_BIG_ENDIAN (to match JavaScript)
                poseidon_inputs.as_ptr() as *const u8,
                inputs.len() as u64,
                result.as_mut_ptr(),
            );

            if ret != 0 {
                return Err(format!("Poseidon syscall failed with code: {}", ret));
            }
        }

        Ok(result)
    }
}
