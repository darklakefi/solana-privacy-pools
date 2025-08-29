use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};
use pinocchio_log::log;

use crate::state::PoolStateLeanIMT;

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
    
    // Get mutable reference to pool state
    let mut pool_data = pool_account.try_borrow_mut_data()?;
    let pool_state = unsafe {
        &mut *(pool_data.as_mut_ptr() as *mut PoolStateLeanIMT)
    };
    
    if &Pubkey::from(pool_state.entrypoint) != entrypoint_account.key() {
        log!("Only entrypoint can wind down pool");
        return Err(ProgramError::InvalidArgument);
    }
    
    if pool_state.is_dead != 0 {
        log!("Pool already dead");
        return Err(ProgramError::InvalidAccountData);
    }
    
    pool_state.is_dead = 1;
    
    log!("Pool wound down");
    Ok(())
}