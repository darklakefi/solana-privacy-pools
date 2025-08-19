use pinocchio::{
    account_info::AccountInfo,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};

use crate::{BorshSerialize};
use crate::state::*;
use super::types::{WithdrawalData, WithdrawProofData};

/// Process a private withdrawal
pub fn withdraw(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    withdrawal_data: WithdrawalData,
    proof_data: WithdrawProofData,
) -> ProgramResult {
    let pool_account = &accounts[0];
    let processooor_account = &accounts[1];
    let nullifier_account = &accounts[2];
    let asset_vault = &accounts[3];
    let processooor_token_account = &accounts[4];
    
    if processooor_account.key() != &withdrawal_data.processooor {
        msg!("Invalid processooor");
        return Err(ProgramError::InvalidArgument);
    }
    
    if !processooor_account.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    let mut pool_state = get_privacy_pool_state(pool_account)?;
    
    let expected_context = crate::crypto::poseidon::compute_context(&withdrawal_data, &pool_state.scope);
    if expected_context != proof_data.context() {
        msg!("Context mismatch");
        return Err(ProgramError::InvalidArgument);
    }
    
    if proof_data.state_tree_depth() > pool_state.max_tree_depth || 
       proof_data.asp_tree_depth() > pool_state.max_tree_depth {
        msg!("Invalid tree depth");
        return Err(ProgramError::InvalidArgument);
    }
    
    if !pool_state.is_known_root(&proof_data.state_root()) {
        msg!("Unknown state root");
        return Err(ProgramError::InvalidArgument);
    }
    
    if !crate::crypto::verifying_key::verify_withdraw_proof(&proof_data) {
        msg!("Invalid withdrawal proof");
        return Err(ProgramError::InvalidArgument);
    }
    
    let nullifier_state = NullifierState::new(proof_data.existing_nullifier_hash());
    let nullifier_data = nullifier_state.try_to_vec()?;
    nullifier_account.try_borrow_mut_data()?[..].copy_from_slice(&nullifier_data);
    
    pool_state.merkle_tree.insert(proof_data.new_commitment_hash())?;
    pool_state.add_root(pool_state.merkle_tree.root);
    
    let pool_data = pool_state.try_to_vec()?;
    pool_account.try_borrow_mut_data()?[..].copy_from_slice(&pool_data);
    
    msg!("Withdrawal processed: {} tokens to {:?}", 
         proof_data.withdrawn_value(), 
         withdrawal_data.processooor);
    Ok(())
}