use pinocchio::{
    account_info::AccountInfo,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};
use pinocchio_token::instructions::TransferChecked;

use crate::state::{PoolStateLeanIMT, DepositorStateZC};

/// Process a ragequit withdrawal
/// Note: In current implementation, ragequit allows depositors to withdraw
/// their funds without privacy, typically when the pool is dead/compromised
/// 
/// Accounts:
/// 0. Pool state account (writable)
/// 1. Depositor state account (writable)
/// 2. Ragequitter (signer) - must be original depositor
/// 3. Pool's token account (writable)
/// 4. User's token account (writable)
/// 5. Asset mint
/// 6. Token program
pub fn ragequit(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    // For now, we'll pass the value directly since there's no circuit
    value: u64,
) -> ProgramResult {
    if accounts.len() < 7 {
        msg!("Not enough accounts provided");
        return Err(ProgramError::NotEnoughAccountKeys);
    }
    
    let pool_account = &accounts[0];
    let depositor_account = &accounts[1];
    let ragequitter_account = &accounts[2];
    let pool_token_account = &accounts[3];
    let user_token_account = &accounts[4];
    let mint_account = &accounts[5];
    let _token_program = &accounts[6];
    
    if !ragequitter_account.is_signer() {
        msg!("Ragequitter must sign");
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    // Get pool state (read-only since we're not modifying pool state)
    let pool_state = PoolStateLeanIMT::from_account_mut(pool_account)?;
    
    // Ragequit is typically only allowed when pool is dead
    if pool_state.is_dead == 0 {
        msg!("Pool is not dead - ragequit not allowed");
        return Err(ProgramError::InvalidAccountData);
    }
    
    // Verify depositor
    let depositor_state = DepositorStateZC::from_account_mut(depositor_account)?;
    if &depositor_state.depositor != ragequitter_account.key().as_ref() {
        msg!("Not original depositor");
        return Err(ProgramError::InvalidArgument);
    }
    
    // Verify the mint matches the pool's asset mint
    if *mint_account.key() != Pubkey::from(pool_state.asset_mint) {
        msg!("Wrong token mint");
        return Err(ProgramError::InvalidArgument);
    }
    
    // Transfer tokens from pool to user
    msg!("Ragequit: transferring {} tokens to user", value);
    
    // For TransferChecked, we need decimals. For simplicity, assume 9 (like SOL)
    // In production, you'd read this from the mint account
    let decimals = 9u8;
    
    TransferChecked {
        from: pool_token_account,
        to: user_token_account,
        mint: mint_account,
        authority: pool_account,
        amount: value,
        decimals,
    }.invoke_signed(&[])?; // Empty seeds for now, would use PDA seeds in production
    
    // Mark depositor state as withdrawn
    depositor_state.label = [0u8; 32]; // Clear the label
    
    msg!("Ragequit processed: {} tokens to {:?}", 
         value, 
         ragequitter_account.key());
    
    Ok(())
}