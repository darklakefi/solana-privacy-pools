use crate::crypto::poseidon;
use pinocchio::{msg, ProgramResult};

/// Test instruction to compute Poseidon hash and log the result
pub fn test_poseidon(left: [u8; 32], right: [u8; 32]) -> ProgramResult {
    msg!("Testing Poseidon hash...");

    // Log input values
    msg!("Left input (hex): ");
    log_hex(&left);
    msg!("Right input (hex): ");
    log_hex(&right);

    // Compute Poseidon hash using our implementation
    let hash = poseidon::hash_two(&left, &right);

    // Log the result
    msg!("Poseidon hash result (hex): ");
    log_hex(&hash);

    Ok(())
}

fn log_hex(bytes: &[u8; 32]) {
    // Log in 8-byte chunks for readability
    let mut hex_string = [0u8; 16];
    for i in 0..4 {
        // Convert 8 bytes to hex
        for j in 0..8 {
            let byte = bytes[i * 8 + j];
            let high = (byte >> 4) & 0xF;
            let low = byte & 0xF;
            hex_string[j * 2] = if high < 10 {
                b'0' + high
            } else {
                b'a' + high - 10
            };
            hex_string[j * 2 + 1] = if low < 10 {
                b'0' + low
            } else {
                b'a' + low - 10
            };
        }
        // Convert to string and log
        if let Ok(hex_str) = core::str::from_utf8(&hex_string) {
            msg!(hex_str);
        }
    }
}
