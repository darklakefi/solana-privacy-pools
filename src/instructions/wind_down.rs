use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};
use pinocchio_log::log;

use crate::state::zero_copy::PrivacyPoolStateZC;

/// Wind down the pool (disable deposits) using zero-copy accounts
pub fn wind_down(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
) -> ProgramResult {
    let pool_account = &accounts[0];
    let entrypoint_account = &accounts[1];
    
    if !entrypoint_account.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    // Get mutable reference to pool state using zero-copy
    let pool_state = PrivacyPoolStateZC::from_account_mut(pool_account)?;
    
    if pool_state.get_entrypoint_authority() != *entrypoint_account.key() {
        log!("Only entrypoint can wind down pool");
        return Err(ProgramError::InvalidArgument);
    }
    
    if pool_state.is_dead() {
        log!("Pool already dead");
        return Err(ProgramError::InvalidAccountData);
    }
    
    pool_state.set_dead(true);
    
    log!("Pool wound down");
    Ok(())
}