use pinocchio::{account_info::AccountInfo, pubkey::Pubkey, ProgramResult};

pub mod debug_tree;
pub mod deposit;
pub mod initialize;
pub mod ragequit;
pub mod test_poseidon;
pub mod types;
pub mod wind_down;
pub mod withdraw;
pub mod withdraw_fees;

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
        } => initialize::initialize_pool(
            program_id,
            accounts,
            entrypoint_authority,
            max_tree_depth,
            asset_mint,
        ),

        PrivacyPoolInstruction::Deposit {
            depositor,
            value,
            proof_data,
        } => deposit::deposit(program_id, accounts, depositor, value, proof_data),

        PrivacyPoolInstruction::Withdraw {
            withdrawal_data,
            proof_data,
        } => withdraw::withdraw(program_id, accounts, withdrawal_data, proof_data),

        PrivacyPoolInstruction::Ragequit { value } => {
            // RAGEQUIT: Non-private exit, no ZK proof required
            ragequit::ragequit(program_id, accounts, value)
        }

        PrivacyPoolInstruction::WindDown => wind_down::wind_down(program_id, accounts),

        PrivacyPoolInstruction::WithdrawFees { amount } => {
            withdraw_fees::withdraw_fees(program_id, accounts, amount)
        }

        PrivacyPoolInstruction::TestPoseidon { left, right } => {
            test_poseidon::test_poseidon(left, right)
        }

        PrivacyPoolInstruction::DebugTree { op_type, value } => {
            // Only support insert operation for debugging
            if op_type != 0 {
                return Err(pinocchio::program_error::ProgramError::InvalidInstructionData);
            }
            
            let insert_value = value
                .ok_or(pinocchio::program_error::ProgramError::InvalidInstructionData)?;
            
            debug_tree::debug_tree_insert(program_id, accounts, insert_value)
        }
    }
}
