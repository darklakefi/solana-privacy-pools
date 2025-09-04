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
    use pinocchio_log::log;
    let poseidon = Poseidon::new();
    match poseidon.hash_bytes(&[left, right]) {
        Ok(result) => result,
        Err(_e) => {
            log!("poseidon_hash_two error occurred");
            [0u8; 32]
        }
    }
}

impl Poseidon {
    /// Hash function that uses Solana's native Poseidon syscall
    pub fn hash_bytes(&self, inputs: &[&[u8; 32]]) -> Result<[u8; 32], String> {
        use pinocchio_log::log;
        log!("hash_bytes: entering function");
        
        if inputs.is_empty() {
            log!("hash_bytes: error - empty input");
            return Err("Empty input".to_string());
        }

        if inputs.len() > 12 {
            log!("hash_bytes: error - too many inputs");
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

        // Debug logging
        log!("Poseidon syscall: 2 inputs");
        log!("  Input 0: first 4 bytes = [{}, {}, {}, {}]", 
             inputs[0][0], inputs[0][1], inputs[0][2], inputs[0][3]);
        if inputs.len() > 1 {
            log!("  Input 1: first 4 bytes = [{}, {}, {}, {}]", 
                 inputs[1][0], inputs[1][1], inputs[1][2], inputs[1][3]);
        }

        // Call the syscall
        unsafe {
            let ret = sol_poseidon(
                0, // POSEIDON_PARAMETERS_BN254_X5
                0, // POSEIDON_ENDIANNESS_BIG_ENDIAN (to match Circom/JavaScript)
                poseidon_inputs.as_ptr() as *const u8,
                inputs.len() as u64,
                result.as_mut_ptr(),
            );

            if ret != 0 {
                log!("hash_bytes: syscall failed with code: {}", ret);
                return Err(format!("Poseidon syscall failed with code: {}", ret));
            }
        }

        // Result is already in big-endian format from syscall
        log!("hash_bytes: success, result[0]={}", result[0]);
        Ok(result)
    }
}
