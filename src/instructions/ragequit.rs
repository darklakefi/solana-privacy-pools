use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};
use pinocchio_log::log;
use pinocchio_token::{instructions::TransferChecked, state::Mint};

use crate::state::{PoolStateLeanIMT, DepositorStateZC};
use crate::constants::VAULT_PDA_SEED;
use pinocchio::instruction::{Seed, Signer};

/// Process a ragequit withdrawal
/// Note: In current implementation, ragequit allows depositors to withdraw
/// their funds without privacy, typically when the pool is dead/compromised
/// 
/// Accounts:
/// 0. Pool state account (writable)
/// 1. Vault PDA (token authority)
/// 2. Depositor state account (writable)
/// 3. Ragequitter (signer) - must be original depositor
/// 4. Pool's token account (writable)
/// 5. User's token account (writable)
/// 6. Asset mint
/// 7. Token program
pub fn ragequit(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    // For now, we'll pass the value directly since there's no circuit
    value: u64,
) -> ProgramResult {
    if accounts.len() < 8 {
        log!("Not enough accounts provided");
        return Err(ProgramError::NotEnoughAccountKeys);
    }
    
    let pool_account = &accounts[0];
    let vault_account = &accounts[1];
    let depositor_account = &accounts[2];
    let ragequitter_account = &accounts[3];
    let pool_token_account = &accounts[4];
    let user_token_account = &accounts[5];
    let mint_account = &accounts[6];
    let _token_program = &accounts[7];
    
    if !ragequitter_account.is_signer() {
        log!("Ragequitter must sign");
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    // Get pool state (read-only since we're not modifying pool state)
    let pool_state = PoolStateLeanIMT::from_account_mut(pool_account)?;
    
    // Verify the vault PDA and get bump
    let (expected_vault, vault_bump) = pinocchio::pubkey::find_program_address(
        &[VAULT_PDA_SEED, &pool_state.asset_mint],
        program_id
    );
    if vault_account.key() != &expected_vault {
        log!("Invalid vault account");
        return Err(ProgramError::InvalidArgument);
    }
    
    // Ragequit is typically only allowed when pool is dead
    if pool_state.is_dead == 0 {
        log!("Pool is not dead - ragequit not allowed");
        return Err(ProgramError::InvalidAccountData);
    }
    
    // Verify depositor
    let depositor_state = DepositorStateZC::from_account_mut(depositor_account)?;
    if &depositor_state.depositor != ragequitter_account.key().as_ref() {
        log!("Not original depositor");
        return Err(ProgramError::InvalidArgument);
    }
    
    // Verify the mint matches the pool's asset mint
    if *mint_account.key() != Pubkey::from(pool_state.asset_mint) {
        log!("Wrong token mint");
        return Err(ProgramError::InvalidArgument);
    }
    
    // Transfer tokens from pool to user
    log!("Ragequit: transferring tokens to user");
    
    // Read decimals from the mint account
    let mint = unsafe { Mint::from_account_info_unchecked(mint_account)? };
    let decimals = mint.decimals();
    
    // Use vault PDA seeds for signing (including bump)
    let bump_seed = [vault_bump];
    let seeds = [Seed::from(VAULT_PDA_SEED), Seed::from(&pool_state.asset_mint), Seed::from(&bump_seed)];
    let signer = Signer::from(&seeds);
    TransferChecked {
        from: pool_token_account,
        to: user_token_account,
        mint: mint_account,
        authority: vault_account,
        amount: value,
        decimals,
    }.invoke_signed(&[signer])?;
    
    // Mark depositor state as withdrawn
    depositor_state.label = [0u8; 32]; // Clear the label
    
    log!("Ragequit processed successfully");
    
    Ok(())
}