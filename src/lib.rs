use pinocchio::{
    account_info::AccountInfo,
    entrypoint,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};

mod verifying_key;
mod state;
mod instructions;
mod merkle_tree;
mod poseidon;

use crate::instructions::*;
use crate::state::*;

entrypoint!(process_instruction);

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let instruction = PrivacyPoolInstruction::try_from_slice(instruction_data)?;
    
    match instruction {
        PrivacyPoolInstruction::InitializePool { 
            entrypoint_authority,
            max_tree_depth,
            asset_mint,
        } => {
            msg!("Instruction: Initialize Privacy Pool");
            instructions::initialize_pool(program_id, accounts, entrypoint_authority, max_tree_depth, asset_mint)
        }
        
        PrivacyPoolInstruction::Deposit {
            depositor,
            value,
            precommitment_hash,
        } => {
            msg!("Instruction: Deposit");
            instructions::deposit(program_id, accounts, depositor, value, precommitment_hash)
        }
        
        PrivacyPoolInstruction::Withdraw {
            withdrawal_data,
            proof_data,
        } => {
            msg!("Instruction: Withdraw");
            instructions::withdraw(program_id, accounts, withdrawal_data, proof_data)
        }
        
        PrivacyPoolInstruction::Ragequit {
            proof_data,
        } => {
            msg!("Instruction: Ragequit");
            instructions::ragequit(program_id, accounts, proof_data)
        }
        
        PrivacyPoolInstruction::WindDown => {
            msg!("Instruction: Wind Down Pool");
            instructions::wind_down(program_id, accounts)
        }
    }
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

impl BorshDeserialize for PrivacyPoolInstruction {
    fn try_from_slice(data: &[u8]) -> Result<Self, ProgramError> {
        if data.is_empty() {
            return Err(ProgramError::InvalidInstructionData);
        }
        
        match data[0] {
            0 => {
                if data.len() < 1 + 32 + 1 + 32 {
                    return Err(ProgramError::InvalidInstructionData);
                }
                let mut offset = 1;
                let entrypoint_authority = Pubkey::from(
                    data[offset..offset + 32].try_into()
                        .map_err(|_| ProgramError::InvalidInstructionData)?
                );
                offset += 32;
                let max_tree_depth = data[offset];
                offset += 1;
                let asset_mint = Pubkey::from(
                    data[offset..offset + 32].try_into()
                        .map_err(|_| ProgramError::InvalidInstructionData)?
                );
                
                Ok(PrivacyPoolInstruction::InitializePool {
                    entrypoint_authority,
                    max_tree_depth,
                    asset_mint,
                })
            }
            _ => Err(ProgramError::InvalidInstructionData),
        }
    }
}

/// Constants from the Solidity contract
pub mod constants {
    pub const SNARK_SCALAR_FIELD: u64 = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    pub const MAX_TREE_DEPTH: u8 = 32;
    pub const ROOT_HISTORY_SIZE: usize = 64;
}