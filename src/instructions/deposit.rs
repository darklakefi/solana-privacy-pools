use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};

use crate::state::zero_copy::{PrivacyPoolStateZC, DepositorStateZC};

/// Make a deposit to the privacy pool using zero-copy accounts
pub fn deposit(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    depositor: Pubkey,
    value: u64,
    precommitment_hash: [u8; 32],
) -> ProgramResult {
    if accounts.len() < 3 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }
    
    let pool_account = &accounts[0];
    let depositor_account = &accounts[1];
    let depositor_signer = &accounts[2];
    
    if !depositor_signer.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    if depositor_signer.key() != &depositor {
        return Err(ProgramError::InvalidArgument);
    }
    
    let pool_state = PrivacyPoolStateZC::from_account_mut(pool_account)?;
    
    if pool_state.is_dead() {
        return Err(ProgramError::InvalidAccountData);
    }
    
    if value >= u128::MAX as u64 {
        return Err(ProgramError::InvalidArgument);
    }
    
    let nonce = pool_state.increment_nonce();
    let label = crate::crypto::poseidon::compute_label(&pool_state.scope, nonce);
    let commitment = crate::crypto::poseidon::compute_commitment(value, &label, &precommitment_hash);
    
    // Update merkle tree in-place
    pool_state.merkle_tree.insert(commitment)?;
    pool_state.add_root(pool_state.merkle_tree.root);
    
    // Update depositor state using zero-copy
    let depositor_state = DepositorStateZC::from_account_mut(depositor_account)?;
    depositor_state.set(depositor, label);
    Ok(())
}