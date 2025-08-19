use pinocchio::{
    account_info::AccountInfo,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};

use crate::{BorshSerialize};
use crate::state::*;

/// Make a deposit to the privacy pool
pub fn deposit(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    depositor: Pubkey,
    value: u64,
    precommitment_hash: [u8; 32],
) -> ProgramResult {
    let pool_account = &accounts[0];
    let entrypoint_account = &accounts[1];
    let depositor_account = &accounts[2];
    let asset_vault = &accounts[3];
    let user_token_account = &accounts[4];
    
    if !entrypoint_account.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    let mut pool_state = get_privacy_pool_state(pool_account)?;
    
    if pool_state.dead {
        msg!("Pool is dead, deposits not allowed");
        return Err(ProgramError::InvalidAccountData);
    }
    
    if value >= u128::MAX as u64 {
        msg!("Invalid deposit value");
        return Err(ProgramError::InvalidArgument);
    }
    
    let nonce = pool_state.increment_nonce();
    
    let label = crate::crypto::poseidon::compute_label(&pool_state.scope, nonce);
    
    let commitment = crate::crypto::poseidon::compute_commitment(value, &label, &precommitment_hash);
    
    pool_state.merkle_tree.insert(commitment)?;
    pool_state.add_root(pool_state.merkle_tree.root);
    
    let depositor_state = DepositorState::new(depositor, label);
    let depositor_data = depositor_state.try_to_vec()?;
    depositor_account.try_borrow_mut_data()?[..].copy_from_slice(&depositor_data);
    
    let pool_data = pool_state.try_to_vec()?;
    pool_account.try_borrow_mut_data()?[..].copy_from_slice(&pool_data);
    
    msg!("Deposited {} tokens, commitment: {:?}", value, commitment);
    Ok(())
}