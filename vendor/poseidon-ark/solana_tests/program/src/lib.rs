use solana_program::{
    account_info::AccountInfo,
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};
use poseidon_ark::Poseidon;

entrypoint!(process_instruction);

pub fn process_instruction(
    _program_id: &Pubkey,
    _accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    if instruction_data.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }
    
    let poseidon = Poseidon::new();
    
    match instruction_data[0] {
        0 => {
            // Poseidon hash with 1 input using library (which uses Solana syscall)
            let input = &instruction_data[1..];
            if input.len() != 32 {
                return Err(ProgramError::InvalidInstructionData);
            }
            
            let mut bytes = [0u8; 32];
            bytes.copy_from_slice(input);
            
            match poseidon.hash_bytes(&[&bytes]) {
                Ok(result) => {
                    msg!("Poseidon1({} bytes): {:?}", input.len(), &result[..8]);
                }
                Err(_) => return Err(ProgramError::InvalidInstructionData),
            }
        }
        1 => {
            // Poseidon hash with 2 inputs using library (which uses Solana syscall)
            let input = &instruction_data[1..];
            if input.len() != 64 {
                return Err(ProgramError::InvalidInstructionData);
            }
            
            let mut bytes1 = [0u8; 32];
            let mut bytes2 = [0u8; 32];
            bytes1.copy_from_slice(&input[0..32]);
            bytes2.copy_from_slice(&input[32..64]);
            
            match poseidon.hash_bytes(&[&bytes1, &bytes2]) {
                Ok(result) => {
                    msg!("Poseidon2({} bytes): {:?}", input.len(), &result[..8]);
                }
                Err(_) => return Err(ProgramError::InvalidInstructionData),
            }
        }
        _ => {
            return Err(ProgramError::InvalidInstructionData);
        }
    }
    
    Ok(())
}