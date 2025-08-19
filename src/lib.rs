use pinocchio::{
    account_info::AccountInfo,
    entrypoint,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};

pub mod state;
pub mod instructions;
pub mod crypto;

// Utils module is test-only
#[cfg(any(test, feature = "test-utils"))]
pub mod utils;

use crate::instructions::*;

entrypoint!(process_instruction);

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let instruction = PrivacyPoolInstruction::try_from_slice(instruction_data)?;
    instructions::process_instruction(instruction, program_id, accounts)
}

/// Basic serialization/deserialization traits
pub trait BorshSerialize {
    fn try_to_vec(&self) -> Result<Vec<u8>, ProgramError> {
        Err(ProgramError::InvalidAccountData)
    }
}

pub trait BorshDeserialize {
    fn try_from_slice(_data: &[u8]) -> Result<Self, ProgramError> where Self: Sized {
        Err(ProgramError::InvalidAccountData)
    }
}


/// Constants from the Solidity contract
pub mod constants {
    // SNARK scalar field is too large for u64, represented as bytes
    pub const SNARK_SCALAR_FIELD_BYTES: [u8; 32] = [
        0x01, 0x00, 0x00, 0xf0, 0x93, 0xf5, 0xe1, 0x43, 0x91, 0x70, 0xb9, 0x79, 0x48, 0xe8, 0x33, 0x28,
        0x5d, 0x58, 0x81, 0x81, 0xb6, 0x45, 0x50, 0xb8, 0x29, 0xa0, 0x31, 0xe1, 0x72, 0x4e, 0x64, 0x30,
    ];
    pub const MAX_TREE_DEPTH: u8 = 32;
    pub const ROOT_HISTORY_SIZE: usize = 64;
}