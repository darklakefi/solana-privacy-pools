use pinocchio::{
    account_info::AccountInfo,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};

use crate::{BorshSerialize};
use crate::state::*;

/// Wind down the pool (disable deposits)
pub fn wind_down(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
) -> ProgramResult {
    let pool_account = &accounts[0];
    let entrypoint_account = &accounts[1];
    
    if !entrypoint_account.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    let mut pool_state = get_privacy_pool_state(pool_account)?;
    
    if pool_state.entrypoint_authority != *entrypoint_account.key() {
        msg!("Only entrypoint can wind down pool");
        return Err(ProgramError::InvalidArgument);
    }
    
    if pool_state.dead {
        msg!("Pool already dead");
        return Err(ProgramError::InvalidAccountData);
    }
    
    pool_state.dead = true;
    
    let pool_data = pool_state.try_to_vec()?;
    pool_account.try_borrow_mut_data()?[..].copy_from_slice(&pool_data);
    
    msg!("Pool wound down");
    Ok(())
}