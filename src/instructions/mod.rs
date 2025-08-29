use pinocchio::{
    account_info::AccountInfo,
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
            proof_data,
        } => {
            deposit::deposit(program_id, accounts, depositor, value, proof_data)
        }
        
        PrivacyPoolInstruction::Withdraw {
            withdrawal_data,
            proof_data,
        } => {
            withdraw::withdraw(program_id, accounts, withdrawal_data, proof_data)
        }
        
        PrivacyPoolInstruction::Ragequit {
            value,
        } => {
            // RAGEQUIT: Non-private exit, no ZK proof required
            ragequit::ragequit(program_id, accounts, value)
        }
        
        PrivacyPoolInstruction::WindDown => {
            wind_down::wind_down(program_id, accounts)
        }
    }
}