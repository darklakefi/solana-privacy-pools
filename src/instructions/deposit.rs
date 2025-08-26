use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
    msg,
};
use pinocchio_token::instructions::Transfer;

use crate::state::{PoolStateLeanIMT, DepositorStateZC};

/// Make a deposit to the privacy pool using SPL tokens
/// 
/// Accounts:
/// 0. Pool state account (writable)
/// 1. Depositor state account (writable)
/// 2. Depositor (signer)
/// 3. User's token account (writable)
/// 4. Pool's token account (writable)
/// 5. Token program
pub fn deposit(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    depositor: Pubkey,
    value: u64,
    precommitment_hash: [u8; 32],
) -> ProgramResult {
    if accounts.len() < 6 {
        msg!("Not enough accounts provided");
        return Err(ProgramError::NotEnoughAccountKeys);
    }
    
    let pool_account = &accounts[0];
    let depositor_state_account = &accounts[1];
    let depositor_signer = &accounts[2];
    let user_token_account = &accounts[3];
    let pool_token_account = &accounts[4];
    let _token_program = &accounts[5];
    
    // Validate signer
    if !depositor_signer.is_signer() {
        msg!("Depositor must sign");
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    if depositor_signer.key() != &depositor {
        msg!("Invalid depositor");
        return Err(ProgramError::InvalidArgument);
    }
    
    // Get pool state
    let pool_state = PoolStateLeanIMT::from_account_mut(pool_account)?;
    
    if pool_state.is_dead != 0 {
        msg!("Pool is dead");
        return Err(ProgramError::InvalidAccountData);
    }
    
    // Validate value
    if value == 0 {
        msg!("Cannot deposit zero");
        return Err(ProgramError::InvalidArgument);
    }
    
    if value >= u128::MAX as u64 {
        msg!("Value too large");
        return Err(ProgramError::InvalidArgument);
    }
    
    // Transfer tokens from user to pool using pinocchio-token
    msg!("Transferring {} tokens to pool", value);
    
    Transfer {
        from: user_token_account,
        to: pool_token_account,
        authority: depositor_signer,
        amount: value,
    }.invoke()?;
    
    msg!("Token transfer successful");
    
    // Generate label and commitment
    let nonce = pool_state.increment_nonce();
    let label = crate::crypto::poseidon::compute_label(&pool_state.scope, nonce);
    let commitment = crate::crypto::poseidon::compute_commitment(value, &label, &precommitment_hash);
    
    // Insert commitment into state tree
    pool_state.insert_state_commitment(commitment)?;
    
    // Insert label into ASP tree
    pool_state.insert_asp_label(label)?;
    
    // Update depositor state
    let depositor_state = DepositorStateZC::from_account_mut(depositor_state_account)?;
    depositor_state.set(depositor, label);
    
    msg!("Deposit successful. Label: {:?}", label);
    
    Ok(())
}