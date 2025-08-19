use pinocchio::{
    account_info::AccountInfo,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};

use crate::state::zero_copy::{PrivacyPoolStateZC, NullifierStateZC};
use super::types::{WithdrawalData, WithdrawProofData};

/// Process a private withdrawal using zero-copy accounts
pub fn withdraw(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    withdrawal_data: WithdrawalData,
    proof_data: WithdrawProofData,
) -> ProgramResult {
    let pool_account = &accounts[0];
    let processooor_account = &accounts[1];
    let nullifier_account = &accounts[2];
    
    if processooor_account.key() != &withdrawal_data.processooor {
        msg!("Invalid processooor");
        return Err(ProgramError::InvalidArgument);
    }
    
    if !processooor_account.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    // Get mutable reference to pool state using zero-copy
    let pool_state = PrivacyPoolStateZC::from_account_mut(pool_account)?;
    
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
    
    // Update nullifier state using zero-copy
    let nullifier_state = NullifierStateZC::from_account_mut(nullifier_account)?;
    nullifier_state.set_spent(proof_data.existing_nullifier_hash());
    
    // Update merkle tree in-place
    pool_state.merkle_tree.insert(proof_data.new_commitment_hash())?;
    pool_state.add_root(pool_state.merkle_tree.root);
    
    msg!("Withdrawal processed: {} tokens to {:?}", 
         proof_data.withdrawn_value(), 
         withdrawal_data.processooor);
    Ok(())
}