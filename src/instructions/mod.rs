use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};

pub mod types;
pub mod initialize;
pub mod deposit;
pub mod withdraw;
pub mod ragequit;
pub mod wind_down;

pub use types::*;
pub use initialize::*;
pub use deposit::*;
pub use withdraw::*;
pub use ragequit::*;
pub use wind_down::*;

/// Main instruction processor
pub fn process_instruction(
    instruction: PrivacyPoolInstruction,
    program_id: &Pubkey,
    accounts: &[AccountInfo],
) -> ProgramResult {
    match instruction {
        PrivacyPoolInstruction::InitializePool { 
            entrypoint_authority,
            max_tree_depth,
            asset_mint,
        } => {
            initialize::initialize_pool(program_id, accounts, entrypoint_authority, max_tree_depth, asset_mint)
        }
        
        PrivacyPoolInstruction::Deposit {
            depositor,
            value,
            precommitment_hash,
        } => {
            deposit::deposit(program_id, accounts, depositor, value, precommitment_hash)
        }
        
        PrivacyPoolInstruction::Withdraw {
            withdrawal_data,
            proof_data,
        } => {
            withdraw::withdraw(program_id, accounts, withdrawal_data, proof_data)
        }
        
        PrivacyPoolInstruction::Ragequit {
            proof_data,
        } => {
            ragequit::ragequit(program_id, accounts, proof_data)
        }
        
        PrivacyPoolInstruction::WindDown => {
            wind_down::wind_down(program_id, accounts)
        }
    }
}