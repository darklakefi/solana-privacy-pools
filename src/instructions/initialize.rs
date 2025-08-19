use pinocchio::{
    account_info::AccountInfo,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};

use crate::{BorshSerialize};
use crate::state::*;

/// Initialize a new privacy pool
pub fn initialize_pool(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    entrypoint_authority: Pubkey,
    max_tree_depth: u8,
    asset_mint: Pubkey,
) -> ProgramResult {
    let pool_account = &accounts[0];
    let payer = &accounts[1];
    
    if !payer.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    if pool_account.data_len() != PrivacyPoolState::LEN {
        return Err(ProgramError::InvalidAccountData);
    }
    
    let mut pool_state = PrivacyPoolState::new(entrypoint_authority, asset_mint, max_tree_depth);
    
    let serialized = pool_state.try_to_vec()?;
    pool_account.try_borrow_mut_data()?[..].copy_from_slice(&serialized);
    
    msg!("Privacy pool initialized with authority: {:?}", entrypoint_authority);
    Ok(())
}